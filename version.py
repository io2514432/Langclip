"""Langclip 버전 백업 · 되돌리기

왜 필요한가
  업데이트할 때마다 코드가 통째로 덮어써지고, 어느 버전이 어땠는지 확인할 방법이 없었다.
  여기서는 코드와 학습기록을 backups/ 아래에 버전별로 통째로 복사해 둔다.
  되돌릴 때는 그 폴더를 그대로 다시 덮어쓰면 끝이다. (git 설치 불필요)

사용법 (PowerShell 또는 cmd)
  python version.py list                  저장된 버전 보기
  python version.py save                  지금 상태를 현재 버전 번호로 저장 (메모 입력)
  python version.py save v4.3 "메모"      번호·메모 직접 지정
  python version.py diff v4.1             지금 코드와 v4.1 의 차이 보기
  python version.py restore v4.1          v4.1 코드로 되돌리기 (되돌리기 전 자동 백업)
  python version.py restore v4.1 --data   학습기록(notes/verify/attempts)까지 함께 되돌리기

저장 대상
  코드  .py .bat .md .txt .html .css .js .svg .json  (data/, backups/, __pycache__ 제외)
  기록  data/attempts.json · notes.json · verify.json  + data/users/<uid>/ 의 같은 파일들
  제외  영상·음원 파일, 사용자가 추가한 data/media (용량이 큼)
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKUPS = ROOT / "backups"
INDEX = BACKUPS / "index.json"

CODE_EXT = {".py", ".bat", ".md", ".txt", ".html", ".css", ".js", ".svg",
            ".json", ".webmanifest", ".ico", ".png"}
SKIP_DIRS = {"backups", "data", "__pycache__", ".git", ".venv", "venv", "media", "node_modules"}
SKIP_SUFFIX = {".tgz", ".zip", ".log", ".pyc", ".wav", ".mp3", ".m4a", ".mp4"}
DATA_NAMES = ["attempts.json", "notes.json", "verify.json"]


# ---------------------------------------------------------------- helpers
def _sha(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def _current_version() -> str:
    try:
        m = re.search(r'version="([^"]+)"', (ROOT / "main.py").read_text("utf-8"))
        return m.group(1) if m else "?"
    except Exception:
        return "?"


def _code_files(root: Path = ROOT) -> list[Path]:
    out = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if not p.is_file() or p.suffix.lower() in SKIP_SUFFIX:
            continue
        if p.suffix.lower() not in CODE_EXT:
            continue
        out.append(p)
    return out


def _data_files() -> list[Path]:
    out = []
    for name in DATA_NAMES:
        f = ROOT / "data" / name
        if f.is_file():
            out.append(f)
    users = ROOT / "data" / "users"
    if users.is_dir():
        for u in sorted(users.iterdir()):
            for name in DATA_NAMES:
                f = u / name
                if f.is_file():
                    out.append(f)
    return out


def _index() -> list[dict]:
    try:
        d = json.loads(INDEX.read_text("utf-8"))
        return d if isinstance(d, list) else []
    except Exception:
        return []


def _save_index(rows: list[dict]) -> None:
    BACKUPS.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(rows, ensure_ascii=False, indent=1), "utf-8")


def _norm(version: str) -> str:
    """'4.2' 와 'v4.2' 를 같은 이름으로 취급한다."""
    v = (version or "").strip()
    if _looks_version(v) and not v.lower().startswith("v"):
        v = "v" + v
    return v


def _find(version: str) -> Path | None:
    if not BACKUPS.is_dir():
        return None
    want = _norm(version)
    exact = BACKUPS / want
    if exact.is_dir():          # 이름이 정확히 같은 백업을 우선한다
        return exact
    for d in sorted(BACKUPS.iterdir(), reverse=True):
        if d.is_dir() and (d.name == want or d.name.startswith(want + "_")):
            return d
    return None


# ---------------------------------------------------------------- commands
def _looks_version(s: str) -> bool:
    return bool(re.fullmatch(r"v?[0-9]+(\.[0-9]+)*[a-z]?", (s or "").strip(), re.I))


def cmd_save(version: str = "", note: str = "") -> int:
    version = _norm((version or "").strip() or _current_version())
    if not version or version == "?":
        version = "snapshot"
    name = version
    n = 2
    while (BACKUPS / name).exists():
        name = f"{version}_{n}"
        n += 1
    dest = BACKUPS / name
    (dest / "code").mkdir(parents=True)

    files = _code_files()
    for f in files:
        rel = f.relative_to(ROOT)
        target = dest / "code" / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)

    data = _data_files()
    for f in data:
        rel = f.relative_to(ROOT)
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)

    info = {
        "version": version,
        "folder": name,
        "saved_at": datetime.now().isoformat(timespec="seconds"),
        "note": note.strip()[:200],
        "files": len(files),
        "data_files": len(data),
        "key_sha": {str(f.relative_to(ROOT)): _sha(f) for f in files
                    if f.suffix == ".py" or f.name in ("app.js", "index.html", "style.css")},
    }
    (dest / "info.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), "utf-8")

    rows = _index()
    rows = [r for r in rows if r.get("folder") != name] + [info]
    rows.sort(key=lambda r: r.get("saved_at", ""), reverse=True)
    _save_index(rows)

    size = sum(p.stat().st_size for p in dest.rglob("*") if p.is_file()) / 1024
    print(f"[저장] {name}  ({len(files)}개 코드 파일, {len(data)}개 기록 파일, {size:.0f}KB)")
    print(f"       위치: {dest}")
    if note:
        print(f"       메모: {note}")
    return 0


def cmd_list() -> int:
    rows = _index()
    if not rows:
        print("저장된 버전이 없습니다.  python version.py save  로 지금 상태를 저장하세요.")
        return 0
    print(f"현재 코드 버전: {_current_version()}\n")
    print(f"{'#':<3} {'폴더':<20} {'저장 시각':<20} {'파일':>5}  메모")
    print("-" * 78)
    for i, r in enumerate(rows, 1):
        ts = (r.get("saved_at") or "").replace("T", " ")[:16]
        print(f"{i:<3} {r.get('folder','')[:20]:<20} {ts:<20} {r.get('files',0):>5}  {r.get('note','')}")
    print("\n되돌리기:  python version.py restore <폴더명>")
    return 0


def cmd_diff(version: str) -> int:
    d = _find(version)
    if not d:
        print(f"'{version}' 백업을 찾을 수 없습니다.  python version.py list")
        return 1
    snap = d / "code"
    old = {str(p.relative_to(snap)): p for p in snap.rglob("*") if p.is_file()}
    now = {str(p.relative_to(ROOT)): p for p in _code_files()}
    changed, added, removed = [], [], []
    for rel, p in now.items():
        if rel not in old:
            added.append(rel)
        elif _sha(p) != _sha(old[rel]):
            changed.append(rel)
    for rel in old:
        if rel not in now:
            removed.append(rel)
    print(f"비교: {d.name}  →  현재 ({_current_version()})\n")
    for title, rows in (("바뀐 파일", changed), ("새 파일", added), ("백업에만 있는 파일", removed)):
        print(f"{title} {len(rows)}개")
        for r in rows[:40]:
            print("   ", r)
        if len(rows) > 40:
            print(f"    ... 외 {len(rows)-40}개")
        print()
    return 0


def cmd_restore(version: str, with_data: bool = False) -> int:
    d = _find(version)
    if not d:
        print(f"'{version}' 백업을 찾을 수 없습니다.  python version.py list")
        return 1
    print(f"되돌립니다: {d.name}")
    print("되돌리기 직전 상태를 먼저 자동 저장합니다...")
    cmd_save(_current_version(), f"auto: restore 하기 전 ({d.name})")

    snap = d / "code"
    count = 0
    for p in snap.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(snap)
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, target)
        count += 1
    print(f"  코드 {count}개 파일 복원")

    if with_data:
        n = 0
        for p in d.rglob("*"):
            if not p.is_file() or "code" in p.relative_to(d).parts:
                continue
            if p.name not in DATA_NAMES:
                continue
            rel = p.relative_to(d)
            target = ROOT / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, target)
            n += 1
        print(f"  학습기록 {n}개 파일 복원")
    else:
        print("  학습기록은 그대로 두었습니다 (함께 되돌리려면 --data)")

    stale = []
    snap_rel = {str(p.relative_to(snap)) for p in snap.rglob("*") if p.is_file()}
    for p in _code_files():
        rel = str(p.relative_to(ROOT))
        if rel not in snap_rel:
            stale.append(rel)
    if stale:
        print(f"\n  참고: 이 버전에는 없던 파일이 {len(stale)}개 남아 있습니다")
        for s in stale[:10]:
            print("   ", s)
    print("\n이제 서버를 재시작하세요.  (정적 파일만 바뀌었다면 Ctrl+Shift+R)")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 0
    cmd = argv[1].lower()
    rest = argv[2:]
    if cmd in ("save", "s"):
        # 첫 인자가 버전처럼 생겼으면 번호, 아니면 메모로 취급
        if rest and _looks_version(rest[0]):
            return cmd_save(rest[0], " ".join(rest[1:]))
        return cmd_save("", " ".join(rest))
    if cmd in ("list", "ls"):
        return cmd_list()
    if cmd in ("diff", "d"):
        return cmd_diff(rest[0]) if rest else (print("버전을 지정하세요") or 1)
    if cmd in ("restore", "r"):
        if not rest:
            print("복원할 버전을 지정하세요:  python version.py restore v4.1")
            return 1
        return cmd_restore(rest[0], "--data" in rest)
    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
