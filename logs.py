"""경량 오류 기록 — 파일 회전 + 메모리 링버퍼.

외부 의존성 없이 동작해야 한다(장애 상황에서도 기록이 남아야 하므로).
  log_err("score", e)          -> data/app.log 에 1줄 + 트레이스백, 링버퍼에 1건
  recent()                     -> /api/health 의 last_errors 로 노출
"""
from __future__ import annotations

import os
import threading
import time
import traceback
from pathlib import Path

BASE = Path(__file__).resolve().parent

# store.DATA 와 동일한 규칙(테스트 격리 LANGCLIP_DATA 포함)을 쓰되,
# store 를 import 하지 않는다 — 순환 import / 초기화 순서 문제를 피하기 위해.
_MAX_BYTES = 1_000_000   # 1MB
_KEEP = 3                # app.log, app.log.1, app.log.2
_RING_MAX = 20
_LOCK = threading.Lock()
_RING: list[dict] = []


def data_dir() -> Path:
    p = Path(os.getenv("LANGCLIP_DATA") or (BASE / "data"))
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return p


def _rotate(path: Path) -> None:
    try:
        if not path.exists() or path.stat().st_size < _MAX_BYTES:
            return
        for i in range(_KEEP - 1, 0, -1):
            src = path.parent / f"{path.name}.{i}"
            dst = path.parent / f"{path.name}.{i + 1}"
            if src.exists():
                os.replace(src, dst)
        os.replace(path, path.parent / f"{path.name}.1")
    except Exception:
        pass


def log_err(where: str, exc=None, msg: str | None = None) -> dict:
    """오류 1건 기록. 예외 객체/문자열/None 모두 허용. 절대 raise 하지 않는다."""
    text = (msg or "").strip()
    tb = ""
    if exc is not None:
        if isinstance(exc, str):
            text = f"{text} {exc}".strip()
        else:
            text = f"{text} {type(exc).__name__}: {exc}".strip()
            try:
                tb = "".join(
                    traceback.format_exception(type(exc), exc, exc.__traceback__)
                )[-2000:]
            except Exception:
                tb = ""
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "where": str(where)[:80],
        "msg": text[:400],
    }
    with _LOCK:
        _RING.append(rec)
        del _RING[:-_RING_MAX]
        try:
            path = data_dir() / "app.log"
            _rotate(path)
            with path.open("a", encoding="utf-8") as f:
                f.write(f"{rec['ts']} [{rec['where']}] {text[:2000]}\n")
                if tb:
                    f.write(tb + "\n")
        except Exception:
            pass
    return rec


def recent() -> list[dict]:
    """최근 오류 (최신순)."""
    with _LOCK:
        return list(reversed(_RING))
