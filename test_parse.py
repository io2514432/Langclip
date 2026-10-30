"""자막 파서 + 타이밍 채점 단위 검증"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from main import parse_transcript, timing_score, yt_id
import numpy as np

CASES = {
    "SRT": """1
00:00:04,000 --> 00:00:07,500
Hi, can I get a latte please?

2
00:00:08,000 --> 00:00:11,500
Sure. What size
would you like?
""",
    "구간 표기": """0:04-0:07.5  Hi, can I get a latte please?
0:08-0:11.5  Sure. What size would you like?
0:12-0:15    Medium, please.
""",
    "시작만": """[0:04] Hi, can I get a latte please?
[0:08] Sure. What size would you like?
[0:12] Medium, please.
""",
    "시간 없음": """Hi, can I get a latte please?
Sure. What size would you like?
Medium, please.
For here.""",
    "콜론 시작만": """0:04 Hi there
0:09 How are you
""",
}

print("=== 자막 파서 ===")
for name, txt in CASES.items():
    segs = parse_transcript(txt, 20.0)
    print(f"\n[{name}] {len(segs)}문장")
    for s in segs[:5]:
        print(f"  {s['start']:>6.2f} – {s['end']:>6.2f}  {s['text'][:52]}")
    assert segs, f"{name}: 파싱 실패"
    for s in segs:
        assert s["end"] > s["start"], f"{name}: end<=start {s}"
        assert s["text"].strip(), f"{name}: 빈 텍스트"

print("\n=== yt_id ===")
for u in ["https://www.youtube.com/shorts/aqz-KE-bpKQ",
          "https://youtu.be/aqz-KE-bpKQ?t=12",
          "https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=x",
          "aqz-KE-bpKQ"]:
    print(f"  {u} -> {yt_id(u)}")

print("\n=== timing_score (원본 음원 없을 때) ===")
SR = 16000
rng = np.random.default_rng(0)
for mult, label in [(1.0, "정확히 같은 길이"), (1.5, "1.5배 길게"), (0.6, "0.6배 짧게")]:
    n = int(3.0 * SR * mult)
    y = (0.3 * np.sin(2 * np.pi * 180 * np.arange(n) / SR)).astype(np.float32)
    r = timing_score(y, 3.0)
    print(f"  {label:14s} total={r['total']:5.1f} mode={r['mode']} ratio={r['raw']['ratio']}")
print("\n모든 파서 검증 통과")
