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
D_PUNCT = 2            # 문장부호·대소문자 부정확 (쉼표 하나 빠지면 -2)
MAX_SENT_LOSS = 20     # 한 문장에서 깎이는 최대치 (= 문장 하나 빠뜨린 것과 동일)

CHUNK_RE = re.compile(r"([A-Za-z0-9']+)([.,!?;:]*)")
SPACE_RE = re.compile(r"\s+")


def _depunct(s: str) -> str:
    return (s or "").replace("\u2019", "'").replace("\u2018", "'")


def chunks_of(s: str) -> list:
    """단어 + 뒤따르는 문장부호를 한 덩어리로 자른다.  'Mother,' -> ['Mother', ',']"""
    return [[w, p] for w, p in CHUNK_RE.findall(_depunct(s))]


def words_of(s: str) -> list:
    return [w.lower() for w, _ in chunks_of(s)]


def norm(s: str) -> str:
    return SPACE_RE.sub(" ", " ".join(words_of(s))).strip()


def _align(aw, bw):
    """Exact LCS alignment. Returns runs of ("equal"|"miss"|"extra", [(i, j), ...])."""
    n, m = len(aw), len(bw)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        row, nxt = dp[i], dp[i + 1]
        ai = aw[i]
        for j in range(m - 1, -1, -1):
            if ai == bw[j]:
                row[j] = nxt[j + 1] + 1
            else:
                row[j] = nxt[j] if nxt[j] >= row[j + 1] else row[j + 1]

    runs = []

    def push(kind, pair):
        if runs and runs[-1][0] == kind:
            runs[-1][1].append(pair)
        else:
            runs.append([kind, [pair]])

    i = j = 0
    while i < n and j < m:
        if aw[i] == bw[j]:
            push("equal", (i, j)); i += 1; j += 1
        elif dp[i + 1][j] >= dp[i][j + 1]:
            push("miss", (i, -1)); i += 1
        else:
            push("extra", (-1, j)); j += 1
    while i < n:
        push("miss", (i, -1)); i += 1
    while j < m:
        push("extra", (-1, j)); j += 1
    return runs


def _pair_substitutions(runs):
    """Adjacent miss/extra runs are really one substitution -> report as 'wrong'."""
    out = []
    k = 0
    while k < len(runs):
        kind, items = runs[k]
        if kind in ("miss", "extra") and k + 1 < len(runs) and runs[k + 1][0] in ("miss", "extra") and runs[k + 1][0] != kind:
            other = runs[k + 1][1]
            pairs = min(len(items), len(other))
            if kind == "miss":
                subs = [(items[t][0], other[t][1]) for t in range(pairs)]
                rest_a = items[pairs:]
                rest_b = other[pairs:]
            else:
                subs = [(other[t][0], items[t][1]) for t in range(pairs)]
                rest_a = other[pairs:]
                rest_b = items[pairs:]
            out.append(["wrong", subs])
            if rest_a:
                out.append(["miss", rest_a])
            if rest_b:
                out.append(["extra", rest_b])
            k += 2
            continue
        out.append([kind, items])
        k += 1
    return out


def word_diff(answer: str, said: str) -> dict:
    """Word-by-word comparison with exact LCS alignment.

    A word inserted in the middle only counts once: the tokens after it line up
    again instead of cascading into a run of mismatches.
    Formatting (punctuation / capitalisation) on an otherwise matching word
    costs one 'mark'.
    """
    a, b = chunks_of(answer), chunks_of(said)
    aw = [w.lower() for w, _ in a]
    bw = [w.lower() for w, _ in b]
    mine, ans = [], []
    miss = wrong = extra = mark = 0

    if not aw:
        return {"mine": [], "ans": [], "miss": 0, "wrong": 0, "extra": 0,
                "mark": 0, "blank": True}
    if not bw:
        for w, p in a:
            ans.append(["miss", w + p])
        return {"mine": [], "ans": ans, "miss": len(a), "wrong": 0, "extra": 0,
                "mark": 0, "blank": True}

    for kind, items in _pair_substitutions(_align(aw, bw)):
        if kind == "equal":
            for i, j in items:
                wa, pa = a[i]
                wb, pb = b[j]
                if wa == wb and pa == pb:
                    mine.append(["ok", wb + pb])
                    ans.append(["ok", wa + pa])
                else:
                    mark += 1
                    mine.append(["mark", wb + pb])
                    ans.append(["mark", wa + pa])
        elif kind == "wrong":
            for i, j in items:
                wa, pa = a[i]
                wb, pb = b[j]
                mine.append(["wrong", wb + pb]); wrong += 1
                ans.append(["wrong", wa + pa])
        elif kind == "miss":
            for i, _j in items:
                wa, pa = a[i]
                ans.append(["miss", wa + pa]); miss += 1
        else:
            for _i, j in items:
                wb, pb = b[j]
                mine.append(["extra", wb + pb]); extra += 1

    return {"mine": mine, "ans": ans, "miss": miss, "wrong": wrong,
            "extra": extra, "mark": mark, "blank": False}


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
                         "mine": [], "ans": [], "punct": 0})
            continue
        d = word_diff(en, said)
        if d["blank"]:
            lost = D_MISS_SENT
            totals["blank"] += 1
        else:
            lost = (d["miss"] * D_MISS_WORD + d["wrong"] * D_WRONG_WORD +
                    d["extra"] * D_EXTRA_WORD + d["mark"] * D_PUNCT)
            totals["miss"] += d["miss"]; totals["wrong"] += d["wrong"]
            totals["extra"] += d["extra"]; totals["punct"] += d["mark"]
        lost = min(lost, MAX_SENT_LOSS)      # 한 문장이 점수를 다 먹지 않게
        if lost == 0:
            clean += 1
        lost_total += lost
        rows.append({"i": i, "lost": lost, "answer": en, "said": said.strip()[:300],
                     "mine": d["mine"], "ans": d["ans"], "punct": d["mark"]})

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
