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
D_PUNCT = 2            # 문장부호 누락·오추가 (쉼표 하나 빠지면 -2)
MAX_SENT_LOSS = 20     # 한 문장에서 깎이는 최대치 (= 문장 하나 빠뜨린 것과 동일)

WORD_RE = re.compile(r"[a-z0-9']+")
PUNCT_RE = re.compile(r"[.,!?;:]")
SPACE_RE = re.compile(r"\s+")


def _clean(s: str) -> str:
    return (s or "").lower().replace("\u2019", "'").replace("\u2018", "'")


def words_of(s: str) -> list[str]:
    return WORD_RE.findall(_clean(s))


def punct_of(s: str) -> list[str]:
    return PUNCT_RE.findall(_clean(s))


def norm(s: str) -> str:
    return SPACE_RE.sub(" ", " ".join(words_of(s))).strip()


def punct_diff(answer: str, said: str) -> int:
    """문장부호만 따로 비교한다. 다르게 찍은 개수만큼 감점."""
    a, b = punct_of(answer), punct_of(said)
    if a == b:
        return 0
    n = 0
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != "equal":
            n += max(i2 - i1, j2 - j1)
    return n


def word_diff(answer: str, said: str) -> dict:
    """단어 1:1 대조.

    LCS(SequenceMatcher)로 최장 일치 구간을 먼저 붙잡기 때문에, 중간에 단어가
    끼어들거나 순서가 살짝 밀려도 뒤쪽 단어는 다시 정상 매칭된다.
    (예: 'you are the love' → 'the'만 추가로 잡히고 'love'는 그대로 맞음)
    """
    a, b = words_of(answer), words_of(said)
    tokens, miss, wrong, extra = [], 0, 0, 0
    if not a:
        return {"tokens": [], "miss": 0, "wrong": 0, "extra": 0, "blank": True}
    if not b:
        return {"tokens": [["miss", w] for w in a], "miss": len(a), "wrong": 0,
                "extra": 0, "blank": True}
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            for w in a[i1:i2]:
                tokens.append(["ok", w])
        elif op == "delete":                      # 정답에만 있음 = 빠뜨림
            for w in a[i1:i2]:
                tokens.append(["miss", w]); miss += 1
        elif op == "insert":                      # 답안에만 있음 = 덧붙임
            for w in b[j1:j2]:
                tokens.append(["extra", w]); extra += 1
        else:                                     # replace
            pair = min(i2 - i1, j2 - j1)
            for k in range(pair):
                tokens.append(["wrong", b[j1 + k]]); wrong += 1
            for w in a[i1 + pair:i2]:
                tokens.append(["miss", w]); miss += 1
            for w in b[j1 + pair:j2]:
                tokens.append(["extra", w]); extra += 1
    return {"tokens": tokens, "miss": miss, "wrong": wrong, "extra": extra, "blank": False}


def check_recall(segs: list[dict], typed: dict) -> dict:
    """백지 테스트 = 전체 100점 만점 채점. 0점 아래로는 내려가지 않는다."""
    rows = []
    totals = {"blank": 0, "miss": 0, "wrong": 0, "extra": 0, "punct": 0}
    lost_total = 0
    clean = 0
    for i, s in enumerate(segs):
        en = (s.get("en") or s.get("text") or "").strip()
        said = str((typed or {}).get(i, "") or (typed or {}).get(str(i), "") or "")
        if not en:
            rows.append({"i": i, "lost": 0, "answer": "", "said": said.strip()[:300],
                         "tokens": [], "punct": 0})
            continue
        d = word_diff(en, said)
        pd = 0 if d["blank"] else punct_diff(en, said)
        if d["blank"]:
            lost = D_MISS_SENT
            totals["blank"] += 1
        else:
            lost = (d["miss"] * D_MISS_WORD + d["wrong"] * D_WRONG_WORD +
                    d["extra"] * D_EXTRA_WORD + pd * D_PUNCT)
            totals["miss"] += d["miss"]; totals["wrong"] += d["wrong"]
            totals["extra"] += d["extra"]; totals["punct"] += pd
        lost = min(lost, MAX_SENT_LOSS)      # 한 문장이 점수를 다 먹지 않게
        if lost == 0:
            clean += 1
        lost_total += lost
        rows.append({"i": i, "lost": lost, "answer": en, "said": said.strip()[:300],
                     "tokens": d["tokens"], "punct": pd})

    total = len([r for r in rows if r["answer"]])
    score = max(0, 100 - lost_total)
    return {
        "passed": bool(total) and score >= PASS_SCORE,
        "score": score,
        "lost": lost_total,
        "hit": clean,
        "total": total,
        "rows": rows,
        "need": PASS_SCORE,
        "detail": totals,
    }


def judge(segs: list[dict], typed) -> dict:
    c = check_recall(segs, typed or {})
    return {
        "passed": bool(c["passed"]),
        "stages": {"recall": c},
        "score": c["score"],
        "failed_sentences": [r["i"] for r in sorted(c["rows"], key=lambda x: -x["lost"])
                             if r["lost"] > 0],
        "headline": "학습 완료" if c["passed"] else "백지 테스트 미달",
    }
