"""Langclip — 백지 테스트(전체 타이핑) 채점

한국어만 보고 영어 문장을 처음부터 끝까지 타이핑한다.
100점에서 틀린 만큼 깎고, 0점 아래로는 내려가지 않는다.

  문장 통째로 비움  -20  (문장당 감점 상한)
  단어 빠뜨림       -5
  단어 덧붙임       -5
  단어 오답         -5

90점 이상이면 통과. 타이핑 채점은 결정적(항상 같은 결과)이라 기기·브라우저 편차가 없다.
"""
from __future__ import annotations

import difflib
import re

# ---- 백지 테스트(전체 타이핑) 채점 -------------------------------------
# 100점에서 시작해 틀린 만큼 깎는다. 0점 아래로는 내려가지 않는다.
PASS_SCORE = 90        # 이 점수 이상이면 통과
D_MISS_SENT = 20       # 문장을 통째로 비움 (문장당 감점 상한)
D_MISS_WORD = 5        # 답안에 있어야 할 단어를 빠뜨림
D_WRONG_WORD = 5       # 단어를 다른 단어로 씀 (빠뜨림·덧붙임과 동일)
D_EXTRA_WORD = 5       # 원문에 없는 단어를 덧붙임 (빠뜨린 단어와 동일)
MAX_SENT_LOSS = 20     # 한 문장에서 깎이는 최대치 (= 문장 하나 빠뜨린 것과 동일)

PUNCT = re.compile(r"[^\w\s'’-]")
SPACE = re.compile(r"\s+")


def norm(s: str) -> str:
    s = (s or "").lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = PUNCT.sub(" ", s)
    return SPACE.sub(" ", s).strip()


def ratio(a: str, b: str) -> float:
    na, nb = norm(a), norm(b)
    if not na and not nb:
        return 1.0
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


def pct(a: str, b: str) -> int:
    """0~100 유사도. 관사 하나·시제 하나 틀렸다고 0점이 되지 않도록
    글자 유사도(45%) + 단어 일치율(55%)로 부분점수를 준다."""
    A, B = norm(a), norm(b)
    if A == B:
        return 100
    if not A:
        return 0
    base = 100.0 * ratio(a, b)
    wa, wb = A.split(), B.split()
    pool = list(wb)
    hit = 0
    for w in wa:
        if w in pool:
            pool.remove(w)
            hit += 1
    wordpct = 100.0 * hit / max(1, len(wa))
    return int(round(0.45 * base + 0.55 * wordpct))

# ---------------------------------------------------------------- 1) 가림 낭독
# ---------------------------------------------------------------- 2) 가림 복창
def word_diff(answer: str, said: str) -> dict:
    """단어 단위로 비교해 감점을 계산한다.
    빠뜨린 단어 5점 · 틀린 단어 2점 · 덧붙인 단어 1점."""
    a = norm(answer).split()
    b = norm(said).split()
    if not b:
        return {"miss": len(a), "wrong": 0, "extra": 0, "blank": True}
    sm = difflib.SequenceMatcher(None, a, b)
    miss = wrong = extra = 0
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        la, lb = i2 - i1, j2 - j1
        if op == "equal":
            continue
        if op == "delete":
            miss += la
        elif op == "insert":
            extra += lb
        else:                      # replace
            pair = min(la, lb)
            wrong += pair
            miss += la - pair
            extra += lb - pair
    return {"miss": miss, "wrong": wrong, "extra": extra, "blank": False}


def check_recall(segs: list[dict], typed: dict) -> dict:
    """백지 테스트 = 문장별이 아니라 전체 100점 만점으로 채점한다."""
    rows, clean = [], 0
    totals = {"miss": 0, "wrong": 0, "extra": 0, "blank": 0}
    lost_total = 0
    for i, s in enumerate(segs):
        en = (s.get("en") or s.get("text") or "").strip()
        said = str((typed or {}).get(i, "") or (typed or {}).get(str(i), "") or "")
        if not en:
            rows.append({"i": i, "lost": 0, "answer": "", "said": said.strip()[:200],
                         "miss": 0, "wrong": 0, "extra": 0})
            continue
        d = word_diff(en, said)
        if d["blank"]:
            lost = D_MISS_SENT
            totals["blank"] += 1
            miss, wrong, extra = len(norm(en).split()), 0, 0
        else:
            lost = d["miss"] * D_MISS_WORD + d["wrong"] * D_WRONG_WORD + d["extra"] * D_EXTRA_WORD
            miss, wrong, extra = d["miss"], d["wrong"], d["extra"]
            totals["miss"] += miss
            totals["wrong"] += wrong
            totals["extra"] += extra
        lost = min(lost, MAX_SENT_LOSS)      # 한 문장이 점수를 다 먹지 않게
        if lost == 0:
            clean += 1
        lost_total += lost
        rows.append({"i": i, "lost": lost, "answer": en, "said": said.strip()[:200],
                     "miss": miss, "wrong": wrong, "extra": extra})
    total = len([r for r in rows if r["answer"]])
    score = max(0, 100 - lost_total)
    passed = bool(total) and score >= PASS_SCORE
    return {
        "passed": passed,
        "score": score,
        "lost": lost_total,
        "hit": clean,
        "total": total,
        "rows": rows,
        "need": PASS_SCORE,
        "detail": {"blank": totals["blank"], "miss": totals["miss"],
                   "wrong": totals["wrong"], "extra": totals["extra"]},
    }


# ---------------------------------------------------------------- 3) 스팟 체크
# ---------------------------------------------------------------- 통합
def judge(segs: list[dict], typed) -> dict:
    c = check_recall(segs, typed or {})
    passed = bool(c["passed"])
    fails = [row["i"] for row in sorted(c["rows"], key=lambda x: -x.get("lost", 0))
             if row.get("lost", 0) > 0][:5]
    return {
        "passed": passed,
        "stages": {"recall": c},
        "score": c["score"],
        "failed_sentences": fails,
        "headline": "학습 완료" if passed else "백지 테스트 미달",
    }
