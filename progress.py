"""Langclip — 학습 기록 / 북마크 / 게이미피케이션 (사용자별 분리)

저장 위치
  관리자(나)      data/attempts.json · notes.json · verify.json
  방문자(친구)    data/users/<uid>/attempts.json · notes.json · verify.json

왜 이렇게 나누는가
  공개 링크로 들어온 사람이 내 오답노트·완료 기록을 보면 안 된다.
  로그인 없이 기기마다 다른 프로필을 주기 위해, 공개 서버가 쿠키로 발급한
  uid 를 요청마다 contextvar 에 심고 모든 기록 함수가 그 uid 폴더를 쓴다.

  uid 는 요청 컨텍스트(contextvar)로 전달되므로, 기록 함수의 호출부는
  전혀 바꾸지 않아도 된다.
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
USERS = DATA / "users"

MAX_ATTEMPTS = 8000
PASS_SCORE = 70.0
XP_PER_LEVEL = 120

_UID = contextvars.ContextVar("langclip_uid", default="")
_UID_RE = re.compile(r"^[A-Za-z0-9]{6,40}$")


def set_uid(uid: str | None) -> None:
    """요청 단위 사용자 지정. 빈 값이면 관리자(내 기록)."""
    u = (uid or "").strip()
    _UID.set(u if _UID_RE.match(u) else "")


def current_uid() -> str:
    return _UID.get()


def _dir() -> Path:
    u = _UID.get()
    d = DATA if not u else (USERS / u)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _p(name: str) -> Path:
    return _dir() / name


# ---------------------------------------------------------------- IO
def _load(path: Path, default):
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return default


def _save(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, path)


def _today() -> date:
    return datetime.now().date()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


# ---------------------------------------------------------------- attempts
def record_attempt(vid: str, idx: int, total: float, mode: str) -> None:
    f = _p("attempts.json")
    rows = _load(f, [])
    rows.append({"ts": _now(), "vid": vid, "idx": int(idx),
                 "total": round(float(total), 1), "mode": mode})
    if len(rows) > MAX_ATTEMPTS:
        rows = rows[-MAX_ATTEMPTS:]
    _save(f, rows)


def attempts() -> list[dict]:
    return _load(_p("attempts.json"), [])


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


# ---------------------------------------------------------------- 검증 기록
def _verifies() -> dict:
    d = _load(_p("verify.json"), {})
    return d if isinstance(d, dict) else {}


def record_verify(vid: str, result: dict) -> dict:
    """3단계 검증 결과 저장. 한 번 통과하면 유지된다."""
    prev = _verifies().get(vid) or {}
    passed = bool(result.get("passed"))
    now_ok = passed or bool(prev.get("ok"))
    rec = {
        "ok": now_ok,
        "done_at": (prev.get("done_at") or _now()) if now_ok else "",
        "score": round(max(float(result.get("score", 0)), float(prev.get("score", 0))), 1),
        "at": _now(),
        "tries": int(prev.get("tries", 0)) + 1,
        "headline": result.get("headline", ""),
        "stages": {k: {"passed": bool(v.get("passed")), "hit": v.get("hit"),
                       "total": v.get("total"), "avg": v.get("avg"), "score": v.get("score")}
                   for k, v in (result.get("stages") or {}).items()},
    }
    d = _verifies()
    d[vid] = rec
    _save(_p("verify.json"), d)
    return {"record": rec, "first_clear": passed and not prev.get("ok")}


def verify_of(vid: str) -> dict:
    return _verifies().get(vid, {})


def is_complete(vid: str) -> bool:
    return bool((_verifies().get(vid) or {}).get("ok"))


def completed_count() -> int:
    return len([1 for r in _verifies().values() if r.get("ok")])


def _done_days() -> set[str]:
    """학습 완료(검증 통과)한 날짜. 연속 학습의 유일한 기준."""
    days: set[str] = set()
    for r in _verifies().values():
        if not r.get("ok"):
            continue
        d = _day_of(r.get("done_at") or r.get("at") or "")
        if d:
            days.add(d)
    return days


def streak() -> dict:
    done = _done_days()
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
    """진행률 표시용."""
    if n_segs <= 0:
        return {"pct": 0.0, "done": 0, "total": 0, "tried": 0}
    best = best_scores(vid)
    tried = len([k for k in best if 0 <= k < n_segs])
    s = sum(best.get(i, 0.0) for i in range(n_segs))
    return {"pct": round(s / n_segs, 1), "done": 0, "total": n_segs, "tried": tried}


# ---------------------------------------------------------------- XP / level
def xp_total() -> int:
    xp = sum(min(10, round(float(r.get("total", 0)) / 10)) for r in attempts())
    xp += 120 * completed_count()
    return int(xp)


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
        open_v = [v for v in videos.values() if not is_complete(v["id"])]
        picked = (open_v or list(videos.values()))[0]
    n = len(picked.get("segs", []))
    n_today = len({r.get("idx") for r in last_today if r.get("vid") == picked["id"]})
    return {"id": picked["id"], "title": picked.get("title", ""),
            "yt": picked.get("yt", ""), "segs": n,
            "memorized": memorized(picked["id"], n),
            "tried_today": n_today, "complete": is_complete(picked["id"]),
            "verify": verify_of(picked["id"])}


def progress(videos: dict) -> dict:
    return {"focus": today_focus(videos), "streak": streak(),
            "xp": level_info(), "completed": completed_count(),
            "total_attempts": len(attempts())}


# ---------------------------------------------------------------- notes
def _notes() -> dict:
    n = _load(_p("notes.json"), {})
    n.setdefault("sentences", {})
    n.setdefault("words", {})
    return n


def _save_notes(n: dict) -> None:
    _save(_p("notes.json"), n)


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
        _save_notes(n)
        return {"ok": True, "bookmarked": False, "key": key}
    n["sentences"][key] = {
        "key": key, "vid": vid, "idx": int(idx),
        "en": seg.get("en") or seg.get("text", ""), "ko": seg.get("ko", ""),
        "start": seg.get("start"), "end": seg.get("end"),
        "title": (video or {}).get("title", ""), "yt": (video or {}).get("yt", ""),
        "note": (note or "")[:300], "created": _now(),
    }
    _save_notes(n)
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
            _save_notes(n)
            return {"ok": True, "bookmarked": True, "key": key, "updated": True}
        n["words"].pop(key)
        _save_notes(n)
        return {"ok": True, "bookmarked": False, "key": key}
    n["words"][key] = {"word": key, "meaning": meaning.strip()[:200],
                       "ctx": (ctx or "")[:200], "vid": vid, "idx": int(idx),
                       "count": 1, "created": _now()}
    _save_notes(n)
    return {"ok": True, "bookmarked": True, "key": key}


def word_note(word: str) -> dict | None:
    key = re.sub(r"[^a-z0-9'\- ]", "", (word or "").lower()).strip()
    return _notes()["words"].get(key)


# ---------------------------------------------------------------- 사전 (공용 캐시)
_CACHE_TTL = 60 * 60 * 24 * 30


def _dict_lookup(word: str) -> dict | None:
    """dictionaryapi.dev (영영 정의). 실패하면 None — 뜻을 지어내지 않는다."""
    cache = _load(DATA / "wordcache.json", {})
    c = cache.get(word.lower())
    if c and time.time() - c.get("at", 0) < _CACHE_TTL:
        return c.get("data")
    try:
        url = "https://api.dictionaryapi.dev/api/v2/entries/en/" + urllib.parse.quote(word)
        req = urllib.request.Request(url, headers={"User-Agent": "Langclip/4.2"})
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
    _save(DATA / "wordcache.json", cache)
    return data


def lookup(word: str) -> dict:
    mine = word_note(word)
    d = _dict_lookup(word)
    return {"word": word, "saved": mine,
            "phonetic": (d or {}).get("phonetic", ""),
            "definitions": (d or {}).get("definitions", []),
            "online": bool(d and d.get("found")),
            "source": "dictionaryapi.dev" if (d and d.get("found")) else None}
