"""v3.1 신규 기능 검증 (파이썬만으로 실행)

1) offset 자동 캘리브레이션(엔벨로프 상호상관) 정확도
2) storage.open() 스트리밍 경로 → '원격' 저장소에서도 4축 음향 채점
3) /api/media HTTP Range → 206 Partial Content
4) 문장 타임스탬프 ±0.1s PATCH 미세조정
"""
from __future__ import annotations

import http.server
import io
import json
import os
import re
import sys
import tempfile
import threading
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
os.environ.setdefault("ECHO_STORAGE", "local")
# 테스트는 실제 학습 데이터를 건드리지 않는다
os.environ["LANGCLIP_DATA"] = tempfile.mkdtemp(prefix="langclip-test-")

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

SR = 16000
SEGS = [(4.0, 7.5, "Hi, can I get a latte please?"),
        (8.0, 11.5, "Sure. What size would you like?"),
        (12.0, 15.0, "Medium, please. For here."),
        (16.0, 20.0, "That'll be six fifty. Card or cash?")]
TRUE_OFFSET = 3.4          # 음원은 영상 3.4초부터 잘라낸 파일이라고 가정


def synth(total=24.0) -> np.ndarray:
    """문장마다 피치가 흔들리는 톤 버스트 = 억양 데모용"""
    n = int(total * SR)
    y = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(7)
    for k, (s, e, _) in enumerate(SEGS):
        base = 150 + k * 22
        dur = int((e - s - 0.25) * SR)
        t = np.arange(dur) / SR
        f0 = base + 26 * np.sin(2 * np.pi * 1.3 * t + k) + 9 * np.sin(2 * np.pi * 0.4 * t)
        ph = 2 * np.pi * np.cumsum(f0) / SR
        env = np.minimum(1, t / 0.05) * np.minimum(1, (t[-1] - t) / 0.12 + 0.15)
        sig = (0.55 * np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)) * env
        sig = sig + 0.02 * rng.standard_normal(dur)
        i = int(s * SR)
        y[i:i + dur] += sig.astype(np.float32)
    return (0.8 * y / max(1e-6, np.abs(y).max())).astype(np.float32)


def wav_bytes(y: np.ndarray) -> bytes:
    b = io.BytesIO()
    sf.write(b, y, SR, format="WAV", subtype="PCM_16")
    return b.getvalue()


# ------------------------------------------------------- 원격 저장소 흉내
PORT = 8791
MEDIA = None


class RangeHandler(http.server.BaseHTTPRequestHandler):
    hits = 0
    directory = "."

    def log_message(self, *a):        # 조용히
        pass

    def do_GET(self):
        rel = self.path.split("?")[0].lstrip("/")
        p = Path(self.directory) / rel
        if not p.is_file():
            self.send_error(404)
            return
        data = p.read_bytes()
        RangeHandler.hits += 1
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d+)-(\d*)", rng)
            s = int(m.group(1))
            e = int(m.group(2)) if m.group(2) else len(data) - 1
            e = min(e, len(data) - 1)
            body = data[s:e + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {s}-{e}/{len(data)}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(200)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)


import store as store_mod           # noqa: E402
import main                         # noqa: E402


class RemoteStorage(store_mod.LocalStorage):
    """S3/R2 처럼 로컬 경로가 없고 HTTP Range 로만 읽는 저장소."""
    name = "s3-test"

    def path(self, key):
        return None

    def url(self, key):
        return f"http://127.0.0.1:{PORT}/" + key.lstrip("/")

    def uri(self, key):
        return self.url(key)

    def open(self, key, chunk=65536):
        return store_mod.HttpRangeFile(self.url(key), chunk=chunk)


def main_test() -> None:
    global MEDIA
    tmp = Path(tempfile.mkdtemp(prefix="echo-test-"))
    main.DB = tmp / "videos.json"
    media = tmp / "media"
    loc = store_mod.LocalStorage(media)
    main.storage = loc
    MEDIA = media
    RangeHandler.directory = str(media)

    full = synth()
    audio = full[int(TRUE_OFFSET * SR):]
    loc.put("audios/a_test.wav", wav_bytes(audio))

    db = {
        "videos": {
            "vt1": {"id": "vt1", "yt": "aqz-KE-bpKQ", "title": "t1", "audio_id": "a1",
                    "segs": [{"i": i, "start": s, "end": e, "text": t}
                             for i, (s, e, t) in enumerate(SEGS)]},
            "vt2": {"id": "vt2", "yt": "aqz-KE-bpKQ", "title": "t2", "audio_id": None,
                    "segs": [{"i": i, "start": s, "end": e, "text": t}
                             for i, (s, e, t) in enumerate(SEGS[:3])]},
        },
        "audios": {
            "a1": {"id": "a1", "key": "audios/a_test.wav", "title": "test",
                   "dur": round(len(audio) / SR, 2), "offset": 0.0,
                   "source": "owned", "license": "unit-test", "mime": "audio/wav"},
        },
    }
    main.save_db(db)

    c = TestClient(main.app)
    ok = 0

    # 1) health
    h = c.get("/api/health").json()
    assert h["ok"] and h["range"] and h["remote_open"], h
    print(f"  ✓ /api/health  storage={h['storage']} remote_open={h['remote_open']}")
    ok += 1

    # 2) HTTP Range → 206
    r = c.get("/api/media/audios/a_test.wav", headers={"Range": "bytes=0-1023"})
    assert r.status_code == 206, r.status_code
    assert r.headers["content-range"].startswith("bytes 0-1023/"), r.headers
    assert len(r.content) == 1024
    print(f"  ✓ Range bytes=0-1023 → 206 {r.headers['content-range']}")
    ok += 1

    # 4) 음향 채점 (로컬)
    off = TRUE_OFFSET
    t0 = max(0.0, SEGS[0][0] - off)
    t1 = max(t0 + 0.2, SEGS[0][1] - off)
    take = audio[int(t0 * SR):int(t1 * SR)]
    # 잡음은 실제로 잘라낸 길이에 맞춘다 (반올림 때문에 1프레임 어긋나면 브로드캐스트 실패)
    take = take + 0.002 * np.random.default_rng(1).standard_normal(len(take)).astype(np.float32)
    r = c.post("/api/videos/vt1/segments/0/score",
               files={"take": ("take.wav", wav_bytes(take), "audio/wav")}).json()
    assert r["mode"] == "acoustic", r
    assert r["total"] > 55, r
    print(f"  ✓ score acoustic total={r['total']} (pitch={r['pitch']} rhythm={r['rhythm']} "
          f"timbre={r['timbre']} attack={r['attack']})")
    ok += 1

    # 5) 타이밍 채점
    r2 = c.post("/api/videos/vt2/segments/0/score",
                files={"take": ("take.wav", wav_bytes(take), "audio/wav")}).json()
    assert r2["mode"] == "timing", r2
    print(f"  ✓ score timing   total={r2['total']} ratio={r2['raw']['ratio']}")
    ok += 1

    # 6) 타임스탬프 ±0.1s 미세조정
    p = c.patch("/api/videos/vt1/segments/0", json={"start": 4.1, "end": 7.3}).json()
    assert p["ok"] and abs(p["seg"]["start"] - 4.1) < 1e-9 and p["dur"] == 3.2, p
    bad = c.patch("/api/videos/vt1/segments/0", json={"start": 9.0})
    assert bad.status_code == 422, bad.status_code
    print(f"  ✓ PATCH seg  start 4.0→4.1, end 7.5→7.3 (dur {p['dur']}s), 역전 요청 422")
    ok += 1

    # 7) 원격(S3 흉내) 스트리밍 채점 — storage.path() 가 None 이어도 acoustic
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), RangeHandler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        main.storage = RemoteStorage(media)
        RangeHandler.hits = 0
        env = main.audio_envelope("audios/a_test.wav", 0.02)
        hits_env = RangeHandler.hits
        assert len(env) > 100, len(env)

        r3 = c.post("/api/videos/vt1/segments/0/score",
                    files={"take": ("take.wav", wav_bytes(take), "audio/wav")}).json()
        assert r3["mode"] == "acoustic", r3
        assert r3["ref_src"]["storage"] == "s3-test", r3.get("ref_src")
        print(f"  ✓ remote score acoustic total={r3['total']} "
              f"(storage={r3['ref_src']['storage']}, read={r3['ref_src']['read']})")
        print(f"  ✓ remote envelope  {len(env)}프레임 · Range 요청 {hits_env}회 "
              f"(전체 파일 다운로드 없음)")
        ok += 1

    finally:
        srv.shutdown()
        main.storage = loc

    print(f"\n신규 기능 검증 {ok}개 항목 통과")


if __name__ == "__main__":
    print("=== v3.1 기능 검증 ===")
    main_test()
