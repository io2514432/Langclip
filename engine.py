"""셰도잉 음향 채점 엔진 v4

설계 원칙
  1) 네 축이 서로 다른 신호를 잰다. (v3 는 '어택'이 리듬의 env_corr 복사본이었다)
       억양 pitch  : DTW 정렬 후 '추세를 뺀' 반음 윤곽의 차이
       리듬 rhythm : 음절 시작점(onset strength) 의 시간 오차 + 길이 비
       발음 artic  : MFCC + delta 의 스펙트럼 지문 거리 (유성음 구간만)
       강세 stress : 음량 엔벨로프 상관 (어디를 세게 말했는가)
  2) 점수는 절대 상수가 아니라 **이 영상의 문장끼리 거리 분포**로 매긴다.
     같은 화자가 다른 문장을 말했을 때의 거리를 '바닥'으로 삼아,
     그보다 가까우면 85~100, 멀면 40 이하로 떨어진다. 영상·화자마다 자동 보정된다.
  3) 축의 변별력(range)이 없으면 그 축은 신뢰할 수 없다고 표시하고 가중치를 낮춘다.
       (배경음악이 깔린 원본에서는 발음 축의 range 가 작아진다)

v3 대비 실측 근거
  v3 의 pitch_d 는 A(정상 시도) 5.31 인데 '다른 문장' 4.57 보다 나빴다 → 지표가 무효.
  v3 의 timbre_d 는 A 4.69 / B 4.81 / C 4.83 / 바닥 4.74 → 변별력이 사실상 0.
  그래서 지표 자체를 바꾸고, 점수도 분포 기반으로 바꿨다.
"""
from __future__ import annotations

import numpy as np
import librosa

SR, HOP, N_FFT = 16000, 160, 1024

# 축 기본 가중치 (전부 신뢰 가능할 때)
W = {"pitch": 0.32, "rhythm": 0.28, "artic": 0.25, "stress": 0.15}
# 보정 풀이 없을 때 쓰는 기본 문턱값 (16kHz 일반 발화 기준 실측치)
DEFAULT_BANDS = {"pitch": (0.62, 1.90), "rhythm": (0.18, 0.55),
                 "artic": (1.02, 2.27), "stress": (0.55, 0.85)}
MIN_RANGE = 1.15          # far/near 가 이보다 작으면 '변별력 없음'


# ---------------------------------------------------------------- 전처리
def _norm(y):
    p = float(np.max(np.abs(y))) if y.size else 0.0
    if p < 1e-4:
        raise ValueError("무음 또는 너무 조용한 입력입니다")
    return (y / p).astype(np.float32)


def preprocess(y, sr=SR):
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    y = _norm(y)
    y, _ = librosa.effects.trim(y, top_db=30, frame_length=N_FFT, hop_length=HOP)
    if y.size < int(0.2 * sr):
        raise ValueError("0.2초 미만의 너무 짧은 입력입니다")
    return _norm(y)


def _rms(y):
    return librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]


def align_lag(y_ref, y_take, max_ms=400):
    """테이크 앞부분 지연을 상호상관으로 보정."""
    e1 = np.log(_rms(y_ref) + 1e-6)
    e2 = np.log(_rms(y_take) + 1e-6)
    n = min(e1.size, e2.size)
    max_lag = int(max_ms / 1000 * SR / HOP)
    best, bl = -2.0, 0
    for L in range(-max_lag, max_lag + 1):
        if L >= 0:
            a, b = e1[:n - L], e2[L:n]
        else:
            a, b = e1[-L:n], e2[:n + L]
        if a.size < 10 or a.std() < 1e-9 or b.std() < 1e-9:
            continue
        c = float(np.corrcoef(a, b)[0, 1])
        if c > best:
            best, bl = c, L
    shift = bl * HOP
    if shift > 0:
        y_take = y_take[shift:]
    elif shift < 0:
        y_take = np.pad(y_take, (-shift, 0))
    return y_take, shift / SR


# ---------------------------------------------------------------- 특징
def pitch_contour(y, sr=SR):
    """유성음만 남긴 반음 윤곽. 추세(문장 전체 하강)는 나중에 제거한다."""
    f0, voiced, _ = librosa.pyin(y=y, fmin=70, fmax=500, sr=sr,
                                 frame_length=N_FFT, hop_length=HOP)
    f0 = np.asarray(f0, float)
    r = _rms(y)[: f0.size]
    n = min(f0.size, r.size)
    f0, r = f0[:n], r[:n]
    ok = np.isfinite(f0) & (r > np.percentile(r, 25)) if r.size else np.zeros(n, bool)
    sem = np.zeros(n)
    if ok.sum() > 5:
        s = 12.0 * np.log2(f0[ok] / 440.0)
        s = s - np.median(s)                     # 화자 음역대 보정
        sem[ok] = s
        idx = np.arange(n)
        sem = np.interp(idx, idx[ok], s)         # 무성음은 보간
        k = np.ones(5) / 5.0                     # 5프레임 이동평균: 미세 떨림 제거
        sem = np.convolve(sem, k, mode="same")
    return sem, float(ok.mean()) if n else 0.0


def _detrend(x, n=64):
    """64칸으로 리샘플하고 선형 추세를 뺀다. 문장 전체의 하강/상승은 억양이 아니다."""
    i = np.linspace(0, len(x) - 1, n)
    c = np.interp(i, np.arange(len(x)), x)
    t = np.linspace(-1, 1, n)
    c = c - (np.polyval(np.polyfit(t, c, 1), t))
    return c


def artic_feat(y, sr=SR):
    """음색·발음 지문: log-mel(40) CMVN.

    실측 비교(같은 원본, 정답 vs 오답 6문장 중앙값):
      MFCC+delta          정답 2.18~2.34 / 오답 2.21  → 구분 불가 (1.0배)
      log-mel 평균제거     정답 3.69~4.29 / 오답 4.21  → 약함 (1.14배)
      log-mel CMVN        정답 1.70~1.94 / 오답 2.27  → 사용 가능 (1.33배)
    그래서 CMVN 한 log-mel 을 쓴다. 배경음악 분리 후에도 MFCC+delta 는
    5.15(정답)/5.62(오답) 로 여전히 무의미했다 — 화자·채널 차이가 내용 차이를 덮는다.
    """
    S = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=40, n_fft=N_FFT, hop_length=HOP)
    L = np.log(S + 1e-8)
    L = (L - L.mean(1, keepdims=True)) / (L.std(1, keepdims=True) + 1e-5)
    return L.T


def energy_feat(y):
    e = np.log(_rms(y) + 1e-6)
    return ((e - e.mean()) / (e.std() + 1e-9))[:, None]


def onset_feat(y, sr=SR):
    o = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    return (o / (o.max() + 1e-9))[:, None]


# ---------------------------------------------------------------- DTW
def dtw(A, B, band_ratio=0.25):
    A, B = np.asarray(A, float), np.asarray(B, float)
    if A.ndim == 1:
        A = A[:, None]
    if B.ndim == 1:
        B = B[:, None]
    Ta, Tb = A.shape[0], B.shape[0]
    band = int(np.ceil(max(band_ratio * max(Ta, Tb), abs(Ta - Tb)))) + 1
    INF = 1e18
    C = np.full((Ta, Tb), INF)
    for i in range(Ta):
        c = i * (Tb - 1) / max(Ta - 1, 1)
        lo, hi = max(0, int(c - band)), min(Tb, int(c + band) + 1)
        C[i, lo:hi] = np.sum((A[i][None, :] - B[lo:hi, :]) ** 2, axis=1)
    acc = np.full((Ta, Tb), INF)
    back = np.zeros((Ta, Tb), np.int8)
    acc[0, 0] = C[0, 0]
    for i in range(Ta):
        for j in range(Tb):
            if (i == 0 and j == 0) or C[i, j] >= INF:
                continue
            best, arg = INF, -1
            if i and acc[i - 1, j] < best:
                best, arg = acc[i - 1, j], 0
            if j and acc[i, j - 1] < best:
                best, arg = acc[i, j - 1], 1
            if i and j and acc[i - 1, j - 1] < best:
                best, arg = acc[i - 1, j - 1], 2
            if arg >= 0:
                acc[i, j] = C[i, j] + best
                back[i, j] = arg
    if acc[Ta - 1, Tb - 1] >= INF:
        return float("inf"), []
    path, i, j = [], Ta - 1, Tb - 1
    while True:
        path.append((i, j))
        if i == 0 and j == 0:
            break
        b = back[i, j]
        i -= int(b in (0, 2))
        j -= int(b in (1, 2))
    path.reverse()
    return float(acc[Ta - 1, Tb - 1]) / len(path), path


# ---------------------------------------------------------------- 4축 거리
def axis_dist(y_ref, y_take, lag=True):
    """원본/테이크 → 축별 '거리'. 작을수록 원본과 비슷하다."""
    yr, yt = preprocess(y_ref), preprocess(y_take)
    if lag:
        yt, _ = align_lag(yr, yt)

    # 억양
    cr, vr = pitch_contour(yr)
    ct, vt = pitch_contour(yt)
    d, _ = dtw(_detrend(cr)[:, None], _detrend(ct)[:, None], 0.25)
    d_pitch = float(np.sqrt(max(d, 0.0)))

    # 리듬 (onset 타이밍 + 길이)
    d_on, _ = dtw(onset_feat(yr), onset_feat(yt), 0.25)
    dur = len(yt) / max(len(yr), 1)
    d_rhythm = float(np.sqrt(max(d_on, 0.0))) + 0.6 * abs(np.log(max(dur, 1e-6)))

    # 발음
    d_mf, _ = dtw(artic_feat(yr), artic_feat(yt), 0.25)
    d_artic = float(np.sqrt(max(d_mf, 0.0)))

    # 강세 (음량 엔벨로프 상관 → 거리로 변환)
    er, et = energy_feat(yr), energy_feat(yt)
    _, path = dtw(er, et, 0.25)
    ia = np.array([p[0] for p in path])
    ib = np.array([p[1] for p in path])
    a, b = er[ia, 0], et[ib, 0]
    corr = float(np.corrcoef(a, b)[0, 1]) if a.std() > 1e-9 and b.std() > 1e-9 else 0.0
    d_stress = float(np.clip(1.0 - max(0.0, corr), 0.0, 1.0))

    return {"pitch": d_pitch, "rhythm": d_rhythm, "artic": d_artic, "stress": d_stress,
            "dur_ratio": dur, "v_ratio": [round(vr, 3), round(vt, 3)]}


def calibrate(pool):
    """같은 화자·다른 문장 거리 분포 → 축별 (좋은 시도, 나쁜 시도, 변별력).

    '나쁜 시도'(wrong) = 그 분포의 중앙값. 문장이 완전히 다르면 이 정도 거리가 나온다.
    '좋은 시도'(good)  = 그 45%. 사람이 따라 말해 도달할 수 있는 현실적 하한으로 둔다.
    spread = p90/p10. 이 값이 작으면 축이 그 영상에서 변별력을 갖지 못한다(배경음악 등).
    """
    rows = []
    for a, b in pool:
        try:
            rows.append(axis_dist(a, b, lag=False))
        except Exception:
            continue
    if len(rows) < 3:
        return None
    out = {}
    for k in ("pitch", "rhythm", "artic", "stress"):
        v = np.array([r[k] for r in rows], float)
        p10, p50, p90 = (float(np.percentile(v, q)) for q in (10, 50, 90))
        p50 = max(p50, 1e-4)
        out[k] = (0.45 * p50, p50, p90 / max(p10, 1e-6))
    return out


# ---------------------------------------------------------------- 점수
def _map_score(d, d_good, d_wrong):
    """d=0 → 100, d_good → 90, d_wrong(다른 문장 수준) → 40, 그 이상은 지수 감쇠."""
    d_good = max(float(d_good), 1e-4)
    d_wrong = max(float(d_wrong), d_good * 1.25)
    if d <= d_good:
        return float(100.0 - 10.0 * min(1.0, d / d_good))
    t = (d - d_good) / (d_wrong - d_good)
    return float(90.0 * np.exp(-np.log(90.0 / 40.0) * t))


def _band(bands, k):
    b = (bands or {}).get(k) or DEFAULT_BANDS[k]
    if len(b) == 3:
        return b
    d_wrong = float(b[1])
    return (0.45 * d_wrong, d_wrong, 1.35)


def score(y_ref, y_take, sr=SR, bands=None):
    m = axis_dist(y_ref, y_take)

    raw, rel, used_w = {}, {}, {}
    for k in ("pitch", "rhythm", "artic", "stress"):
        good, wrong, spread = _band(bands, k)
        raw[k] = round(_map_score(m[k], good, wrong), 1)
        rel[k] = spread >= MIN_RANGE
        used_w[k] = W[k] * (1.0 if rel[k] else 0.20)

    tot_w = sum(used_w.values()) or 1.0
    total = sum(raw[k] * used_w[k] for k in raw) / tot_w

    return {
        "total": round(float(total), 1),
        "pitch": raw["pitch"], "rhythm": raw["rhythm"],
        "artic": raw["artic"], "stress": raw["stress"],
        "timbre": raw["artic"], "attack": raw["stress"],
        "mode": "acoustic",
        "raw": {k: round(float(m[k]), 3) for k in ("pitch", "rhythm", "artic", "stress")}
               | {"dur_ratio": round(m["dur_ratio"], 3), "v_ratio": m["v_ratio"]},
        "reliable": rel,
        "bands": {k: [round(x, 3) for x in _band(bands, k)] for k in raw},
        "weights": {k: round(used_w[k] / tot_w, 3) for k in raw},
    }


def score_duration_only(y_ref, y_take):
    """원본 음성이 없을 때: 길이 비교만."""
    try:
        yr, yt = preprocess(y_ref), preprocess(y_take)
    except ValueError:
        return {"total": 0.0, "mode": "timing", "raw": {"ratio": 0.0}}
    ratio = len(yt) / max(len(yr), 1)
    d = abs(np.log(max(ratio, 1e-6)))
    return {"total": round(float(100 * np.exp(-d / 0.55)), 1), "mode": "timing",
            "raw": {"ratio": round(ratio, 3), "dur_ref": round(len(yr) / SR, 2),
                    "dur_take": round(len(yt) / SR, 2)}}
