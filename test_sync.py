"""싱크(탭 타이밍) 기능 검증

1) 대본 붙여넣기 → 문장 분리 (라벨/무라벨/한영교차/한줄 표기/불릿/타임코드 제거)
2) 경계 시각 → 문장 구간 결합
3) 마크다운 생성 + 재파싱 왕복
4) /api/sync/split, /api/sync/apply (신규 생성 / 기존 교체)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
os.environ.setdefault("ECHO_STORAGE", "local")
# 테스트는 실제 학습 데이터를 건드리지 않는다
os.environ["LANGCLIP_DATA"] = tempfile.mkdtemp(prefix="langclip-test-")

import synclib
import script_md
import main

ok = 0


def t(name, cond, extra=""):
    global ok
    if not cond:
        print(f"  ✗ {name} {extra}")
        raise AssertionError(name)
    ok += 1
    print(f"  ✓ {name}{(' ' + extra) if extra else ''}")


# ---------------------------------------------------------------- 1) 분리
raw = """Hi, can I get a latte please?
라떼 한 잔 주세요.
- Sure. What size would you like?
- 네, 어떤 사이즈로 드릴까요?
0:12-0:15  Medium, please. For here.
중간 사이즈로 주세요.
"""
items = synclib.split_transcript(raw)
t("한영 교차 자동 페어링", len(items) == 3, f"{len(items)}문장")
t("영어 유지", items[0]["en"] == "Hi, can I get a latte please?")
t("한국어 붙음", items[0]["ko"] == "라떼 한 잔 주세요.")
t("불릿 제거", items[1]["en"] == "Sure. What size would you like?")
t("타임코드 제거", items[2]["en"] == "Medium, please. For here.", items[2]["en"])

lab = synclib.split_transcript("EN: Good morning.\nKO: 좋은 아침입니다.\nEN: How are you?\nKO: 어떻게 지내세요?")
t("EN:/KO: 라벨", len(lab) == 2 and lab[0]["ko"] == "좋은 아침입니다.", lab[0]["ko"])

one = synclib.split_transcript("Hi there / 안녕하세요")
t("한 줄 표기", len(one) == 1 and one[0]["ko"] == "안녕하세요")

long_en = synclib.split_transcript("I went to the store. Then I bought a coffee. It was good.", True)
t("긴 영어 문장 분할", len(long_en) >= 2, f"{len(long_en)}개")
no_split = synclib.split_transcript("I went to the store. Then I bought a coffee. It was good.", False)
t("분할 끄기", len(no_split) == 1)

# ---------------------------------------------------------------- 2) 결합
b = [4.0, 7.5, 11.5, 15.0]
sents = synclib.bounds_to_sentences(items, b)
t("경계→구간 수", len(sents) == 3)
t("1번 구간", (sents[0]["start"], sents[0]["end"]) == (4.0, 7.5))
t("3번 구간", (sents[2]["start"], sents[2]["end"]) == (11.5, 15.0))
t("text=영어 하위호환", sents[0]["text"] == sents[0]["en"])

# ---------------------------------------------------------------- 3) 마크다운
md = synclib.to_markdown("카페 주문", "aqz-KE-bpKQ", sents, 24)
sc = script_md.parse(md, 0)
t("마크다운 재파싱", len(sc.segs) == 3, f"{len(sc.segs)}문장")
t("시간 보존", abs(sc.segs[0].start - 4.0) < 1e-9 and abs(sc.segs[1].end - 11.5) < 1e-9)
t("KO 보존", sc.segs[2].ko == "중간 사이즈로 주세요.", sc.segs[2].ko)
t("검증 경고 없음", synclib.validate(sents, 24) == [], str(synclib.validate(sents, 24)))

bad = [{"start": 5.0, "end": 3.0, "en": "a"}, {"start": 2.0, "end": 9.0, "en": ""}]
w = synclib.validate(bad, 10)
t("오류 검출(역전/겹침/빈문장)", len(w) >= 3, str(w))

# ---------------------------------------------------------------- 4) API
tmp = Path(tempfile.mkdtemp(prefix="echo-sync-"))
main.DB = tmp / "videos.json"
main.save_db({"videos": {}, "audios": {}})
import progress as prog
prog.ATTEMPTS = tmp / "attempts.json"
prog.NOTES = tmp / "notes.json"
prog.WCACHE = tmp / "wc.json"
prog.DATA = tmp

from fastapi.testclient import TestClient
c = TestClient(main.app)

r = c.post("/api/sync/split", json={"text": raw, "split_sentences": False}).json()
t("API split", len(r["items"]) == 3, f"{len(r['items'])}개")

ap = c.post("/api/sync/apply", json={
    "url": "https://www.youtube.com/shorts/aqz-KE-bpKQ",
    "title": "카페 주문",
    "sentences": sents,
}).json()
t("API apply → 영상 생성", ap["ok"] and len(ap["segs"]) == 3, ap["video"]["id"])
t("apply 마크다운 반환", "@yt aqz-KE-bpKQ" in ap["markdown"])
vid = ap["video"]["id"]
v = c.get("/api/videos/" + vid).json()
t("저장된 구간 확인", (v["segs"][0]["start"], v["segs"][0]["end"]) == (4.0, 7.5))
t("한국어 저장", v["segs"][0]["ko"] == "라떼 한 잔 주세요.")

# 기존 영상 교체
sents2 = [
    {"start": 0.0, "end": 2.5, "en": "First line.", "ko": "첫 줄."},
    {"start": 2.5, "end": 5.0, "en": "Second line.", "ko": "둘째 줄."},
]
ap2 = c.post("/api/sync/apply", json={"url": "", "vid": vid, "sentences": sents2}).json()
t("기존 영상 교체", len(ap2["segs"]) == 2 and ap2["video"]["id"] == vid)
t("교체 후 조회", len(c.get("/api/videos/" + vid).json()["segs"]) == 2)

# 마크다운 직접 전달도 반영
ap3 = c.post("/api/sync/apply", json={
    "url": "", "vid": vid,
    "sentences": [{"start": 9.0, "end": 9.0, "en": "x"}],
    "markdown": "## 0:01-0:02.5\nEN: Edited by hand.\nKO: 손으로 고침.\n",
}).json()
t("markdown 직접 반영", ap3["segs"][0]["en"] == "Edited by hand.", ap3["segs"][0]["en"])

print(f"\n싱크 기능 검증 {ok}개 항목 통과")
