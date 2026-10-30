"""데모 데이터 시드

- data/videos.json : {"videos": {...}, "audios": {...}}
- data/media/audios/ademo0001.wav : 서버 보관 원본 음원(합성 데모)
  * vdemo0001 -> 오디오 연결됨 (4축 음향 채점)
  * vdemo0002 -> 오디오 없음 (타이밍 채점)
"""
import json
from pathlib import Path

import numpy as np
import soundfile as sf

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
MEDIA = DATA / "media" / "audios"
MEDIA.mkdir(parents=True, exist_ok=True)
SR = 16000

SEGS_A = [
    (4.0, 7.5, "Hi, can I get a latte please?"),
    (8.0, 11.5, "Sure. What size would you like?"),
    (12.0, 15.0, "Medium, please. For here."),
    (16.0, 20.0, "That'll be six fifty. Card or cash?"),
]
SEGS_B = [
    (1.0, 4.2, "Let's get started with the agenda."),
    (5.0, 8.6, "First, we review last week's numbers."),
    (9.5, 13.0, "Then we'll talk about the timeline."),
]


def synth(total=24.0) -> np.ndarray:
    """구간마다 피치가 흔들리는 톤 버스트 = 억양 데모용 합성 음성"""
    n = int(total * SR)
    y = np.zeros(n, dtype=np.float32)
    rng = np.random.default_rng(7)
    for k, (s, e, _) in enumerate(SEGS_A):
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
    return 0.8 * y / max(1e-6, np.max(np.abs(y)))


def main() -> None:
    wav = MEDIA / "ademo0001.wav"
    if not wav.exists():
        sf.write(str(wav), synth(), SR, subtype="PCM_16")
    dur = round(len(sf.read(str(wav), dtype="float32")[0]) / SR, 2)

    db = {
        "videos": {
            "vdemo0001": {
                "id": "vdemo0001", "yt": "aqz-KE-bpKQ",
                "title": "데모 A · 원본 음원 연결됨",
                "thumb": "https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg",
                "audio_id": "ademo0001",
                "segs": [{"i": i, "start": s, "end": e, "text": t}
                         for i, (s, e, t) in enumerate(SEGS_A)],
            },
            "vdemo0002": {
                "id": "vdemo0002", "yt": "aqz-KE-bpKQ",
                "title": "데모 B · 오디오 미연결(타이밍 채점)",
                "thumb": "https://i.ytimg.com/vi/aqz-KE-bpKQ/mqdefault.jpg",
                "audio_id": None,
                "segs": [{"i": i, "start": s, "end": e, "text": t}
                         for i, (s, e, t) in enumerate(SEGS_B)],
            },
        },
        "audios": {
            "ademo0001": {
                "id": "ademo0001", "key": "audios/ademo0001.wav",
                "title": "데모 원본 음원 (합성)", "dur": dur, "offset": 0.0,
                "source": "owned", "license": "self-recorded demo",
                "mime": "audio/wav",
            },
        },
    }
    (DATA / "videos.json").write_text(json.dumps(db, ensure_ascii=False, indent=1), "utf-8")
    print(f"시드 완료: 영상 2개 / 오디오 1개 ({dur}s) -> {DATA / 'videos.json'}")


if __name__ == "__main__":
    main()
