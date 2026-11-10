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

import langs

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
VERIFY = "verify.json"

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
    d = _load(_p(VERIFY), {})
    if not isinstance(d, dict):
        return {}
    for rec in d.values():
        if isinstance(rec, dict) and rec.get("stages"):
            rec["stages"] = _norm_stages(rec["stages"])
    return d


_STAGE_ALIAS = {"inter": "intermediate", "intermediate": "intermediate",
                "recall": "advanced", "advanced": "advanced", "beginner": "beginner"}


def _norm_stages(st: dict) -> dict:
    """예전 키(inter/recall)를 지금 키(intermediate/advanced)로 옮긴다."""
    out: dict = {}
    for k, v in (st or {}).items():
        if not isinstance(v, dict):
            continue
        nk = _STAGE_ALIAS.get(k, k)
        cur = out.get(nk)
        if cur is None:
            nv = dict(v)
            nv["passed"] = bool(v.get("passed"))
            out[nk] = nv
            continue
        cur["passed"] = bool(cur.get("passed")) or bool(v.get("passed"))
        try:
            if float(v.get("score") or 0) > float(cur.get("score") or 0):
                keep_pass = cur["passed"]
                cur.update(v)
                cur["passed"] = keep_pass
        except (TypeError, ValueError):
            pass
    return out


def record_verify(vid: str, result: dict) -> dict:
    """3단계 검증 결과 저장. 난이도별 최고 점수는 지우지 않고 누적한다."""
    prev = _verifies().get(vid) or {}
    passed = bool(result.get("passed"))
    now_ok = passed or bool(prev.get("ok"))
    stages: dict = {}
    for k, v in (prev.get("stages") or {}).items():
        if isinstance(v, dict):
            stages[k] = dict(v)
    for k, v in (result.get("stages") or {}).items():
        if not isinstance(v, dict):
            continue
        old = stages.get(k) or {}
        try:
            nsc = float(v.get("score") or 0)
        except (TypeError, ValueError):
            nsc = 0.0
        try:
            osc = float(old.get("score") or 0)
        except (TypeError, ValueError):
            osc = 0.0
        if osc > nsc:
            best = dict(old)
            best["passed"] = bool(old.get("passed")) or bool(v.get("passed"))
            if best.get("at") is None:
                best["at"] = old.get("at") or ""
        else:
            best = dict(v)
            best["score"] = round(nsc, 1)
            for f in ("hit", "total", "avg"):
                if best.get(f) is None:
                    best[f] = old.get(f)
            best["passed"] = bool(old.get("passed")) or bool(v.get("passed"))
            if v.get("passed") and not old.get("passed"):
                best["at"] = _now()
            else:
                best["at"] = old.get("at") or (best.get("at") or "")
        stages[k] = best
    rec = {
        "ok": now_ok,
        "done_at": (prev.get("done_at") or _now()) if now_ok else "",
        "score": round(max(float(result.get("score", 0)), float(prev.get("score", 0))), 1),
        "at": _now(),
        "tries": int(prev.get("tries", 0)) + 1,
        "headline": result.get("headline", "") or prev.get("headline", ""),
        "stages": stages,
    }
    d = _verifies()
    d[vid] = rec
    _save(_p(VERIFY), d)
    return {"record": rec, "first_clear": passed and not prev.get("ok"), "medals": medals(vid)}


def reset_verify(vid: str) -> None:
    """검증(백지테스트) 기록을 지운다. 관리자 전용."""
    d = _verifies()
    if vid in d:
        d.pop(vid, None)
        _save(_p(VERIFY), d)


def verify_of(vid: str) -> dict:
    return _verifies().get(vid, {})


MEDAL_OF = {"beginner": "bronze", "intermediate": "silver", "advanced": "gold"}


def medals(vid: str) -> list:
    """통과한 난이도의 메달 목록 (bronze/silver/gold)."""
    st = (_verifies().get(vid) or {}).get("stages") or {}
    out = []
    for k, m in MEDAL_OF.items():
        if (st.get(k) or {}).get("passed"):
            out.append(m)
    return out


def is_complete(vid: str) -> bool:
    return bool((_verifies().get(vid) or {}).get("ok"))


def completed_count() -> int:
    return len([1 for r in _verifies().values() if r.get("ok")])


def _done_days() -> set[str]:
    """학습 완료한 날짜 = 암송(백지테스트) 통과일 ∪ 오늘 학습(Stage 1) 달성일."""
    days: set[str] = set()
    for r in _verifies().values():
        if not r.get("ok"):
            continue
        d = _day_of(r.get("done_at") or r.get("at") or "")
        if d:
            days.add(d)
    try:
        days |= stage_days()
    except NameError:
        pass
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
            "stage": stage_of(picked["id"], n),
            "stage1": stage_of(picked["id"], n)["stage1"],
            "verify": verify_of(picked["id"])}


def progress(videos: dict) -> dict:
    return {"focus": today_focus(videos), "streak": streak(),
            "completed": completed_count(),
            "total_attempts": len(attempts())}


# ---------------------------------------------------------------- notes
def _notes() -> dict:
    n = _load(_p("notes.json"), {})
    n.setdefault("sentences", {})
    n.setdefault("words", {})
    return n


def _save_notes(n: dict) -> None:
    _save(_p("notes.json"), n)


def sync_sentence_notes(vid: str, segs: list[dict], video: dict | None = None) -> int:
    """자막을 수정하면 그 영상에서 북마크한 문장도 같은 내용으로 따라가게 한다.
    문장 수가 줄어 범위를 벗어난 북마크는 지운다."""
    n = _notes()
    hit = 0
    for key in [k for k, v in n["sentences"].items() if v.get("vid") == vid]:
        item = n["sentences"][key]
        i = int(item.get("idx", -1))
        if i < 0 or i >= len(segs):
            n["sentences"].pop(key)
            continue
        s = segs[i]
        item["en"] = s.get("en") or s.get("text", "")
        item["ko"] = s.get("ko", "")
        item["start"] = s.get("start")
        item["end"] = s.get("end")
        if video:
            item["title"] = video.get("title", item.get("title", ""))
            item["yt"] = video.get("yt", item.get("yt", ""))
        n["sentences"][key] = item
        hit += 1
    _save_notes(n)
    return hit


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
                idx: int = -1, toggle_only: bool = False) -> dict:
    n = _notes()
    key = re.sub(r"[^a-z0-9'\- ]", "", (word or "").lower()).strip()
    if not key:
        return {"ok": False, "error": "empty"}
    if key in n["words"]:
        if meaning.strip() and not toggle_only:
            n["words"][key]["meaning"] = meaning.strip()[:200]
            _save_notes(n)
            return {"ok": True, "bookmarked": True, "key": key, "updated": True}
        n["words"].pop(key)
        _save_notes(n)
        return {"ok": True, "bookmarked": False, "key": key}
    n["words"][key] = {"word": key, "meaning": (meaning.strip() or _ko_cached(key))[:200],
                       "ctx": (ctx or "")[:200], "vid": vid, "idx": int(idx),
                       "count": 1, "created": _now()}
    _save_notes(n)
    return {"ok": True, "bookmarked": True, "key": key}


def word_note(word: str) -> dict | None:
    key = re.sub(r"[^a-z0-9'\- ]", "", (word or "").lower()).strip()
    return _notes()["words"].get(key)


# ---------------------------------------------------------------- 사전 (공용 캐시)
_CACHE_TTL = 60 * 60 * 24 * 30


def _dict_lookup(word: str, lang: str = "en"):
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



def _wiktionary(word: str, lang: str) -> dict | None:
    """영어 외 언어: 해당 언어 위키낱말사전 정의. 실패하면 None."""
    try:
        code = langs.ok(lang)
        url = ("https://" + code + ".wiktionary.org/api/rest_v1/page/definition/"
               + urllib.parse.quote(word.replace(" ", "_")))
        raw = _http_json(url, timeout=4.0) or {}
        blocks = raw.get(code) or []
        defs = []
        for b in blocks[:2]:
            for d in (b.get("definitions") or [])[:3]:
                txt = re.sub(r"<[^>]+>", "", d.get("definition") or "").strip()
                if txt:
                    defs.append({"pos": b.get("partOfSpeech", ""), "def": txt})
        if not defs:
            return None
        return {"found": True, "phonetic": "", "definitions": defs[:3]}
    except Exception:
        return None

def lookup(word: str, lang: str = "en") -> dict:
    mine = word_note(word)
    lang = langs.ok(lang)
    d = _dict_lookup(word, lang) if lang == "en" else (_wiktionary(word, lang)
                                                      or _dict_lookup(word, lang))
    defs = (d or {}).get("definitions", [])
    ko, ko_src = _ko_of(word, lang)
    ko_defs = []
    for item in defs[:2]:
        t = _translate(item.get("def", ""), maxlen=120, sl=lang)
        if t:
            ko_defs.append({"pos": item.get("pos", ""), "ko": t, "en": item.get("def", "")})
    return {"word": word, "saved": mine,
            "phonetic": (d or {}).get("phonetic", ""),
            "definitions": defs,
            "ko": ko, "ko_defs": ko_defs, "ko_source": ko_src,
            "online": bool(d and d.get("found")),
            "source": ("dictionaryapi.dev" if lang == "en" else lang + ".wiktionary.org")
                      if (d and d.get("found")) else None}


# ---------------------------------------------------------------- 한글 뜻
KO_PATH = DATA / "ko_cache.json"
_KO: dict[str, str] = {}


def _ko_load() -> None:
    if _KO:
        return
    try:
        _KO.update(json.loads(KO_PATH.read_text(encoding="utf-8")))
    except Exception:
        pass


def _ko_store() -> None:
    try:
        KO_PATH.parent.mkdir(parents=True, exist_ok=True)
        keep = dict(list(_KO.items())[-4000:])
        KO_PATH.write_text(json.dumps(keep, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _http_json(url: str, timeout: float = 4.0):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Langclip/4.3)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _translate(text: str, maxlen: int = 80, sl: str = "en", tl: str = "ko") -> str:
    """영어 -> 한국어 (구글 무료 엔드포인트 우선, 실패 시 MyMemory)."""
    t = (text or "").strip()
    if not t:
        return ""
    t = t[:maxlen]
    q = urllib.parse.quote(t, safe="")
    try:
        d = _http_json("https://translate.googleapis.com/translate_a/single"
                       "?client=gtx&sl=" + sl + "&tl=" + tl + "&dt=t&q=" + q)
        out = "".join(x[0] for x in d[0] if x and x[0]).strip()
        if out and out.lower() != t.lower():
            return out
    except Exception:
        pass
    try:
        d = _http_json("https://api.mymemory.translated.net/get?q=" + q + "&langpair=" + sl + "|" + tl)
        out = ((d or {}).get("responseData") or {}).get("translatedText") or ""
        out = out.strip()
        if out and out.lower() != t.lower() and "MYMEMORY" not in out.upper():
            return out
    except Exception:
        pass
    return ""


def _ko_cached(word: str, lang: str = "en") -> str:
    """이미 번역해 둔 한글 뜻만 꺼낸다(네트워크 없음)."""
    w = (word or "").strip().lower()
    if not w:
        return ""
    try:
        _ko_load()
        return _KO.get(w, "") or ""
    except Exception:
        return ""


def _ko_of(word: str, lang: str = "en") -> tuple[str, str | None]:
    """단어의 한글 뜻. 캐시 우선, 없으면 번역 후 저장."""
    w = (word or "").strip().lower()
    if not w:
        return "", None
    _ko_load()
    if w in _KO:
        return _KO[w], "cache"
    ko = _translate(w, maxlen=40)
    if ko:
        _KO[w] = ko
        _ko_store()
        return ko, "translate"
    return "", None

# ---------------------------------------------------------------- 삭제 정리
def _dirs() -> list:
    """관리자 본인 폴더 + 방문자별 폴더 전부."""
    out = [DATA]
    u = DATA / "users"
    if u.is_dir():
        for d in sorted(u.iterdir()):
            if d.is_dir():
                out.append(d)
    return out


def purge_video(vid: str) -> dict:
    """영상을 지울 때 그 영상에 묶인 학습기록을 모든 사용자 폴더에서 지운다. (정크 방지)"""
    stat = {"attempts": 0, "sentences": 0, "words": 0, "verify": 0}
    for d in _dirs():
        f = d / "attempts.json"
        if f.exists():
            rows = _load(f, [])
            if isinstance(rows, list):
                keep = [r for r in rows if not (isinstance(r, dict) and r.get("vid") == vid)]
                if len(keep) != len(rows):
                    stat["attempts"] += len(rows) - len(keep)
                    _save(f, keep)
        f = d / "notes.json"
        if f.exists():
            n = _load(f, {})
            if isinstance(n, dict):
                hit = 0
                for k in [k for k, v in (n.get("sentences") or {}).items() if isinstance(v, dict) and v.get("vid") == vid]:
                    n["sentences"].pop(k, None); hit += 1
                stat["sentences"] += hit
                wh = 0
                for k in [k for k, v in (n.get("words") or {}).items() if isinstance(v, dict) and v.get("vid") == vid]:
                    n["words"].pop(k, None); wh += 1
                stat["words"] += wh
                if hit or wh:
                    _save(f, n)
        f = d / "verify.json"
        if f.exists():
            vv = _load(f, {})
            if isinstance(vv, dict) and vid in vv:
                vv.pop(vid, None); stat["verify"] += 1; _save(f, vv)
    return stat

# ---------------------------------------------------------------- 2단계 완료
STAGE = "stage.json"


def _stage() -> dict:
    d = _load(_p(STAGE), {})
    return d if isinstance(d, dict) else {}


GOAL_SECS = 180


def stage_of(vid: str, n_segs: int = 0) -> dict:
    rec = (_stage().get(_today().isoformat()) or {}).get(vid) or {}
    hear = len(rec.get("listen") or [])
    sh = len(rec.get("shadow") or [])
    secs = int(rec.get("secs", 0))
    n = int(n_segs or 0)
    time_ok = secs >= GOAL_SECS
    listen_ok = bool(n) and hear >= n
    shadow_ok = sh >= 1
    return {"listen": hear, "shadow": sh, "n": n, "secs": min(secs, GOAL_SECS),
            "goal": GOAL_SECS, "time_ok": time_ok,
            "listen_ok": listen_ok, "shadow_ok": shadow_ok,
            "stage1": bool(rec.get("ok")) or (time_ok and listen_ok and shadow_ok)}


def stage_event(vid: str, kind: str, idx: int, n_segs: int = 0) -> dict:
    """Stage 1(오늘 학습) 진행 기록.
    조건 = 대본 전체 1회 청취(문장별) + 섀도잉 1문장 이상."""
    d = _stage()
    day = _today().isoformat()
    d.setdefault(day, {})
    rec = d[day].setdefault(vid, {"listen": [], "shadow": [], "secs": 0, "ok": False})
    rec.setdefault("secs", 0)
    if kind == "time":
        try:
            add = max(0, min(120, int(idx)))
        except (TypeError, ValueError):
            add = 0
        rec["secs"] = min(GOAL_SECS, int(rec.get("secs", 0)) + add)
    else:
        key = "listen" if kind == "listen" else "shadow"
        i = int(idx)
        if i >= 0 and i not in rec[key]:
            rec[key].append(i)
    n = int(n_segs or 0)
    if n > 0 and len(rec["listen"]) >= n and len(rec["shadow"]) >= 1 and int(rec.get("secs", 0)) >= GOAL_SECS:
        rec["ok"] = True
    d[day][vid] = rec
    while len(d) > 90:
        d.pop(sorted(d)[0], None)
    _save(_p(STAGE), d)
    return stage_of(vid, n)


def stage_days() -> set[str]:
    out = set()
    for day, vids in (_stage() or {}).items():
        if any((v or {}).get("ok") for v in (vids or {}).values()):
            out.add(day)
    return out


# ---------------------------------------------------------------- 복습(SRS)
REVIEW = "review.json"
REVIEW_STEPS = (1, 3, 7, 21, 60)


def _review() -> dict:
    d = _load(_p(REVIEW), {})
    return d if isinstance(d, dict) else {}


def _cloze(text: str, word: str) -> str:
    if not text or not word:
        return text or ""
    pat = re.compile(r"\b" + re.escape(word) + r"([a-z]{0,3})\b", re.I)
    return pat.sub("____", text, count=1)


def _due_ok(due: str) -> bool:
    """복습 예정 도달 여부. 날짜(YYYY-MM-DD) 또는 분 단위(YYYY-MM-DDTHH:MM)."""
    if not due:
        return True
    try:
        if "T" in due:
            return due <= datetime.now().isoformat(timespec="minutes")
        return due <= _today().isoformat()
    except Exception:
        return True


def review_deck(videos: dict) -> dict:
    """단어·문장을 하나의 복습 덱으로 합친다 (문맥 Cloze 카드)."""
    n = _notes()
    r = _review()
    today = _today().isoformat()
    cards = []

    for key, w in (n.get("words") or {}).items():
        cid = "w:" + key
        st = r.get(cid) or {}
        v = videos.get(w.get("vid") or "") or {}
        seg = None
        try:
            seg = (v.get("segs") or [])[int(w.get("idx", -1))]
        except Exception:
            seg = None
        ctx = w.get("ctx", "") or ((seg or {}).get("en") or "")
        cards.append({
            "id": cid, "kind": "word", "key": key,
            "answer": w.get("word") or key,
            "meaning": (w.get("meaning") or _ko_cached(w.get("word") or key)),
            "cloze": _cloze(ctx, w.get("word") or key),
            "ko": (seg or {}).get("ko", "") or "",
            "vid": w.get("vid", ""), "idx": int(w.get("idx", -1)),
            "due": st.get("due") or today, "step": int(st.get("step", 0)),
            "seen": int(st.get("seen", 0)), "lapses": int(st.get("lapses", 0)),
            "is_due": _due_ok(st.get("due") or ""),
        })

    for key, s in (n.get("sentences") or {}).items():
        cid = "s:" + key
        st = r.get(cid) or {}
        cards.append({
            "id": cid, "kind": "sent", "key": key,
            "answer": s.get("en", ""), "meaning": s.get("ko", ""),
            "cloze": s.get("ko", "") or "____",
            "ko": s.get("ko", ""),
            "vid": s.get("vid", ""), "idx": int(s.get("idx", -1)),
            "due": st.get("due") or today, "step": int(st.get("step", 0)),
            "seen": int(st.get("seen", 0)), "lapses": int(st.get("lapses", 0)),
            "is_due": _due_ok(st.get("due") or ""),
        })

    cards.sort(key=lambda c: (c["due"], c["kind"]))
    due = [c for c in cards if c["is_due"]]
    return {"cards": cards, "due": len(due), "today": today,
            "n_word": len([c for c in cards if c["kind"] == "word"]),
            "n_sent": len([c for c in cards if c["kind"] == "sent"])}


def review_grade(cid: str, grade: int) -> dict:
    """0=모름(10분 뒤) 1=어려움(1일) 2=괜찮음(3일) 3=쉬움(7일)"""
    r = _review()
    st = r.get(cid) or {"step": 0, "seen": 0, "lapses": 0, "due": ""}
    g = int(grade)
    step = int(st.get("step", 0))
    now = datetime.now()
    if g <= 0:
        st["step"] = 0
        st["lapses"] = int(st.get("lapses", 0)) + 1
        due = (now + timedelta(minutes=10)).isoformat(timespec="minutes")
        days, mins = 0, 10
    elif g == 1:
        st["step"] = max(step, 1)
        due = (_today() + timedelta(days=1)).isoformat()
        days, mins = 1, 0
    elif g == 2:
        st["step"] = min(step + 1, len(REVIEW_STEPS) - 1)
        due = (_today() + timedelta(days=3)).isoformat()
        days, mins = 3, 0
    else:
        st["step"] = min(step + 2, len(REVIEW_STEPS) - 1)
        due = (_today() + timedelta(days=7)).isoformat()
        days, mins = 7, 0
    st["seen"] = int(st.get("seen", 0)) + 1
    st["due"] = due
    st["last"] = _now()
    r[cid] = st
    _save(_p(REVIEW), r)
    return {"id": cid, "due": due, "step": st["step"], "days": days, "minutes": mins}


def prefetch_words(words, lang: str = "en") -> int:
    """등록 시점에 단어 뜻을 미리 받아 캐시에 채운다(사전 오프라인 대비)."""
    seen, hit = set(), 0
    for w in (words or []):
        k = re.sub(r"[^a-z0-9'\- ]", "", (w or "").lower()).strip()
        if not k or k in seen:
            continue
        seen.add(k)
        if not re.fullmatch(r"[a-z][a-z'\-]*", k):
            continue
        if len(seen) > 400:
            break
        try:
            d = _dict_lookup(k)
        except Exception:
            continue
        if (d or {}).get("found"):
            hit += 1
    return hit
