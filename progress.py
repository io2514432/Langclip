"""Echo — 학습 기록 / 북마크 / 게이미피케이션

파일
  data/attempts.json  : [{ts, vid, idx, total, mode}, ...]
  data/notes.json     : {"sentences": {...}, "words": {...}}
  data/wordcache.json : 사전 조회 캐시

암기율(memorized)
  문장별 '최고 점수'의 평균(%). 한 번 잘 본 문장은 계속 반영된다.
통과(pass)       문장 점수 70점 이상.
완료(complete)   등록된 문장을 전부 70점 이상으로 통과한 상태.
XP / 레벨 / 배지  채점 1회 = 점수/10 XP(최대 10) · 레벨 = 1 + XP // 120
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
ATTEMPTS = DATA / "attempts.json"
NOTES = DATA / "notes.json"
WCACHE = DATA / "wordcache.json"

MAX_ATTEMPTS = 8000
PASS_SCORE = 70.0
XP_PER_LEVEL = 120


# ---------------------------------------------------------------- IO
def _load(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def _save(path: Path, obj) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, path)


def _today() -> date:
    return datetime.now().date()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- attempts
def record_attempt(vid: str, idx: int, total: float, mode: str) -> None:
    rows = _load(ATTEMPTS, [])
    rows.append({"ts": _now(), "vid": vid, "idx": int(idx),
                 "total": round(float(total), 1), "mode": mode})
    if len(rows) > MAX_ATTEMPTS:
        rows = rows[-MAX_ATTEMPTS:]
    _save(ATTEMPTS, rows)


def attempts() -> list[dict]:
    return _load(ATTEMPTS, [])


def best_scores(vid: str | None = None) -> dict[int, float]:
    best: dict[int, float] = {}
    for r in attempts():
        if vid and r.get("vid") != vid:
            continue
        k = int(r.get("idx", 0))
        best[k] = max(best.get(k, 0.0), float(r.get("total", 0)))
    return best


def _day_of(ts: str) -> str:
    try:
        return datetime.fromisoformat(ts).date().isoformat()
    except Exception:
        return ""


def streak() -> dict:
    days = sorted({_day_of(r["ts"]) for r in attempts() if r.get("ts")})
    done = set(days)
    today = _today()
    cur = today if today.isoformat() in done else today - timedelta(days=1)
    n = 0
    while cur.isoformat() in done:
        n += 1
        cur -= timedelta(days=1)

    monday = today - timedelta(days=today.weekday())
    labels = ["월", "화", "수", "목", "금", "토", "일"]
    week = []
    for i in range(7):
        d = monday + timedelta(days=i)
        week.append({"label": labels[i], "date": d.isoformat(),
                     "done": d.isoformat() in done, "is_today": d == today,
                     "is_future": d > today})
    return {"days": n, "today_done": today.isoformat() in done,
            "week": week, "total_days": len(done)}


def memorized(vid: str, n_segs: int) -> dict:
    if n_segs <= 0:
        return {"pct": 0.0, "done": 0, "total": 0, "tried": 0}
    best = best_scores(vid)
    tried = len([k for k in best if 0 <= k < n_segs])
    s = sum(best.get(i, 0.0) for i in range(n_segs))
    done = len([i for i in range(n_segs) if best.get(i, 0.0) >= PASS_SCORE])
    return {"pct": round(s / n_segs, 1), "done": done, "total": n_segs, "tried": tried}


def is_complete(vid: str, n_segs: int) -> bool:
    """문장을 전부 70점 이상으로 통과했는가."""
    m = memorized(vid, n_segs)
    return bool(n_segs > 0 and m["done"] >= n_segs)


# ---------------------------------------------------------------- XP / level
def xp_total() -> int:
    return int(sum(min(10, round(float(r.get("total", 0)) / 10)) for r in attempts()))


def level_of(xp: int | None = None) -> int:
    x = xp_total() if xp is None else int(xp)
    return 1 + max(0, x) // XP_PER_LEVEL


def level_info() -> dict:
    xp = xp_total()
    lv = level_of(xp)
    into = xp % XP_PER_LEVEL
    return {"xp": xp, "level": lv, "into": into, "need": XP_PER_LEVEL,
            "pct": round(100 * into / XP_PER_LEVEL, 1),
            "next": (lv + 1) * XP_PER_LEVEL - xp}


# ---------------------------------------------------------------- badges
BADGES = [
    ("first_try", "🎤", "첫 채점", "처음으로 문장을 녹음해 채점받았어요"),
    ("first_pass", "✅", "첫 통과", "문장 하나를 70점 이상으로 통과했어요"),
    ("perfect_one", "💎", "완벽한 문장", "한 문장에서 90점 이상을 받았어요"),
    ("streak3", "🔥", "3일 연속", "3일 연속으로 학습했어요"),
    ("streak7", "🌟", "7일 연속", "일주일 내내 학습했어요"),
    ("words10", "📚", "단어 10개", "단어장에 10개를 모았어요"),
]


def badge_state() -> dict:
    rows = attempts()
    best = best_scores()
    st = streak()
    words = len(_notes()["words"])
    return {
        "first_try": len(rows) >= 1,
        "first_pass": any(v >= PASS_SCORE for v in best.values()),
        "perfect_one": any(float(r.get("total", 0)) >= 90 for r in rows),
        "streak3": st["days"] >= 3,
        "streak7": st["days"] >= 7,
        "words10": words >= 10,
    }


def badges() -> list[dict]:
    got = badge_state()
    return [{"id": i, "emoji": e, "label": n, "desc": d, "got": bool(got.get(i))}
            for i, e, n, d in BADGES]


# ---------------------------------------------------------------- 현황
def today_focus(videos: dict) -> dict | None:
    if not videos:
        return None
    today = _today().isoformat()
    last_today = [r for r in attempts() if _day_of(r.get("ts", "")) == today]
    picked = None
    if last_today:
        picked = videos.get(last_today[-1].get("vid"))
    if picked is None:
        open_v = [v for v in videos.values()
                  if not is_complete(v["id"], len(v.get("segs", [])))]
        picked = (open_v or list(videos.values()))[0]
    n = len(picked.get("segs", []))
    m = memorized(picked["id"], n)
    n_today = len({r.get("idx") for r in last_today if r.get("vid") == picked["id"]})
    return {"id": picked["id"], "title": picked.get("title", ""),
            "yt": picked.get("yt", ""), "segs": n, "memorized": m,
            "tried_today": n_today, "complete": is_complete(picked["id"], n)}


def progress(videos: dict) -> dict:
    return {"focus": today_focus(videos), "streak": streak(),
            "xp": level_info(), "badges": badges(),
            "total_attempts": len(attempts())}


# ---------------------------------------------------------------- notes
def _notes() -> dict:
    n = _load(NOTES, {})
    n.setdefault("sentences", {})
    n.setdefault("words", {})
    return n


def notes() -> dict:
    n = _notes()
    s = sorted(n["sentences"].values(), key=lambda x: x.get("created", ""), reverse=True)
    w = sorted(n["words"].values(), key=lambda x: x.get("created", ""), reverse=True)
    return {"sentences": s, "words": w,
            "counts": {"sentences": len(s), "words": len(w)}}


def toggle_sentence(vid: str, idx: int, seg: dict, video: dict | None = None,
                    note: str = "") -> dict:
    n = _notes()
    key = f"{vid}:{int(idx)}"
    if key in n["sentences"]:
        n["sentences"].pop(key)
        _save(NOTES, n)
        return {"ok": True, "bookmarked": False, "key": key}
    n["sentences"][key] = {
        "key": key, "vid": vid, "idx": int(idx),
        "en": seg.get("en") or seg.get("text", ""), "ko": seg.get("ko", ""),
        "start": seg.get("start"), "end": seg.get("end"),
        "title": (video or {}).get("title", ""), "yt": (video or {}).get("yt", ""),
        "note": (note or "")[:300], "created": _now(),
    }
    _save(NOTES, n)
    return {"ok": True, "bookmarked": True, "key": key}


def toggle_word(word: str, meaning: str = "", ctx: str = "", vid: str = "",
                idx: int = -1) -> dict:
    n = _notes()
    key = re.sub(r"[^a-z0-9'\- ]", "", (word or "").lower()).strip()
    if not key:
        return {"ok": False, "error": "empty"}
    if key in n["words"]:
        if meaning.strip():
            n["words"][key]["meaning"] = meaning.strip()[:200]
            _save(NOTES, n)
            return {"ok": True, "bookmarked": True, "key": key, "updated": True}
        n["words"].pop(key)
        _save(NOTES, n)
        return {"ok": True, "bookmarked": False, "key": key}
    n["words"][key] = {"word": key, "meaning": meaning.strip()[:200],
                       "ctx": (ctx or "")[:200], "vid": vid, "idx": int(idx),
                       "count": 1, "created": _now()}
    _save(NOTES, n)
    return {"ok": True, "bookmarked": True, "key": key}


def word_note(word: str) -> dict | None:
    key = re.sub(r"[^a-z0-9'\- ]", "", (word or "").lower()).strip()
    return _notes()["words"].get(key)


# ---------------------------------------------------------------- 사전
_CACHE_TTL = 60 * 60 * 24 * 30


def _dict_lookup(word: str) -> dict | None:
    """dictionaryapi.dev (영영 정의). 실패하면 None — 뜻을 지어내지 않는다."""
    cache = _load(WCACHE, {})
    c = cache.get(word.lower())
    if c and time.time() - c.get("at", 0) < _CACHE_TTL:
        return c.get("data")
    try:
        url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + urllib.parse.quote(word)
        req = urllib.request.Request(url, headers={"User-Agent": "Echo/3.5"})
        with urllib.request.urlopen(req, timeout=5) as r:
            raw = json.loads(r.read().decode("utf-8"))
        entry = raw[0] if isinstance(raw, list) and raw else {}
        defs, phon = [], entry.get("phonetic", "")
        for meaning in entry.get("meanings", [])[:3]:
            p = meaning.get("partOfSpeech", "")
            for d in meaning.get("definitions", [])[:2]:
                defs.append({"pos": p, "def": d.get("definition", ""),
                             "example": d.get("example", "")})
        for ph in entry.get("phonetics", []):
            if ph.get("text"):
                phon = phon or ph["text"]
                break
        data = {"found": bool(defs), "word": entry.get("word", word),
                "phonetic": phon, "definitions": defs[:4]}
    except Exception:
        data = {"found": False, "word": word, "phonetic": "", "definitions": []}

    cache[word.lower()] = {"at": time.time(), "data": data}
    if len(cache) > 3000:
        cache = dict(list(cache.items())[-3000:])
    _save(WCACHE, cache)
    return data


def lookup(word: str) -> dict:
    mine = word_note(word)
    d = _dict_lookup(word)
    return {"word": word, "saved": mine,
            "phonetic": (d or {}).get("phonetic", ""),
            "definitions": (d or {}).get("definitions", []),
            "online": bool(d and d.get("found")),
            "source": "dictionaryapi.dev" if (d and d.get("found")) else None}
