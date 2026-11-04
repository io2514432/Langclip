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
def check_recall(segs: list[dict], typed: dict) -> dict:
    rows, ok = [], 0
    for i, s in enumerate(segs):
        en = (s.get("en") or s.get("text") or "").strip()
        said = str((typed or {}).get(i, "") or (typed or {}).get(str(i), "") or "")
        score = pct(en, said)
        good = bool(en) and score >= RECALL_PASS
        ok += 1 if good else 0
        rows.append({"i": i, "score": score, "pass": good, "answer": en,
                     "said": said.strip()[:200]})
    total = len(segs)
    return {"passed": bool(total) and ok == total, "hit": ok, "total": total,
            "rows": rows, "need": RECALL_PASS}


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
def judge(segs: list[dict], read_scores, typed, spot_idx, spot_typed) -> dict:
    r = check_read(read_scores, len(segs))
    c = check_recall(segs, typed or {})
    s = check_spot(segs, spot_idx or [], spot_typed or {})
    passed = bool(r["passed"] and c["passed"] and s["passed"])
    fails = [row["i"] for row in c["rows"] if not row["pass"]]
    return {
        "passed": passed,
        "stages": {"read": r, "recall": c, "spot": s},
        "score": int(round(0.3 * (r.get("avg") or 0) + 0.5 * (100 * c["hit"] / max(1, c["total"]))
                           + 0.2 * (100 * s["hit"] / max(1, s["total"])))),
        "failed_sentences": fails,
        "headline": ("학습 완료" if passed else
                     "가림 낭독 미달" if not r["passed"] else
                     "암기 복창 미달" if not c["passed"] else "스팟 체크 미달"),
    }
