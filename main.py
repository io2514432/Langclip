"""Langclip — 유튜브 문장별 셰도잉 (FastAPI) v4.2

구조
  영상(video)  : 유튜브 IFrame 으로 재생만. 오디오를 끄내지 않는다.
  오디오(audio) : 서버 보관. 소유·라이선스가 확보된 음원만 등록.
  대본(script) : 마크다운 한 장으로 문장/구간/영어/한국어를 관리 (script_md.py)
  기록(records): 채점 이력·연속 학습·북마크 (progress.py)

offset 정의
  audio_time = video_time - offset

v3.2 핵심
  · 자막이 없는 영상도 "마크다운 대본"만 있으면 문장별 학습이 된다.
  · GET/PUT /api/videos/{vid}/script 로 앱 안에서 바로 편집·저장.
  · 홈 화면용 진척도(오늘 암기율 / 연속일)와 오답노트·단어장 API 추가.
"""
from __future__ import annotations

import json
import math
import secrets
import os
import threading
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

import librosa
import numpy as np
from fastapi import Body, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.routing import APIRoute
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import build
import progress as prog
import script_md
import synclib
import verify
from store import DATA, storage
import feats
import logs

# APP_MODE=public → 공개 서버. 쓰기(등록·삭제·싱크·음원) 라우트를 아예 등록하지 않는다.
APP_MODE = os.getenv("APP_MODE", "admin").strip().lower()
PUBLIC = APP_MODE == "public"
COOKIE = "langclip_uid"


STATIC = Path(__file__).resolve().parent / "static"
DB = DATA / "videos.json"

SR = feats.SR          # 16000 Hz (feats.py 의 SR 과 동일)
MAX_UPLOAD = 60 * 1024 * 1024
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".flac"}
MIME = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
        ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg",
        ".webm": "audio/webm", ".flac": "audio/flac"}


app = FastAPI(title="Langclip Shadowing API", version=build.VERSION)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _uid_from(request: Request) -> str:
    """공개 서버: 쿠키의 방문자 id. 관리자 서버: 빈 값(=내 기록)."""
    raw = (request.cookies.get(COOKIE) or "").strip()
    return raw if re.fullmatch(r"[A-Za-z0-9]{6,40}", raw) else ""


if PUBLIC:
    from fastapi.responses import JSONResponse
    from starlette.exceptions import HTTPException as StarletteHTTPException

    @app.exception_handler(StarletteHTTPException)
    async def _public_404(request: Request, exc: StarletteHTTPException):
        """공개 모드에서는 '메서드 불일치'도 404 로 답한다.

        쓰기 라우트는 이미 등록되지 않았지만, 같은 경로의 GET 이 남아 있으면
        FastAPI 가 405 를 돌려준다. 405 는 '이 주소는 있으나 너는 못 쓴다'는
        신호라서, 존재 자체를 감추려고 404 로 바꾼다.
        """
        if exc.status_code in (405, 404):
            return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
        return JSONResponse({"ok": False, "error": str(exc.detail)}, status_code=exc.status_code)


@app.middleware("http")
async def user_profile(request: Request, call_next):
    """요청마다 학습 기록 주인을 정한다. 공개 서버는 방문자별로 분리."""
    uid = _uid_from(request) if PUBLIC else ""
    new_uid = ""
    if PUBLIC and not uid:
        uid = "u" + secrets.token_hex(9)
        new_uid = uid
    prog.set_uid(uid)
    response = await call_next(request)
    if new_uid:
        response.set_cookie(COOKIE, new_uid, max_age=60 * 60 * 24 * 365,
                            httponly=True, samesite="lax")
    response.headers["X-Langclip-Mode"] = APP_MODE
    return response



# --------------------------------------------------------------- 접근 모드
# ADMIN_TOKEN 을 설정하면 쓰기 API 는 토큰이 있어야만 동작한다.
#   설정 없음            → 혼자 쓰는 로컬 모드(모두 허용)
#   ADMIN_TOKEN=****      → 배포 모드(추가/싱크/음원/삭제는 관리자만)
def _token_from_file() -> str:
    """data/admin_token.txt 가 있으면 그것을 관리자 토큰으로 쓴다."""
    try:
        return (DATA / "admin_token.txt").read_text("utf-8").strip()
    except Exception:
        return ""


ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip() or _token_from_file()



def is_admin(request: Request | None) -> bool:
    if PUBLIC:
        return False
    if not ADMIN_TOKEN:
        return True
    if request is None:
        return False
    tok = (request.headers.get("x-admin-token") or "").strip()
    if not tok:
        tok = (request.cookies.get("langclip_admin") or "").strip()
    return tok == ADMIN_TOKEN


def require_admin(request: Request) -> None:
    if not is_admin(request):
        raise HTTPException(403, "관리자만 사용할 수 있는 기능입니다")


# --------------------------------------------------------------- store
def db() -> dict:
    raw = {}
    if DB.exists():
        try:
            raw = json.loads(DB.read_text("utf-8"))
        except Exception as ex:
            # 조용히 버리면 다음 저장에서 원본이 사라진다. 사본을 남기고 빈 상태로 시작.
            try:
                bad = DATA / f"videos.corrupt-{int(time.time())}.json"
                bad.write_bytes(DB.read_bytes())
                print(f"[Langclip] videos.json 파싱 실패({ex}) → {bad.name} 보존")
            except Exception as _e:
                logs.log_err("srv:db", _e)
            raw = {}
    if "videos" in raw or "audios" in raw:
        raw.setdefault("videos", {})
        raw.setdefault("audios", {})
        return raw
    return {"videos": raw, "audios": {}}          # 구버전 마이그레이션


def save_db(d: dict) -> None:
    """videos.json 을 통째로 다시 쓴다. 임시 파일 → 교체라 중간에 죽어도 원본이 남는다."""
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DB.with_suffix(DB.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), "utf-8")
    os.replace(tmp, DB)


def get_video(vid: str) -> dict:
    v = db()["videos"].get(vid)
    if not v:
        raise HTTPException(404, "영상을 찾을 수 없습니다")
    return v


def get_audio(aid: str) -> dict:
    a = db()["audios"].get(aid)
    if not a:
        raise HTTPException(404, "오디오를 찾을 수 없습니다")
    return a


# --------------------------------------------------------------- audio util
def probe_duration(data: bytes, suffix: str) -> float:
    with tempfile.TemporaryDirectory() as t:
        raw = os.path.join(t, "in" + suffix)
        open(raw, "wb").write(data)
        p = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", raw],
            capture_output=True, text=True,
        )
        try:
            return round(float(p.stdout.strip()), 2)
        except Exception:
            return 0.0


def _trim_take(y, sr=None) -> np.ndarray:
    """engine.preprocess 대체 — 피크 정규화 후 무음 30dB 트리밍."""
    sr = SR if sr is None else sr
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    if peak < 1e-4:
        raise ValueError("무음 또는 너무 조용한 입력입니다")
    y = (y / peak).astype(np.float32)
    y, _ = librosa.effects.trim(y, top_db=30, frame_length=1024, hop_length=160)
    if y.size < int(0.2 * sr):
        raise ValueError("0.2초 미만의 너무 짧은 입력입니다")
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    return (y / peak).astype(np.float32) if peak > 0 else y.astype(np.float32)


def timing_score(y: np.ndarray, seg_dur: float) -> dict:
    try:
        dur = len(_trim_take(y)) / SR
    except Exception:
        dur = len(np.asarray(y, dtype=np.float32)) / SR
    ratio = dur / max(seg_dur, 0.1)
    v = 100.0 * math.exp(-abs(math.log(max(ratio, 1e-6))) / 0.35)
    v = float(max(0.0, min(100.0, v)))
    return {"total": round(v, 1), "mode": "timing", "timing": round(v, 1),
            "has_pitch": False, "weights": {"timing": 1.0},
            "raw": {"dur_take": round(dur, 2), "dur_seg": round(seg_dur, 2),
                    "ratio": round(ratio, 3)}}


def _to_mono(y) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim > 1:
        y = y.mean(axis=1)
    return y.astype(np.float32)



def _smooth(x: np.ndarray, k: int) -> np.ndarray:
    if k <= 1:
        return x
    return np.convolve(x, np.ones(k) / k, mode="same")


def _prefix(x: np.ndarray):
    return (np.concatenate([[0.0], np.cumsum(x)]),
            np.concatenate([[0.0], np.cumsum(x * x)]))


def _xcorr_scan(a: np.ndarray, e: np.ndarray, L0: int, L1: int,
                min_frames: int) -> list[tuple[int, float]]:
    a1, a2 = _prefix(a)
    e1, e2 = _prefix(e)
    Na, Ne = len(a), len(e)
    out: list[tuple[int, float]] = []
    for L in range(L0, L1 + 1):
        i0, i1 = max(0, L), min(Na, Ne + L)
        n = i1 - i0
        if n < min_frames:
            continue
        j0, j1 = i0 - L, i1 - L
        sa, saa = a1[i1] - a1[i0], a2[i1] - a2[i0]
        se, see = e1[j1] - e1[j0], e2[j1] - e2[j0]
        den = (n * saa - sa * sa) * (n * see - se * se)
        if den <= 1e-12:
            continue
        r = (n * float(np.dot(a[i0:i1], e[j0:j1])) - sa * se) / math.sqrt(den)
        out.append((L, float(r)))
    return out


def _parabolic(rows: list[tuple[int, float]], L: int, hop: float) -> float:
    m = dict(rows)
    rm, r0, rp = m.get(L - 1), m.get(L), m.get(L + 1)
    if rm is None or rp is None or r0 is None:
        return float(L) * hop
    d = rm - 2 * r0 + rp
    if abs(d) < 1e-9:
        return float(L) * hop
    return (L + max(-0.5, min(0.5, 0.5 * (rm - rp) / d))) * hop


# --------------------------------------------------------------- transcript
SRT = re.compile(r"(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*(.*)")
RANGE = re.compile(r"^\[?(\d{1,2}:)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*[-~]\s*\[?(\d{1,2}:)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*(.*)$")
ONLY = re.compile(r"^\[?(\d{1,2}:)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?\]?\s*(.*)$")


def _sec(h, m, s, ms) -> float:
    v = int(m or 0) * 60 + int(s or 0)
    if h:
        v += int(str(h).rstrip(":")) * 3600
    return float(v) + (int((ms or "").ljust(3, "0")) / 1000.0 if ms else 0.0)


def _split_tc(tc: str):
    tc = tc.replace(",", ".")
    parts = tc.split(":")
    if len(parts) == 3:
        h, m, s = parts
        sec, _, ms = s.partition(".")
    else:
        h, m, s = "", parts[0], parts[1]
        sec, _, ms = s.partition(".")
    return h, m, sec, ms


def parse_transcript(text: str, total: float = 0.0) -> list[dict]:
    """구형 자막 파서(SRT 등). 남겨두는 이유: 기존 DB·테스트 호환."""
    lines = [l.rstrip() for l in (text or "").splitlines()]
    segs: list[dict] = []
    i = 0
    while i < len(lines):
        raw = lines[i].strip()
        if not raw or (
            raw.isdigit() and len(raw) <= 4 and i + 1 < len(lines) and SRT.search(lines[i + 1])
        ):
            i += 1
            continue
        m = SRT.search(raw)
        if m:
            st, en = _sec(*_split_tc(m.group(1))), _sec(*_split_tc(m.group(2)))
            body = m.group(3).strip()
            j = i + 1
            while j < len(lines) and lines[j].strip() and not SRT.search(lines[j]):
                body = (body + " " + lines[j].strip()).strip()
                j += 1
            if body:
                segs.append({"start": st, "end": en, "text": body})
            i = j
            continue
        m = RANGE.match(raw)
        if m:
            st = _sec(m.group(1), m.group(2), m.group(3), m.group(4))
            en = _sec(m.group(5), m.group(6), m.group(7), m.group(8))
            if m.group(9).strip():
                segs.append({"start": st, "end": en, "text": m.group(9).strip()})
            i += 1
            continue
        m = ONLY.match(raw)
        if m and (m.group(5) or "").strip():
            st = _sec(m.group(1), m.group(2), m.group(3), m.group(4))
            segs.append({"start": st, "end": st + 4.0, "text": m.group(5).strip()})
            i += 1
            continue
        if raw:
            segs.append({"start": None, "end": None, "text": raw})
        i += 1

    for k, s in enumerate(segs):
        if s["start"] is not None and (s["end"] is None or s["end"] <= s["start"]):
            nxt = next((x["start"] for x in segs[k + 1:] if x["start"] is not None), None)
            s["end"] = nxt if nxt and nxt > s["start"] else s["start"] + 4.0

    if segs and segs[0]["start"] is None:
        total = total if total and total > 0 else max(6.0, 2.6 * len(segs))
        step = total / len(segs)
        for k, s in enumerate(segs):
            s["start"], s["end"] = round(k * step, 2), round((k + 1) * step, 2)

    segs = [s for s in segs if s["text"]]
    for k, s in enumerate(segs):
        s["i"] = k
        s["start"], s["end"] = round(float(s["start"]), 2), round(float(s["end"]), 2)
        s.setdefault("en", s["text"])
        s.setdefault("ko", "")
    return segs


def yt_id(url: str) -> str:
    url = (url or "").strip()
    m = re.search(r"(?:v=|/shorts/|/embed/|youtu\.be/|/live/)([A-Za-z0-9_-]{11})", url)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url):
        return url
    raise HTTPException(422, "유튜브 URL에서 영상 ID를 찾지 못했습니다")


def audio_public(v: dict, d: dict) -> dict | None:
    aid = v.get("audio_id")
    if not aid or aid not in d["audios"]:
        return None
    a = d["audios"][aid]
    return {"id": a["id"], "url": storage.url(a["key"]) if storage.exists(a["key"]) else None,
            "offset": a.get("offset", 0.0), "dur": a.get("dur", 0.0),
            "title": a.get("title", ""), "source": a.get("source", "owned"),
            "license": a.get("license", "")}


def video_public(v: dict, d: dict) -> dict:
    # 재생·파형용이므로 url 이 있는 audio_public 을 써야 한다.
    # _feats_audio 는 내부 레코드(key)를 돌려주므로 url 이 없어
    # 브라우저가 원본 오디오를 못 받고 가짜 파형으로 떨어진다.
    au = audio_public(v, d)
    if au and not au.get("url"):
        au = None   # 파일이 없으면 재생·채점 불가 → 오디오 없음으로 취급
    st = prog.stage_of(v["id"], len(v["segs"]))
    return {"id": v["id"], "yt": v["yt"], "title": v["title"],
            "segs": v["segs"], "n": len(v["segs"]),
            "audio": au, "has_audio": au is not None,
            "complete": prog.is_complete(v["id"]),
            "lang": v.get("lang") or "en",
            "langs": v.get("langs") or [v.get("lang") or "en"],
            "stage": st, "stage1": st["stage1"],
            "medals": prog.medals(v["id"]),
            "verify": prog.verify_of(v["id"]), "pick": bool(v.get("pick"))}






def _prefetch_async(segs, lang: str = "en") -> None:
    """등록 직후 단어 뜻을 백그라운드로 미리 받아 둔다."""
    words: list[str] = []
    pat = re.compile(r"[^\W\d_]+(?:['\u2019\-][^\W\d_]+)*", re.UNICODE)
    for s in segs or []:
        words += pat.findall(s.get("en") or s.get("text") or "")
    if not words:
        return
    try:
        threading.Thread(target=prog.prefetch_words, args=(words, lang), daemon=True).start()
    except Exception as _e:
        logs.log_err("srv:_prefetch_async", _e)

# --------------------------------------------------------------- API
FEATS = DATA / "feats"
LANGCLIP_BUILD = build.VERSION


@app.get("/api/health")
def health(request: Request):
    return {"ok": True, "sr": SR, "storage": storage.name,
            "range": True, "linked_audio": True, "remote_open": True,
            "script_md": True, "version": app.version, "build": LANGCLIP_BUILD,
            "locked": bool(ADMIN_TOKEN) or PUBLIC, "admin": is_admin(request),
            "mode": APP_MODE, "name": "Langclip",
            "last_errors": logs.recent()}


@app.post("/api/client_log")
async def client_log(request: Request):
    """프런트 오류 수집. 실패해도 절대 500 을 내지 않는다."""
    try:
        p = await request.json()
    except Exception as ex:
        logs.log_err("api:client_log", ex, "bad json")
        return {"ok": False}
    if not isinstance(p, dict):
        return {"ok": False}
    where = str(p.get("where") or "?")[:60]
    msg = str(p.get("msg") or "")[:400]
    logs.log_err("web:" + where, None, msg)
    return {"ok": True}


# ---- 영상
@app.get("/api/videos")
def list_videos():
    d = db()
    out = [video_public(v, d) for v in d["videos"].values()]
    for o in out:
        o["memorized"] = prog.memorized(o["id"], o["n"])
    out.sort(key=lambda x: x["id"], reverse=True)
    return out


@app.get("/api/videos/{vid}")
def one_video(vid: str):
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    o = video_public(v, d)
    o["memorized"] = prog.memorized(vid, o["n"])
    return o



def _lines(t: str) -> list:
    return [x.strip() for x in (t or "").replace("\r\n", "\n").split("\n") if x.strip()]


def _segs_from_blocks(native: str, blocks: list, learn: str) -> tuple:
    """한국어 + 언어 블록을 줄 순서로 맞춰 세그먼트를 만든다."""
    ko = _lines(native)
    cols: dict = {}
    for b in blocks or []:
        code = str(b.get("lang") or "").strip().lower()
        if not code or code == "ko":
            continue
        cols[code] = _lines(b.get("text") or "")
    codes = [c for c in cols if cols[c]]
    if not codes:
        return [], "en", [], ["학습 언어 대본이 비어 있습니다"]
    lang = learn if learn in codes else codes[0]
    n = max([len(ko)] + [len(cols[c]) for c in codes])
    warns = []
    if ko and len(ko) != len(cols[lang]):
        warns.append("한국어 " + str(len(ko)) + "줄 · 학습 언어 " + str(len(cols[lang])) + "줄로 줄 수가 다릅니다")
    segs = []
    for i in range(n):
        main = cols[lang][i] if i < len(cols[lang]) else ""
        more = {c: cols[c][i] for c in codes if c != lang and i < len(cols[c])}
        if not main and not (ko[i] if i < len(ko) else ""):
            continue
        segs.append({"en": main, "ko": ko[i] if i < len(ko) else "",
                     "text": main, "more": more})
    return segs, lang, codes, warns


@app.post("/api/videos")
def add_video(payload: dict, request: Request):
    require_admin(request)
    """마크다운 대본(script) 또는 구형 자막(transcript)으로 영상을 등록한다."""
    md = (payload.get("script") or "").strip()
    title = (payload.get("title") or "").strip()
    url = (payload.get("url") or "").strip()
    duration = float(payload.get("duration") or 0)

    warnings: list[str] = []
    blocks = [b for b in (payload.get("blocks") or []) if isinstance(b, dict)]
    native = (payload.get("native") or "").strip()
    lang_code, codes = "en", ["en"]
    if blocks:
        segs, lang_code, codes, warnings = _segs_from_blocks(
            native, blocks, str(payload.get("lang") or ""))
        total = duration or max(6.0, 2.8 * len(segs))
        step = total / max(1, len(segs))
        for i, s in enumerate(segs):
            s["i"] = i
            s["start"] = round(i * step, 2)
            s["end"] = round((i + 1) * step, 2)
    elif md:
        sc = script_md.parse(md, duration)
        warnings = sc.warnings
        if not url:
            url = sc.yt
        if not title:
            title = sc.title
        if not duration:
            duration = sc.duration
        segs = script_md.to_segs(sc)
    else:
        segs = parse_transcript(payload.get("transcript", ""), duration)

    if not url:
        raise HTTPException(422, "유튜브 링크를 입력해주세요")
    if not segs:
        raise HTTPException(422, "대본을 해석하지 못했습니다. 형식을 확인해주세요.")
    vid_yt = yt_id(url)

    vid = "v" + os.urandom(4).hex()
    if not blocks:
        lang_code = str(payload.get("lang") or "en")
        codes = sorted({lang_code} | {k for s in segs for k in (s.get("more") or {})})
    rec = {"id": vid, "yt": vid_yt,
           "title": title[:80] or f"YouTube {vid_yt}",
           "thumb": f"https://i.ytimg.com/vi/{vid_yt}/mqdefault.jpg",
           "lang": lang_code, "langs": codes,
           "segs": segs, "audio_id": payload.get("audio_id"),
           "duration": round(float(duration or 0), 2)}
    d = db()
    d["videos"][vid] = rec
    if rec.get("audio_id"):
        compute_speak_ends(rec, d)
    save_db(d)
    _prefetch_async(segs, rec.get("lang") or "en")
    return {"ok": True, "video": rec, "segs": segs, "warnings": warnings,
            "markdown": script_md.serialize(rec["title"], vid_yt, segs, rec["duration"])}


def _feats_audio(v: dict, d: dict):
    """참조 특징용 오디오 해석. audio_public 이 404 를 던져도 다른 경로로 재시도한다."""
    try:
        au = audio_public(v, d)
        if au and au.get("key"):
            return au
    except Exception:
        pass
    a = (d.get("audios") or {}).get(v.get("audio_id") or "")
    if a and a.get("key"):
        return a
    inline = v.get("audio")
    if isinstance(inline, dict) and inline.get("key"):
        return inline
    return None


def compute_speak_ends(v: dict, d: dict) -> None:
    """segs 각 문장의 실제 발화 끝(speak_end) 추정 - 반복/쉐도잉용 구간.
    자막 싱크용 end(=다음 문장 시작)는 그대로 둔다. 꼬리 무음이 0.4초 이상일 때만 절삭한다."""
    try:
        au = _feats_audio(v, d)
        if not au or not au.get("key") or not storage.exists(au["key"]):
            return
        y, _ = librosa.load(storage.path(au["key"]), sr=SR, mono=True)
        y = _to_mono(y)
        off = float(au.get("offset") or 0.0)
        hop = max(1, int(0.03 * SR))
        for s in (v.get("segs") or []):
            try:
                st, en = float(s["start"]), float(s["end"])
                if en <= st + 0.2:
                    continue
                a = max(0, int((st - off) * SR))
                b = min(y.size, int((en - off) * SR))
                if b - a < hop * 3:
                    continue
                fr = np.abs(y[a:b])[:(b - a) // hop * hop].reshape(-1, hop).max(axis=1)
                peak = float(fr.max())
                if peak < 1e-4:
                    continue
                last = int(np.max(np.nonzero(fr >= peak * 0.12)))
                t_end = st + (last + 1) * hop / SR
                if t_end - st < 0.3 or en - t_end < 0.4:
                    continue
                s["speak_end"] = round(min(en - 0.05, t_end + 0.2), 2)
            except Exception:
                continue
    except Exception as ex:
        logs.log_err("srv:speak_end", ex)


@app.get("/api/videos/{vid}/feats")
def video_feats(vid: str):
    """브라우저 채점용 참조 특징 (구간별 int8 로그멜). 공개/관리자 모드 공통."""
    d = db()
    v = d["videos"].get(vid)
    if not v:
        raise HTTPException(409, "video not found in db")
    au = _feats_audio(v, d)
    if not au or not au.get("key") or not storage.exists(au["key"]):
        raise HTTPException(409, "no audio for this video")
    try:
        return feats.get_or_build(vid, au["key"], v.get("segs") or [], storage,
                                 audio_id=str(v.get("audio_id") or vid), feats_dir=FEATS)
    except Exception as ex:
        logs.log_err("api:feats", ex)
        raise HTTPException(500, "feature build failed")


@app.patch("/api/videos/{vid}/pick")
async def set_pick(vid: str, request: Request):
    """오늘의 학습에 띄울 영상 지정/해제 (관리자 전용)."""
    require_admin(request)
    try:
        body = await request.json()
    except Exception as ex:
        logs.log_err("api:set_pick", ex, "bad json")
        body = {}
    d = db()
    v = d["videos"].get(vid)
    if not v:
        raise HTTPException(404, "video not found")
    v["pick"] = bool(body.get("pick"))
    save_db(d)
    return {"ok": True, "pick": v["pick"]}

@app.delete("/api/videos/{vid}")
def del_video(vid: str, request: Request):
    """영상 삭제 — 대본·음원 파일·학습기록(시도·북마크·검증)을 함께 지워 정크를 남기지 않는다."""
    require_admin(request)
    d = db()
    v = d["videos"].pop(vid, None)
    audio_removed = None
    aid = (v or {}).get("audio_id")
    if aid:
        still = any(x.get("audio_id") == aid for x in d["videos"].values())
        if not still:
            a = d.get("audios", {}).pop(aid, None)
            if a:
                try:
                    storage.delete(a.get("key", ""))
                except Exception as _e:
                    logs.log_err("srv:del_video", _e)
                audio_removed = aid
    save_db(d)
    purged = prog.purge_video(vid)
    return {"ok": True, "removed": bool(v), "audio_removed": audio_removed,
            "purged": purged}


@app.patch("/api/videos/{vid}/segments/{idx}")
def patch_segment(vid: str, idx: int, payload: dict, request: Request):
    require_admin(request)
    """문장 start/end/text 수정 — ±0.1s 미세조정 UI가 이 엔드포인트를 쓴다."""
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    if not (0 <= idx < len(v["segs"])):
        raise HTTPException(404, "문장을 찾을 수 없습니다")
    s = v["segs"][idx]
    prev = {"start": s["start"], "end": s["end"], "text": s.get("text", "")}
    for k in ("start", "end"):
        if payload.get(k) is not None:
            s[k] = round(max(0.0, float(payload[k])), 3)
    if payload.get("text") is not None:
        s["text"] = str(payload["text"])[:300]
        s["en"] = s["text"]
    if payload.get("en") is not None:
        s["en"] = str(payload["en"])[:300]
        s["text"] = s["en"]
    if payload.get("ko") is not None:
        s["ko"] = str(payload["ko"])[:300]
    if s["end"] <= s["start"]:
        raise HTTPException(422, "종료 시간은 시작보다 뒤여야 합니다")
    d["videos"][vid] = v
    save_db(d)
    return {"ok": True, "seg": s, "prev": prev, "dur": round(s["end"] - s["start"], 3)}


# ---- 대본(마크다운)
@app.get("/api/videos/{vid}/script")
def get_script(vid: str):
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    md = script_md.serialize(v.get("title", ""), v.get("yt", ""), v["segs"],
                             float(v.get("duration") or 0))
    return {"ok": True, "markdown": md, "segs": v["segs"],
            "template": SCRIPT_TEMPLATE}


@app.patch("/api/videos/{vid}/segs")
def patch_segs(vid: str, payload: dict, request: Request):
    """문장(자막)을 직접 수정한다. 영어/한국어/시작·종료 시간만 바꾼다."""
    require_admin(request)
    items = payload.get("segs")
    if not isinstance(items, list) or not items:
        raise HTTPException(422, "문장 목록이 비어 있습니다")
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    cur = v.get("segs") or []
    out = []
    for i, it in enumerate(items):
        base = cur[i] if i < len(cur) else {}
        en = str(it.get("en", base.get("en", "")) or "").strip()[:500]
        ko = str(it.get("ko", base.get("ko", "")) or "").strip()[:500]
        try:
            st = round(float(it.get("start", base.get("start", 0.0))), 3)
            en_t = round(float(it.get("end", base.get("end", 0.0))), 3)
        except (TypeError, ValueError):
            raise HTTPException(422, f"{i + 1}번 문장의 시간 형식이 올바르지 않습니다")
        if st < 0 or en_t <= st:
            raise HTTPException(422, f"{i + 1}번 문장의 종료 시간이 시작보다 뒤여야 합니다")
        if not en:
            raise HTTPException(422, f"{i + 1}번 문장의 영어가 비어 있습니다")
        out.append({**base, "en": en, "ko": ko, "start": st, "end": en_t})
    out.sort(key=lambda x: x["start"])
    v["segs"] = out
    if "n" in v:
        v["n"] = len(out)
    d["videos"][vid] = v
    save_db(d)
    moved = prog.sync_sentence_notes(vid, out, v)   # 북마크 문장도 수정 내용을 따라간다
    return {"ok": True, "segs": out, "n": len(out), "notes_updated": moved}


@app.put("/api/videos/{vid}/script")
def put_script(vid: str, payload: dict, request: Request):
    require_admin(request)
    """대본을 통째로 교체한다. 저장 전에 파싱 오류를 그대로 돌려준다."""
    md = (payload.get("markdown") or "").strip()
    if not md:
        raise HTTPException(422, "대본이 비어 있습니다")
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    sc = script_md.parse(md, float(v.get("duration") or 0))
    segs = script_md.to_segs(sc)
    if not segs:
        raise HTTPException(422, "문장을 하나도 찾지 못했습니다. '## 0:04-0:07.5' 형식을 확인해주세요.")
    v["segs"] = segs
    if sc.title:
        v["title"] = sc.title[:80]
    if sc.duration:
        v["duration"] = round(sc.duration, 2)
    d["videos"][vid] = v
    save_db(d)
    return {"ok": True, "segs": segs, "warnings": sc.warnings, "title": v["title"],
            "markdown": script_md.serialize(v["title"], v.get("yt", ""), segs,
                                            float(v.get("duration") or 0))}


SCRIPT_TEMPLATE = """# 카페에서 주문하기
@yt aqz-KE-bpKQ
@duration 24

## 0:04-0:07.5
EN: Hi, can I get a latte please?
KO: 라떼 한 잔 주세요.

## 0:08-0:11.5
EN: Sure. What size would you like?
KO: 네, 어떤 사이즈로 드릴까요?

## 0:12-0:15
EN: Medium, please. For here.
KO: 중간 사이즈로 주세요. 매장에서 마실게요.
"""


# ---- 오디오 라이브러리
@app.get("/api/audios")
def list_audios():
    d = db()
    out = []
    for a in d["audios"].values():
        ok = storage.exists(a["key"])
        out.append({**{k: a.get(k) for k in ("id", "title", "dur", "offset", "source", "license")},
                    "url": storage.url(a["key"]) if ok else None,
                    "bytes": storage.size(a["key"]) if ok else 0,
                    "used_by": [v["id"] for v in d["videos"].values() if v.get("audio_id") == a["id"]]})
    out.sort(key=lambda x: x["id"], reverse=True)
    return out


@app.post("/api/audios")
async def add_audio(
    file: UploadFile = File(...),
    title: str = Form(""),
    offset: float = Form(0.0),
    source: str = Form("owned"),
    license: str = Form(""),
    request: Request = None,
):
    require_admin(request)
    """소유·라이선스가 확보된 음원만 등록한다. (제3자 영상 오디오 추출 금지)"""
    ext = os.path.splitext(file.filename or ".m4a")[1].lower()
    if ext not in AUDIO_EXT:
        raise HTTPException(415, f"지원하지 않는 형식: {ext}")
    data = await file.read()
    if not data:
        raise HTTPException(422, "빈 파일입니다")
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "60MB를 초과했습니다")
    dur = probe_duration(data, ext)
    aid = "a" + os.urandom(4).hex()
    key = f"audios/{aid}{ext}"
    try:
        url = storage.put(key, data)
    except Exception as e:
        raise HTTPException(500, f"저장 실패: {e}")
    d = db()
    d["audios"][aid] = {
        "id": aid, "key": key, "title": (title or file.filename or aid)[:80],
        "dur": dur, "offset": round(float(offset), 3), "source": source[:20],
        "license": license[:120], "mime": MIME.get(ext, "application/octet-stream"),
    }
    save_db(d)
    return {"ok": True, "id": aid, "url": url, "dur": dur, "offset": round(float(offset), 3)}


@app.patch("/api/audios/{aid}")
def patch_audio(aid: str, payload: dict, request: Request):
    require_admin(request)
    d = db()
    a = d["audios"].get(aid) or get_audio(aid)
    if payload.get("offset") is not None:
        a["offset"] = round(float(payload["offset"]), 3)
    for k in ("title", "license", "source"):
        if payload.get(k) is not None:
            a[k] = str(payload[k])[:120]
    d["audios"][aid] = a
    save_db(d)
    return a


@app.delete("/api/audios/{aid}")
def del_audio(aid: str, request: Request):
    require_admin(request)
    d = db()
    a = d["audios"].pop(aid, None)
    if a:
        storage.delete(a["key"])
        for v in d["videos"].values():
            if v.get("audio_id") == aid:
                v["audio_id"] = None
    save_db(d)
    return {"ok": True}


@app.post("/api/videos/{vid}/link-audio")
def link_audio(vid: str, payload: dict, request: Request):
    require_admin(request)
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    aid = payload.get("audio_id")
    if aid:
        a = d["audios"].get(aid)
        if not a:
            raise HTTPException(404, "오디오를 찾을 수 없습니다")
        v["audio_id"] = aid
        if payload.get("offset") is not None:
            a["offset"] = round(float(payload["offset"]), 3)
            d["audios"][aid] = a
    else:
        v["audio_id"] = None
    d["videos"][vid] = v
    if v.get("audio_id"):
        compute_speak_ends(v, d)
    save_db(d)
    return {"ok": True, "video": vid, "audio_id": v.get("audio_id"),
            "offset": d["audios"].get(aid, {}).get("offset") if aid else None}




# ---- 숙어(연속 단어 묶음) ---------------------------------------------------
@app.put("/api/videos/{vid}/phrases")
def put_phrases(vid: str, payload: dict, request: Request):
    """한 문장 안의 연속 단어를 숙어로 묶고 뜻을 지정한다. list=[] 이면 해제."""
    require_admin(request)
    seg_i = int(payload.get("seg", -1))
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    segs = v.get("segs") or []
    if not (0 <= seg_i < len(segs)):
        raise HTTPException(404, "문장을 찾을 수 없습니다")
    text = segs[seg_i].get("en") or segs[seg_i].get("text") or ""
    toks = [t for t in re.split(r"\s+", text) if t]
    out = []
    for it in (payload.get("list") or []):
        raw = it.get("toks")
        if isinstance(raw, list) and raw:
            idxs = sorted({int(x) for x in raw if str(x).lstrip("-").isdigit()})
        else:
            try:
                a, b = int(it.get("from")), int(it.get("to"))
                idxs = list(range(a, b + 1))
            except (TypeError, ValueError):
                continue
        idxs = [i for i in idxs if 0 <= i < len(toks)]
        if not idxs:
            continue
        word = " ".join(re.sub(r"^[^\w']+|[^\w']+$", "", toks[i]) for i in idxs).strip()
        if not word:
            continue
        out.append({"toks": idxs, "from": idxs[0], "to": idxs[-1],
                    "text": word[:80], "meaning": str(it.get("meaning") or "")[:120]})
    if out:
        segs[seg_i]["phr"] = out
    else:
        segs[seg_i].pop("phr", None)
    v["segs"] = segs
    d["videos"][vid] = v
    save_db(d)
    return {"ok": True, "seg": seg_i, "phrases": segs[seg_i].get("phr") or []}

# ---- offset 자동 캘리브레이션
def _range_response(path: Path, mime: str, request: Request) -> StreamingResponse | FileResponse:
    total = path.stat().st_size
    rng = request.headers.get("range")
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400"}
    if not rng:
        return FileResponse(str(path), media_type=mime, headers=headers)

    m = re.match(r"bytes=(\d*)-(\d*)", rng)
    if not m:
        return FileResponse(str(path), media_type=mime, headers=headers)
    start_s, end_s = m.group(1), m.group(2)
    if start_s == "":
        length = int(end_s or 0)
        start = max(0, total - length)
        end = total - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else total - 1
    end = min(end, total - 1)
    if start > end or start >= total:
        return StreamingResponse(iter(()), status_code=416,
                                 headers={**headers, "Content-Range": f"bytes */{total}"})
    length = end - start + 1

    def it():
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    return StreamingResponse(
        it(), status_code=206, media_type=mime,
        headers={**headers, "Content-Range": f"bytes {start}-{end}/{total}",
                 "Content-Length": str(length)},
    )


@app.get("/api/media/{key:path}")
def serve_media(key: str, request: Request):
    try:
        path = storage.path(key)
    except FileNotFoundError:
        raise HTTPException(404, "파일이 없습니다")
    except ValueError:
        raise HTTPException(400, "잘못된 경로")
    if path is None:
        return RedirectResponse(storage.url(key), status_code=307)
    mime = MIME.get("." + key.rsplit(".", 1)[-1].lower(), "application/octet-stream")
    return _range_response(path, mime, request)


# ---- 채점
@app.post("/api/videos/{vid}/segments/{idx}/score")
def score_segment(vid: str, idx: int, take: UploadFile | None = File(None),
                  local_total: str = Form("")):
    """브라우저 채점 결과를 진도 기록으로만 남긴다 (서버 채점 없음 · v8.14.27).

    점수는 브라우저(static/light.js 의 LCLight)가 결정한다. 서버는 local_total 을
    그대로 기록하므로 디코딩·DTW 를 수행하지 않는다. 녹음 파일(take)은 선택이며
    와도 읽지 않고 버린다.
    """
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    if not (0 <= idx < len(v["segs"])):
        raise HTTPException(404, "문장을 찾을 수 없습니다")
    seg = v["segs"][idx]
    raw = str(local_total or "").strip()
    if not raw:
        raise HTTPException(422, "local_total(브라우저 점수)이 필요합니다")
    try:
        total = float(raw)
    except Exception:
        raise HTTPException(422, "local_total 형식이 올바르지 않습니다")
    if not (0 <= total <= 100):
        raise HTTPException(422, "local_total 은 0~100 이어야 합니다")
    seg_dur = max(0.3, float(seg["end"]) - float(seg["start"]))
    res = {"total": round(total, 1), "mode": "light", "local": True,
           "ref_dur": round(seg_dur, 2)}
    try:
        prog.record_attempt(vid, idx, res["total"], res["mode"])
    except Exception as _e:
        logs.log_err("srv:score_segment", _e)
    res["memorized"] = prog.memorized(vid, len(v["segs"]))
    return {"vid": vid, "idx": idx, "text": seg.get("en") or seg.get("text", ""),
            "ko": seg.get("ko", ""), **res}


# ---- 홈 진척도
@app.get("/api/progress")
def get_progress():
    d = db()
    return prog.progress(d["videos"])


# ---- 북마크 / 오답노트 / 단어장
@app.get("/api/notes")
def get_notes():
    return prog.notes()


@app.post("/api/notes/sentence")
def note_sentence(payload: dict):
    vid = str(payload.get("vid") or "")
    idx = int(payload.get("idx", -1))
    d = db()
    v = d["videos"].get(vid)
    if not v:
        raise HTTPException(404, "영상을 찾을 수 없습니다")
    if not (0 <= idx < len(v["segs"])):
        raise HTTPException(404, "문장을 찾을 수 없습니다")
    return prog.toggle_sentence(vid, idx, v["segs"][idx], v, str(payload.get("note") or ""))


@app.delete("/api/notes/sentence/{vid}/{idx}")
def unnote_sentence(vid: str, idx: int):
    return prog.toggle_sentence(vid, idx, {})


@app.post("/api/notes/word")
def note_word(payload: dict):
    return prog.toggle_word(str(payload.get("word") or ""),
                            str(payload.get("meaning") or ""),
                            str(payload.get("ctx") or ""),
                            str(payload.get("vid") or ""),
                            int(payload.get("idx", -1)),
                            bool(payload.get("toggle_only")))


@app.get("/api/words/{word}")
def word_info(word: str, lang: str = "en"):
    return prog.lookup(word, lang)





# ---- 2단계 완료 · 복습(SRS) -------------------------------------------------
@app.post("/api/progress/event")
def progress_event(payload: dict):
    """오늘 학습(Stage 1) 진행 기록. kind = listen | shadow"""
    vid = str(payload.get("vid") or "")
    if not vid:
        raise HTTPException(422, "영상 id가 없습니다")
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    kind = str(payload.get("kind") or "listen")
    arg = int(payload.get("secs", 0)) if kind == "time" else int(payload.get("idx", -1))
    return {"ok": True, **prog.stage_event(vid, kind, arg, len(v["segs"]))}


@app.get("/api/review")
def review_list():
    return prog.review_deck(db()["videos"])


@app.post("/api/review/grade")
def review_grade(payload: dict):
    cid = str(payload.get("id") or "")
    if not cid:
        raise HTTPException(422, "카드 id가 없습니다")
    try:
        g = int(payload.get("grade", 2))
    except (TypeError, ValueError):
        g = 2
    return {"ok": True, **prog.review_grade(cid, g)}

# ---- 유튜브 메타(제목 자동 채우기)
_YT_META: dict[str, dict] = {}


@app.get("/api/yt/meta")
def yt_meta(url: str = ""):
    """oEmbed 로 제목/채널을 가져온다. 실패하면 조용히 빈 값을 돌려준다."""
    yt = yt_id(url or "")
    if not yt:
        raise HTTPException(422, "유튜브 주소를 확인해주세요")
    hit = _YT_META.get(yt)
    if hit and time.time() - hit.get("at", 0) < 86400:
        return {**hit["data"], "cached": True}
    target = ("https://www.youtube.com/oembed?format=json&url="
              + urllib.parse.quote(f"https://www.youtube.com/watch?v={yt}", safe=""))
    data = {"ok": False, "id": yt, "title": "", "author": "",
            "thumb": f"https://i.ytimg.com/vi/{yt}/mqdefault.jpg"}
    try:
        req = urllib.request.Request(target, headers={
            "User-Agent": "Mozilla/5.0 (Langclip/4.0)", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=6) as r:
            j = json.loads(r.read().decode("utf-8"))
        data.update({"ok": bool(j.get("title")), "title": j.get("title", "")[:120],
                     "author": j.get("author_name", "")[:80]})
    except Exception as _e:
        logs.log_err("srv:yt_meta", _e)
    _YT_META[yt] = {"at": time.time(), "data": data}
    if len(_YT_META) > 500:
        for k in list(_YT_META)[:100]:
            _YT_META.pop(k, None)
    return data


# ---- 싱크(재생하며 타이밍 찍기)
@app.post("/api/sync/split")
def sync_split(payload: dict):
    """붙여넣은 대본 → 문장(영어/한국어) 목록. 타이밍은 아직 없음."""
    items = synclib.split_transcript(payload.get("text", ""),
                                     bool(payload.get("split_sentences", True)))
    if not items:
        raise HTTPException(422, "문장을 찾지 못했습니다. 한 줄에 한 문장씩 넣어주세요.")
    return {"ok": True, "items": items, "count": len(items)}


@app.post("/api/sync/apply")
def sync_apply(payload: dict, request: Request):
    require_admin(request)
    """재생하며 찍은 타이밍을 저장한다.

    {url, title, vid?, sentences:[{start,end,en,ko}], markdown?, duration?}
      · markdown 이 오면 그것을 정본으로 파싱(손으로 고친 값을 존중)
      · vid 가 있으면 그 영상의 대본을 교체, 없으면 새 영상 생성
    """
    d = db()
    vid = (payload.get("vid") or "").strip()
    md = (payload.get("markdown") or "").strip()
    duration = float(payload.get("duration") or 0)
    title = str(payload.get("title") or "").strip()
    url = str(payload.get("url") or "").strip()

    if md:
        sc = script_md.parse(md, duration)
        segs = script_md.to_segs(sc)
        warnings = sc.warnings
        if not title and sc.title:
            title = sc.title
        if not url and sc.yt:
            url = sc.yt
        if sc.duration:
            duration = sc.duration
    else:
        rows = []
        for it in (payload.get("sentences") or []):
            st = round(max(0.0, float(it.get("start") or 0)), 2)
            en = round(max(0.0, float(it.get("end") or 0)), 2)
            if en <= st:
                en = round(st + 0.2, 2)
            rows.append({"start": st, "end": en,
                         "en": str(it.get("en") or "").strip()[:300],
                         "ko": str(it.get("ko") or "").strip()[:300]})
        if not rows:
            raise HTTPException(422, "저장할 문장이 없습니다")
        warnings = synclib.validate(rows, duration)
        segs = [{"i": k, "start": r["start"], "end": r["end"], "en": r["en"],
                 "ko": r["ko"], "text": r["en"]} for k, r in enumerate(rows)]

    if not segs:
        raise HTTPException(422, "문장을 해석하지 못했습니다")

    if vid and vid in d["videos"]:
        v = d["videos"][vid]
    else:
        if not url:
            raise HTTPException(422, "쇼츠 주소가 필요합니다")
        vid = "v" + os.urandom(4).hex()
        yt = yt_id(url)
        d["videos"][vid] = {"id": vid, "yt": yt, "title": title[:80] or f"YouTube {yt}",
                            "thumb": f"https://i.ytimg.com/vi/{yt}/mqdefault.jpg",
                            "segs": segs, "audio_id": payload.get("audio_id"),
                            "duration": round(duration, 2)}
        save_db(d)
        rec = d["videos"][vid]
        return {"ok": True, "video": rec, "segs": segs, "warnings": warnings,
                "created": True,
                "markdown": script_md.serialize(rec["title"], rec["yt"], segs,
                                                float(rec.get("duration") or 0))}

    v["segs"] = segs
    if title:
        v["title"] = title[:80]
    if duration:
        v["duration"] = round(duration, 2)
    d["videos"][vid] = v
    save_db(d)
    return {"ok": True, "video": v, "segs": segs, "warnings": warnings, "created": False,
            "markdown": script_md.serialize(v.get("title", ""), v.get("yt", ""), segs,
                                            float(v.get("duration") or 0))}



# ---- 학습 완료 검증 (3단계)

@app.post("/api/videos/{vid}/verify/check")
def verify_check(vid: str, payload: dict):
    """백지 테스트(전체 타이핑)를 채점한다. 통과하면 그 쇼츠는 학습 완료."""
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    res = verify.judge(v["segs"], payload.get("typed") or {}, v.get("lang") or "en")
    rec = prog.record_verify(vid, res)
    return {**res, **rec, "complete": prog.is_complete(vid),
            "completed": prog.completed_count()}


@app.post("/api/videos/{vid}/test/grade")
def test_grade(vid: str, payload: dict):
    """초급·중급 테스트 결과 저장. 80점 이상이면 암송 완료."""
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    try:
        pct = max(0.0, min(100.0, float(payload.get("score") or 0)))
    except (TypeError, ValueError):
        pct = 0.0
    MODE_ALIAS = {"beginner": "beginner", "inter": "intermediate",
                  "intermediate": "intermediate",
                  "recall": "advanced", "advanced": "advanced"}
    mode = MODE_ALIAS.get(str(payload.get("mode") or "beginner"), "beginner")
    passed = pct >= verify.PASS_SCORE
    res = {
        "passed": passed,
        "score": pct,
        "headline": mode,
        "stages": {mode: {"passed": passed, "score": pct,
                          "hit": payload.get("ok"), "total": len(v["segs"])}},
    }
    rec = prog.record_verify(vid, res)
    return {**rec, "mode": mode, "score": pct, "passed": passed,
            "complete": prog.is_complete(vid), "completed": prog.completed_count()}


@app.delete("/api/videos/{vid}/verify")
def reset_verify(vid: str, request: Request):
    require_admin(request)
    prog.reset_verify(vid)
    return {"ok": True, "complete": False}


# ---- 공개 모드: 쓰기 라우트 제거 (등록·삭제·싱크·음원 업로드는 존재하지 않는다)
PUBLIC_ALLOW = {
    ("GET", "/api/health"),
    ("GET", "/api/media/{key:path}"),
    ("GET", "/api/videos"),
    ("GET", "/api/videos/{vid}"),
    ("GET", "/api/videos/{vid}/script"),
    ("POST", "/api/videos/{vid}/segments/{idx}/score"),
    ("GET", "/api/progress"),
    ("GET", "/api/notes"),
    ("GET", "/api/review"),
    ("POST", "/api/review/grade"),
    ("POST", "/api/progress/event"),
    ("POST", "/api/notes/sentence"),
    ("DELETE", "/api/notes/sentence/{vid}/{idx}"),
    ("POST", "/api/notes/word"),
    ("GET", "/api/words/{word}"),
    ("POST", "/api/videos/{vid}/verify/check"),
    ("POST", "/api/videos/{vid}/test/grade"),
}
if PUBLIC:
    kept, dropped = [], []
    for r in app.router.routes:
        if isinstance(r, APIRoute):
            methods = {m.upper() for m in (r.methods or set())}
            if methods and not any((m, r.path) in PUBLIC_ALLOW for m in methods):
                dropped.append(f"{'/'.join(sorted(methods))} {r.path}")
                continue
        kept.append(r)
    app.router.routes = kept
    print(f"[Langclip] 공개 모드 · 쓰기 라우트 {len(dropped)}개 제거")
    for d in dropped:
        print("   -", d)


# ---- 정적
@app.get("/admin")
def admin_login(request: Request):
    """관리자 링크: /admin?token=*** → 쿠키 저장 후 앱으로 이동"""
    tok = (request.query_params.get("token") or "").strip()
    resp = RedirectResponse("/", status_code=302)
    if ADMIN_TOKEN and tok == ADMIN_TOKEN:
        resp.set_cookie("langclip_admin", tok, max_age=60 * 60 * 24 * 30,
                        httponly=True, samesite="lax")
    return resp


# ---- 브라우저 채점 참조 특징 (별칭 경로: 공개 모드에서도 항상 등록된다)
@app.get("/api/feats/{vid}")
def feats_alias(vid: str):
    d = db()
    v = d["videos"].get(vid) or get_video(vid)
    au = _feats_audio(v, d)
    if not au or not au.get("key") or not storage.exists(au["key"]):
        raise HTTPException(409, "no audio for this video")
    try:
        return feats.get_or_build(vid, au["key"], v.get("segs") or [], storage,
                                 audio_id=str(v.get("audio_id") or vid), feats_dir=FEATS)
    except Exception as ex:
        logs.log_err("api:feats", ex)
        raise HTTPException(500, "feature build failed")


# ---- 진단: 브라우저 채점이 왜 실패하는지 한 번에 보여준다
@app.get("/api/diag/feats/{vid}")
def diag_feats(vid: str):
    d = db()
    v = d["videos"].get(vid)
    out = {"vid": vid, "found": bool(v), "data_dir": str(DATA)}
    try:
        mp = DATA / "media" / "audios"
        out["media_files"] = sorted(x.name for x in mp.glob("*"))[:12] if mp.exists() else []
        fp = DATA / "feats"
        out["feats_cache"] = sorted(x.name for x in fp.glob("*.json"))[:12] if fp.exists() else []
    except Exception as ex:
        out["fs_err"] = str(ex)
    if not v:
        out["db_ids"] = list(d["videos"])[:10]
        return out
    aid = v.get("audio_id")
    audios = d.get("audios") or {}
    a = audios.get(aid) if aid else None
    out.update({
        "audio_id": aid,
        "audios_count": len(audios),
        "audios_ids": list(audios)[:10],
        "audio_record": a,
        "inline_audio": v.get("audio"),
        "segs": len(v.get("segs") or []),
        "has_audio_flag": (video_public(v, d) or {}).get("has_audio"),
    })
    key = (a or {}).get("key") or ((v.get("audio") or {}) if isinstance(v.get("audio"), dict) else {}).get("key")
    out["resolved_key"] = key
    if key:
        try:
            out["exists"] = bool(storage.exists(key))
        except Exception as ex:
            out["exists_err"] = str(ex)
    return out


# ---- 정적 파일 마운트 (반드시 마지막) ----
#   '/' 마운트는 모든 경로를 먼저 삼킨다. 이 줄 뒤에 @app.get 을 추가하면
#   라우트는 등록되지만 절대 도달하지 못한다(404). 새 API 는 이 줄 위에 둘 것.
app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
