"""Langclip — 학습 완료 검증 (3단계 교차 검증)

왜 3단계인가
  셰도잉 점수만으로는 '암기'를 증명하지 못한다. 영어가 화면에 보이면 그대로 읽어도
  높은 점수가 나오기 때문이다. 그래서 검증을 세 축으로 나눈다.

  1) 가림 낭독(read)   : 영어 자막을 숨기고 한국어만 보고 말한다 → 발음·억양·유창성
  2) 가림 복창(recall) : 한국어만 보고 영어 문장을 직접 타이핑한다 → 내용 암기
  3) 스팟 체크(spot)   : 무작위 3문장을 첫 글자 힌트만 보고 타이핑한다 → 부분 암기 방지

  세 단계를 모두 통과해야 '학습 완료'. 타이핑 채점은 결정적(항상 같은 결과)이라
  브라우저·기기 편차가 없다.
"""
from __future__ import annotations

import difflib
import hashlib
import random
import re

# ---- 백지 테스트(전체 타이핑) 채점 -------------------------------------
# 100점에서 시작해 틀린 만큼 깎는다. 0점 아래로는 내려가지 않는다.
PASS_SCORE = 90        # 이 점수 이상이면 통과
D_MISS_SENT = 20       # 문장을 통째로 비움 (문장당 감점 상한)
D_MISS_WORD = 5        # 답안에 있어야 할 단어를 빠뜨림
D_WRONG_WORD = 2       # 단어를 다른 단어로 씀
D_EXTRA_WORD = 5       # 원문에 없는 단어를 덧붙임 (빠뜨린 단어와 동일)
MAX_SENT_LOSS = 20     # 한 문장에서 깎이는 최대치 (= 문장 하나 빠뜨린 것과 동일)

READ_MIN_AVG = 60      # 가림 낭독: 전체 평균
READ_MIN_ONE = 25      # 가림 낭독: 문장 최저(아예 안 읽은 것 배제)
RECALL_PASS = 90       # 가림 복창: 문장별 유사도(%)
SPOT_PASS = 85         # 스팟 체크: 문장별 유사도(%)
SPOT_K = 3

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

def hint_of(text: str) -> str:
    """첫 글자 힌트: 'Hi, can I get a latte please?' → 'H, c I g a l p?'"""
    out = []
    for w in (text or "").split(" "):
        core = re.sub(r"[^\w'’-]", "", w)
        if not core:
            out.append(w)
            continue
        out.append(core[0] + re.sub(r"[\w'’-]", "", w))
    return " ".join(out)


def spot_pick(vid: str, n: int, k: int = SPOT_K, salt: str = "") -> list[int]:
    """무작위 스팟 문장 고르기 (문장 수가 적으면 전부)."""
    if n <= 0:
        return []
    k = min(max(1, k), n)
    seed = int(hashlib.md5(f"{vid}:{salt}:{n}".encode()).hexdigest(), 16) % 10 ** 9
    rnd = random.Random(seed)
    idx = list(range(n))
    rnd.shuffle(idx)
    return sorted(idx[:k])


# ---------------------------------------------------------------- 1) 가림 낭독
def check_read(scores: list[int], n_segs: int) -> dict:
    sc = [int(round(float(x))) for x in (scores or [])]
    if n_segs <= 0:
        return {"passed": False, "avg": 0, "n": 0, "note": "문장이 없습니다"}
    if len(sc) != n_segs:
        return {"passed": False, "avg": 0, "n": len(sc),
                "note": f"문장 {n_segs}개 중 {len(sc)}개만 기록되었습니다"}
    avg = round(sum(sc) / len(sc), 1)
    low = min(sc)
    passed = avg >= READ_MIN_AVG and low >= READ_MIN_ONE
    return {"passed": passed, "avg": avg, "low": low, "n": len(sc),
            "need_avg": READ_MIN_AVG, "need_low": READ_MIN_ONE, "scores": sc}


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
def check_spot(segs: list[dict], idx: list[int], typed: dict) -> dict:
    rows, ok = [], 0
    for i in (idx or []):
        if not (0 <= int(i) < len(segs)):
            continue
        s = segs[int(i)]
        en = (s.get("en") or s.get("text") or "").strip()
        said = str((typed or {}).get(int(i), "") or (typed or {}).get(str(i), "") or "")
        score = pct(en, said)
        good = bool(en) and score >= SPOT_PASS
        ok += 1 if good else 0
        rows.append({"i": int(i), "score": score, "pass": good, "answer": en,
                     "said": said.strip()[:200]})
    total = len(rows)
    return {"passed": bool(total) and ok == total, "hit": ok, "total": total,
            "rows": rows, "need": SPOT_PASS, "idx": [r["i"] for r in rows]}


# ---------------------------------------------------------------- 통합
def _weighted_score(r, c, s) -> int:
    recall = c.get("score", 0)
    parts, w = [(recall, 1.0)], 1.0
    if r:
        parts.append((r.get("avg") or 0, 0.4)); w += 0.4
    if s:
        parts.append((100 * s["hit"] / max(1, s["total"]), 0.3)); w += 0.3
    return int(round(sum(x * k for x, k in parts) / w))


def judge(segs: list[dict], read_scores, typed, spot_idx, spot_typed) -> dict:
    # v4.7: 백지 테스트(전체 타이핑) 단일 단계. 넘겨받은 단계만 판정에 넣는다.
    r = check_read(read_scores, len(segs)) if read_scores else None
    c = check_recall(segs, typed or {})
    s = check_spot(segs, spot_idx or [], spot_typed or {}) if spot_idx else None
    passed = bool(c["passed"] and (r is None or r["passed"]) and (s is None or s["passed"]))
    fails = [row["i"] for row in sorted(c["rows"], key=lambda x: -x.get("lost", 0))
             if row.get("lost", 0) > 0][:5]
    return {
        "passed": passed,
        "stages": {"read": r, "recall": c, "spot": s},
        "score": _weighted_score(r, c, s),
        "failed_sentences": fails,
        "headline": ("학습 완료" if passed else
                     "가림 낭독 미달" if (r and not r["passed"]) else
                     "백지 테스트 미달" if not c["passed"] else "스팟 체크 미달"),
    }
