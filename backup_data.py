"""data/ 폴더 스냅샷 백업 (zip).

사용법
    python backup_data.py               # backups/ 에 zip 하나 생성
    python backup_data.py --keep 30     # 최근 30개만 남긴다 (기본 14)
    python backup_data.py --no-media    # 업로드 음원 제외하고 가볍게

왜 필요한가
    data/ 는 git 에 올리지 않는다(기기마다 다름). 그래서 학습기록·업로드 음원의
    사본은 이 스크립트가 유일한 안전장치다. 하루 한 번이면 충분하다.
"""
from __future__ import annotations

import argparse
import zipfile
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
OUT = BASE / "backups"

def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}GB"

def collect(with_media: bool) -> list[Path]:
    if not DATA.is_dir():
        return []
    files: list[Path] = []
    for p in DATA.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(DATA)
        if not with_media and rel.parts[:1] == ("media",):
            continue
        if p.suffix in {".tmp", ".part"} or ".corrupt-" in p.name:
            continue
        files.append(p)
    return files

def prune(keep: int) -> list[str]:
    zips = sorted(OUT.glob("data-*.zip"))
    removed: list[str] = []
    for p in (zips[:-keep] if keep > 0 else zips):
        try:
            p.unlink()
            removed.append(p.name)
        except OSError:
            pass
    return removed

def main() -> int:
    ap = argparse.ArgumentParser(description="data/ 스냅샷 백업")
    ap.add_argument("--keep", type=int, default=14, help="남길 백업 개수 (기본 14)")
    ap.add_argument("--no-media", action="store_true", help="data/media 제외")
    ap.add_argument("--auto", action="store_true",
                    help="오늘 백업이 이미 있으면 건너뛴다 (start.bat 용)")
    a = ap.parse_args()

    if a.auto:
        day = datetime.now().strftime("%Y%m%d")
        if list(OUT.glob(f"data-{day}-*.zip")):
            return 0                      # 오늘 백업이 이미 있으면 조용히 넘어간다

    files = collect(not a.no_media)
    if not files:
        print("백업할 파일이 없습니다 (data/ 가 비어 있음)")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = OUT / f"data-{stamp}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, p.relative_to(DATA).as_posix())

    total = sum(p.stat().st_size for p in files)
    print(f"백업 완료 : {target.name}")
    print(f"  파일 {len(files)}개 · 원본 {human(total)} · zip {human(target.stat().st_size)}")
    gone = prune(a.keep)
    if gone:
        print(f"  오래된 백업 {len(gone)}개 정리 (keep={a.keep})")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
