"""참조 특징 생성 (브라우저 채점용).

브라우저가 녹음을 서버로 보내지 않고 스스로 채점하려면, 서버는 "기준이 되는
음성의 특징"만 미리 만들어 두면 된다. 이 모듈이 그 역할을 한다.

특징 정의 (static/light.js 의 JS 구현과 **반드시 동일**해야 한다)
  sr=16000, win=400(25ms), hop=320(50fps), nfft=512, mel=24 (80~7600Hz)
  → log-mel → 구간 평균 차감(CMN) → 프레임 단위벡터 정규화 → int8 양자화

캐시: data/feats/{vid}.json  (오디오 id 가 바뀌면 자동 재생성)
"""
from __future__ import annotations

import base64
import json
import threading
import time
from pathlib import Path

import numpy as np
import soundfile as sf

try:
    import librosa
except Exception:                                  # pragma: no cover
    librosa = None

SR, WIN, HOP, NFFT, NMEL = 16000, 400, 320, 512, 24
VERSION = 1
_LOCK = threading.Lock()
_MEM: dict[str, dict] = {}
_MEM_MAX = 8

_BANK = None


def _hz2mel(f: float) -> float:
    return 2595.0 * np.log10(1.0 + f / 700.0)


def _mel2hz(m: float) -> float:
    return 700.0 * (10.0 ** (m / 2595.0) - 1.0)


def _bank() -> np.ndarray:
    global _BANK
    if _BANK is not None:
        return _BANK
    lo, hi = _hz2mel(80.0), _hz2mel(7600.0)
    pts = [_mel2hz(lo + (hi - lo) * i / (NMEL + 1)) for i in range(NMEL + 2)]
    bin_hz = SR / NFFT
    b = np.zeros((NMEL, NFFT // 2 + 1), dtype=np.float32)
    for m in range(1, NMEL + 1):
        f0, f1, f2 = pts[m - 1], pts[m], pts[m + 1]
        for k in range(NFFT // 2 + 1):
            f = k * bin_hz
            if f0 <= f <= f1:
                b[m - 1, k] = (f - f0) / (f1 - f0)
            elif f1 < f <= f2:
                b[m - 1, k] = (f2 - f) / (f2 - f1)
    _BANK = b
    return b


def load_audio(key: str, storage) -> np.ndarray:
    """오디오 키 → 16kHz 모노 float32."""
    with storage.open(key) as f:
        y, sr = sf.read(f, dtype="float32", always_2d=False)
    if getattr(y, "ndim", 1) > 1:
        y = y.mean(axis=1)
    y = np.asarray(y, dtype=np.float32)
    if sr != SR:
        if librosa is not None:
            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        else:                                       # 폴백: 선형 보간
            n = int(round(len(y) * SR / sr))
            y = np.interp(np.linspace(0, len(y) - 1, n), np.arange(len(y)), y).astype(np.float32)
    return y


def _trim(y: np.ndarray) -> np.ndarray:
    if y.size < WIN:
        return y
    n = (len(y) - WIN) // HOP + 1
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    e = np.sqrt((y[idx] ** 2).mean(axis=1))
    mx = float(e.max())
    if mx < 1e-4:
        return y
    th = mx * 0.12
    a, b = 0, n - 1
    while a < n and e[a] < th:
        a += 1
    while b > a and e[b] < th:
        b -= 1
    a = max(0, a - 2)
    b = min(n - 1, b + 2)
    return y[a * HOP: min(len(y), b * HOP + WIN)]


def features(y: np.ndarray) -> np.ndarray:
    """(frames, NMEL) float32 — CMN + 프레임 단위벡터."""
    y = np.asarray(y, dtype=np.float32)
    if y.size < WIN:
        return np.zeros((0, NMEL), dtype=np.float32)
    y = _trim(y)
    if y.size < WIN:
        return np.zeros((0, NMEL), dtype=np.float32)
    peak = float(np.abs(y).max())
    if peak > 1e-6:
        y = y / peak
    n = (len(y) - WIN) // HOP + 1
    idx = np.arange(WIN)[None, :] + HOP * np.arange(n)[:, None]
    win = np.hanning(WIN).astype(np.float32)
    frames = y[idx] * win
    spec = np.abs(np.fft.rfft(frames, n=NFFT)) ** 2
    mel = np.log(spec @ _bank().T + 1e-10)
    mel = mel - mel.mean(axis=0, keepdims=True)
    norm = np.linalg.norm(mel, axis=1, keepdims=True) + 1e-12
    return (mel / norm).astype(np.float32)


def _pack(f: np.ndarray) -> dict:
    q = np.clip(np.round(f * 127.0), -127, 127).astype(np.int8)
    return {"n": int(q.shape[0]), "b64": base64.b64encode(q.tobytes()).decode("ascii")}


def build(vid: str, key: str, segs: list, storage, audio_id: str = "") -> dict:
    """영상 1개의 모든 구간 특징을 계산한다."""
    t0 = time.time()
    y = load_audio(key, storage)
    out = []
    for s in segs:
        a = float(s.get("start") or 0.0)
        b = float(s.get("end") or 0.0)
        if b <= a:
            b = a + 4.0
        i0 = int(max(0, round(a * SR)))
        i1 = int(min(len(y), round(b * SR)))
        f = features(y[i0:i1]) if i1 > i0 else np.zeros((0, NMEL), np.float32)
        out.append(_pack(f))
    payload = {
        "v": VERSION, "vid": vid, "audio_id": audio_id,
        "sr": SR, "win": WIN, "hop": HOP, "nfft": NFFT, "nmel": NMEL,
        "dur": round(len(y) / SR, 3), "ms": int((time.time() - t0) * 1000),
        "segs": out,
    }
    return payload


def get_or_build(vid: str, key: str, segs: list, storage, audio_id: str = "",
                 feats_dir: Path | None = None) -> dict:
    """메모리 → 디스크 → 계산 순으로 조회."""
    if vid in _MEM and _MEM[vid].get("audio_id") == audio_id:
        return _MEM[vid]
    path = Path(feats_dir) / (vid + ".json") if feats_dir else None
    if path and path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("v") == VERSION and data.get("audio_id") == audio_id:
                _remember(vid, data)
                return data
        except Exception:
            pass
    with _LOCK:
        data = build(vid, key, segs, storage, audio_id)
        if path:
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(data), encoding="utf-8")
            except Exception:
                pass
        _remember(vid, data)
        return data


def _remember(vid: str, data: dict) -> None:
    _MEM[vid] = data
    while len(_MEM) > _MEM_MAX:
        _MEM.pop(next(iter(_MEM)))


def drop(vid: str, feats_dir: Path | None = None) -> None:
    _MEM.pop(vid, None)
    if feats_dir:
        p = Path(feats_dir) / (vid + ".json")
        try:
            if p.exists():
                p.unlink()
        except Exception:
            pass
