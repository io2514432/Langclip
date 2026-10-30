"""Echo — 암기 테스트 생성 · 채점 (서버 순수 함수)

왜 서버에 두는가
  · 채점 규칙(통과 기준, 순서 검증, 유사도)을 한 곳에 모아 테스트로 고정한다.
  · 클라가 조작한 점수를 그대로 믿지 않고, 통과 판정은 서버가 다시 계산한다.

테스트 4종(드릴) + 1종(최종 암송)
  order  : 흩어진 문장 블록을 올바른 순서로 배열
  cloze  : 문장의 핵심 단어를 빈칸으로 채우기
  listen : 영상 구간을 듣고 어떤 문장인지 고르기 (영상은 IFrame 재생만)
  chain  : 첫 단어 몇 개만 보고 문장 나머지를 말/입력으로 이어붙이기
  recite : 처음부터 끝까지 아무것도 안 보고 전체 암송 (음성 or 타이핑)

모든 채점은 '정규화 토큰 비교 + difflib 유사도'로 한다.
음성인식(Web Speech API)은 브라우저가 텍스트로 바꿔 주고, 서버는 그 텍스트만 비교한다.
"""
from __future__ import annotations

import difflib
import hashlib
import random
import re

PASS = 80            # 문장 통과 기준(0~100)
FINAL_PASS = 80      # 최종 암송 문장 통과 기준
STOP = {"a", "an", "the", "to", "of", "and", "is", "are", "i", "you", "it", "in", "on"}

PUNCT = re.compile(r"[^\w\s'’-]")
SPACE = re.compile(r"\s+")


def norm(s: str) -> str:
    s = (s or "").lower().replace("’", "'").replace("‘", "'")
    s = PUNCT.sub(" ", s)
    return SPACE.sub(" ", s).strip()


def tokens(s: str) -> list[str]:
    return [t for t in norm(s).split(" ") if t]


def ratio(a: str, b: str) -> float:
    """0~1 유사도 (정규화 문자열 기준)"""
    na, nb = norm(a), norm(b)
    if not na and not nb:
        return 1.0
    if not na or not nb:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


def score_sentence(expected: str, said: str) -> int:
    """문장 하나 채점: 전체 유사도 + 단어 순서 가중"""
    r = ratio(expected, said)
    et, st = tokens(expected), tokens(said)
    if not et:
        return 0
    # 단어 단위 일치율(순서 무시) — 말은 했지만 순서가 틀린 경우를 구분
    pool = list(st)
    hit = 0
    for w in et:
        if w in pool:
            pool.remove(w)
            hit += 1
    bag = hit / len(et)
    return int(round(100 * (0.65 * r + 0.35 * bag)))


# ---------------------------------------------------------------- 최종 암송
def _split_utterances(text: str) -> list[str]:
    t = (text or "").replace("\r", "\n").strip()
    if not t:
        return []
    parts = re.split(r"(?<=[.!?])\s+|\n+", t)
    return [p.strip() for p in parts if p.strip()]


def match_recitation(expected: list[str], said: str,
                     threshold: int = FINAL_PASS) -> dict:
    """전체 암송 채점.

    said 를 문장 단위로 쪼갠 뒤, 기대 문장 순서대로 '가장 잘 맞는 구간'을 소비하며 매칭한다.
    문장부호가 없으면(음성인식 특성) 단어 윈도우로 탐색한다.
    """
    exp = [e for e in expected if (e or "").strip()]
    if not exp:
        return {"ok": False, "score": 0, "rows": [], "passed": False,
                "error": "기대 문장이 없습니다"}

    utts = _split_utterances(said)
    rows: list[dict] = []

    if len(utts) >= len(exp):
        # 문장부호가 살아 있는 경우: 순서대로 페어링
        used = 0
        for i, e in enumerate(exp):
            best_j, best_s = -1, -1
            for j in range(used, len(utts)):
                s = score_sentence(e, utts[j])
                if s > best_s:
                    best_j, best_s = j, s
                if s >= 95:
                    break
            if best_j < 0:
                rows.append({"i": i, "expected": e, "said": "", "score": 0,
                             "pass": False})
                continue
            rows.append({"i": i, "expected": e, "said": utts[best_j],
                         "score": best_s, "pass": best_s >= threshold})
            used = best_j + 1
    else:
        # 문장부호가 없거나 뭉개진 경우: 단어 스트림에서 윈도우 탐색
        words = tokens(said)
        pos = 0
        for i, e in enumerate(exp):
            et = tokens(e)
            k = max(1, len(et))
            lo, hi = max(1, int(k * 0.5)), int(k * 1.6) + 2
            best = (0, pos, pos)
            for w in range(lo, hi + 1):
                if pos + w > len(words):
                    break
                cand = " ".join(words[pos:pos + w])
                s = score_sentence(e, cand)
                if s > best[0]:
                    best = (s, pos, pos + w)
            s, a, b = best
            rows.append({"i": i, "expected": e, "said": " ".join(words[a:b]),
                         "score": s, "pass": s >= threshold})
            pos = b if b > pos else pos

    scores = [r["score"] for r in rows]
    overall = int(round(sum(scores) / len(scores))) if scores else 0
    passed = bool(rows) and all(r["pass"] for r in rows)
    missed = [r["i"] for r in rows if not r["pass"]]
    return {"ok": True, "score": overall, "rows": rows, "passed": passed,
            "passed_count": len(rows) - len(missed), "total": len(rows),
            "missed": missed, "threshold": threshold,
            "coverage": int(round(100 * len([s for s in scores if s > 0]) / max(1, len(rows))))}


# ---------------------------------------------------------------- 드릴: 순서
def _rng(vid: str, kind: str, seed: int | None) -> random.Random:
    base = seed if seed is not None else int(hashlib.md5(f"{vid}:{kind}".encode()).hexdigest(), 16) % 10 ** 6
    return random.Random(base)


def build_order(segs: list[dict], vid: str = "", seed: int | None = None) -> dict:
    items = [{"i": i, "text": (s.get("en") or s.get("text") or "")}
             for i, s in enumerate(segs) if (s.get("en") or s.get("text"))]
    if len(items) < 2:
        return {"kind": "order", "items": items, "shuffled": [i["i"] for i in items],
                "usable": False, "note": "문장이 2개 이상이어야 순서 테스트를 할 수 있습니다"}
    rnd = _rng(vid, "order", seed)
    order = [it["i"] for it in items]
    for _ in range(20):
        rnd.shuffle(order)
        if order != sorted(order):
            break
    return {"kind": "order", "items": items, "shuffled": order,
            "answer": sorted(order), "usable": True}


def check_order(answer: list[int]) -> dict:
    a = [int(x) for x in (answer or [])]
    ok = a == sorted(a) and len(set(a)) == len(a) and len(a) > 1
    return {"ok": True, "passed": bool(ok), "score": 100 if ok else 0,
            "answer": a, "correct": sorted(a)}


# ---------------------------------------------------------------- 드릴: 빈칸
def build_cloze(segs: list[dict], vid: str = "", seed: int | None = None,
                per_sentence: int = 2) -> dict:
    rnd = _rng(vid, "cloze", seed)
    items = []
    for i, s in enumerate(segs):
        text = (s.get("en") or s.get("text") or "").strip()
        if not text:
            continue
        ws = text.split(" ")
        idx = [k for k, w in enumerate(ws)
               if len(re.sub(r"[^A-Za-z']", "", w)) >= 3]
        if len(idx) < 2:
            continue
        k = min(per_sentence, max(1, len(idx) - 1))
        picks = sorted(rnd.sample(idx, k))
        blanks = []
        parts = []
        for n, w in enumerate(ws):
            if n in picks:
                clean = re.sub(r"[^A-Za-z']", "", w).lower()
                blanks.append({"pos": len(parts), "answer": clean})
                parts.append({"blank": True, "hint": clean[:1] + "…",
                              "tail": re.sub(r"[\w']", "", w)})
            else:
                parts.append({"blank": False, "text": w})
        items.append({"i": i, "en": text, "parts": parts, "blanks": blanks,
                      "ko": s.get("ko", "")})
    return {"kind": "cloze", "items": items, "usable": len(items) > 0,
            "total_blanks": sum(len(it["blanks"]) for it in items)}


def check_cloze(payload: list[dict], segs: list[dict]) -> dict:
    """payload: [{'i': 문장index, 'answers': ['word', ...]}] — 정답은 서버가 만든 blanks 와 비교"""
    total, hit, detail = 0, 0, []
    by_i = {}
    for row in payload or []:
        by_i[int(row.get("i", -1))] = [norm(a) for a in (row.get("answers") or [])]
    for i, s in enumerate(segs):
        text = (s.get("en") or s.get("text") or "").strip()
        if not text:
            continue
        ws = text.split(" ")
        cand = [re.sub(r"[^A-Za-z']", "", w).lower() for w in ws]
        cand = [w for w in cand if len(w) >= 3]
        if len(cand) < 2:
            continue
        got = by_i.get(i, [])
        # 문장마다 앞에서부터 최대 2개를 채점(생성 규칙과 동일한 개수)
        n = min(2, max(1, len(cand) - 1))
        total += n
        ok = sum(1 for a in got[:n] if a and any(a == c or ratio(a, c) > 0.99 for c in cand))
        hit += ok
        detail.append({"i": i, "ok": ok, "need": n})
    pct = int(round(100 * hit / total)) if total else 0
    return {"ok": True, "score": pct, "passed": pct >= PASS, "hit": hit,
            "total": total, "rows": detail}


# ---------------------------------------------------------------- 드릴: 듣기
def build_listen(segs: list[dict], vid: str = "", seed: int | None = None,
                 choices: int = 4) -> dict:
    rnd = _rng(vid, "listen", seed)
    pool = [(i, (s.get("en") or s.get("text") or "").strip()) for i, s in enumerate(segs)]
    pool = [(i, t) for i, t in pool if t]
    if len(pool) < 2:
        return {"kind": "listen", "items": [], "usable": False,
                "note": "문장이 2개 이상이어야 듣기 테스트를 할 수 있습니다"}
    picks = pool[:] if len(pool) <= 8 else rnd.sample(pool, 8)
    items = []
    for i, text in picks:
        others = [t for j, t in pool if j != i]
        rnd.shuffle(others)
        opts = others[:max(1, choices - 1)] + [text]
        rnd.shuffle(opts)
        items.append({"i": i, "answer": text, "options": opts,
                      "start": segs[i].get("start", 0), "end": segs[i].get("end", 0)})
    return {"kind": "listen", "items": items, "usable": True}


def check_listen(payload: list[dict]) -> dict:
    rows = []
    for r in payload or []:
        rows.append({"i": int(r.get("i", -1)), "ok": bool(r.get("ok"))})
    total = len(rows)
    hit = len([r for r in rows if r["ok"]])
    pct = int(round(100 * hit / total)) if total else 0
    return {"ok": True, "score": pct, "passed": total > 0 and hit == total,
            "hit": hit, "total": total, "rows": rows}


# ---------------------------------------------------------------- 드릴: 이어말하기
def build_chain(segs: list[dict], vid: str = "", seed: int | None = None,
                ratio_show: float = 0.34) -> dict:
    items = []
    for i, s in enumerate(segs):
        text = (s.get("en") or s.get("text") or "").strip()
        if not text:
            continue
        ws = text.split(" ")
        k = max(1, min(len(ws) - 1, int(round(len(ws) * ratio_show))))
        items.append({"i": i, "en": text, "head": " ".join(ws[:k]),
                      "rest": " ".join(ws[k:]), "ko": s.get("ko", "")})
    return {"kind": "chain", "items": items, "usable": len(items) > 0}


def check_chain(payload: list[dict], segs: list[dict]) -> dict:
    total, hit, rows = 0, 0, []
    said = {int(r.get("i", -1)): str(r.get("said", "")) for r in (payload or [])}
    for i, s in enumerate(segs):
        text = (s.get("en") or s.get("text") or "").strip()
        if not text:
            continue
        ws = text.split(" ")
        k = max(1, min(len(ws) - 1, int(round(len(ws) * 0.34))))
        rest = " ".join(ws[k:])
        sc = score_sentence(rest, said.get(i, ""))
        total += 1
        if sc >= PASS:
            hit += 1
        rows.append({"i": i, "score": sc, "pass": sc >= PASS})
    pct = int(round(100 * hit / total)) if total else 0
    return {"ok": True, "score": pct, "passed": total > 0 and hit == total,
            "hit": hit, "total": total, "rows": rows}


# ---------------------------------------------------------------- 통합
def build(kind: str, segs: list[dict], vid: str = "", seed: int | None = None) -> dict:
    kind = (kind or "").lower()
    if kind == "order":
        return build_order(segs, vid, seed)
    if kind == "cloze":
        return build_cloze(segs, vid, seed)
    if kind == "listen":
        return build_listen(segs, vid, seed)
    if kind == "chain":
        return build_chain(segs, vid, seed)
    raise ValueError("unknown drill kind")


def check(kind: str, payload, segs: list[dict]) -> dict:
    kind = (kind or "").lower()
    if kind == "order":
        return check_order(payload if isinstance(payload, list) else [])
    if kind == "cloze":
        return check_cloze(payload if isinstance(payload, list) else [], segs)
    if kind == "listen":
        return check_listen(payload if isinstance(payload, list) else [])
    if kind == "chain":
        return check_chain(payload if isinstance(payload, list) else [], segs)
    raise ValueError("unknown drill kind")
