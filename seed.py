"""초기 데이터 시드

v3.4부터 **데모 영상은 만들지 않는다.** (토끼 영상 제거 요청)
빈 DB만 준비하고, 기존에 남아 있던 데모 레코드는 main.py 기동 시 자동으로 정리된다.

  data/videos.json      : {"videos": {}, "audios": {}}
  data/media/audios/    : (비어 있음)
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
MEDIA = DATA / "media" / "audios"

DEMO_VIDEO_IDS = ("vdemo0001", "vdemo0002")
DEMO_AUDIO_IDS = ("ademo0001",)


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)

    path = DATA / "videos.json"
    db = {"videos": {}, "audios": {}}
    if path.exists():
        try:
            old = json.loads(path.read_text("utf-8"))
            vs = old.get("videos", old) if isinstance(old, dict) else {}
            au = old.get("audios", {}) if isinstance(old, dict) else {}
            db["videos"] = {k: v for k, v in vs.items() if k not in DEMO_VIDEO_IDS}
            db["audios"] = {k: v for k, v in au.items() if k not in DEMO_AUDIO_IDS}
        except Exception:
            pass
    path.write_text(json.dumps(db, ensure_ascii=False, indent=1), "utf-8")

    removed = 0
    for f in MEDIA.glob("ademo*.wav"):
        try:
            f.unlink()
            removed += 1
        except OSError:
            pass
    print(f"시드 완료: 영상 {len(db['videos'])}개 / 오디오 {len(db['audios'])}개"
          f" (데모 음원 {removed}개 정리) -> {path}")


if __name__ == "__main__":
    main()
