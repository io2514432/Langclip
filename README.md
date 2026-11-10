# Langclip

유튜브 쇼츠를 문장 단위로 따라 말하는 영어 쉐도잉 학습 앱.
한 문장씩 듣고 → 따라 말하고 → 채점받고 → 3단계 검증으로 "외웠는지" 확인한다.

- 서버: FastAPI + librosa (피치·음색·리듬 신호처리 채점)
- 화면: 순수 HTML/CSS/JS (프레임워크 없음), 390×844 폰 프레임
- 유튜브는 IFrame Player 로만 재생한다. **오디오를 추출하지 않는다.**

## 처음부터 실행 (새 컴퓨터)

```bash
# 1. 가져오기
git clone <이 저장소 주소> langclip && cd langclip

# 2. 가상환경 (한 번만)
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 3. 의존성 (한 번만)
pip install -r requirements.txt

# 4. 실행
start.bat                        # 관리자 서버  http://127.0.0.1:8000
tunnel.bat                       # 공개 서버    https://....trycloudflare.com (친구용)
```

Python 3.11 이상. **ffmpeg 는 필수다** — 모든 녹음 채점이 ffmpeg 로 16kHz 모노 WAV 를 만들기 때문이다. (없으면 채점이 400 으로 실패한다)

## 포트

| 파일 | 모드 | 포트 | 용도 |
|---|---|---|---|
| `start.bat` | admin | 8000 | 나만. 영상 등록·삭제·싱크 편집 |
| `public.bat` | public | 8001 | 친구용. 쓰기 API 자체가 없음 |
| `tunnel.bat` | public | 8001+터널 | 공개 서버를 HTTPS 로 노출 |

## 폴더

```
main.py          FastAPI 앱 (모든 라우트)
engine.py        librosa 4축 채점
verify.py        3단계 검증 판정
progress.py      학습기록·연속학습·XP (사용자별 분리)
store.py         로컬/S3 스토리지
synclib.py       대본-영상 싱크 계산
script_md.py     대본 파싱
static/          index.html · app.js · style.css · sync.js
test_*.py        회귀 테스트 (python test_parse.py 등)
backup_data.py   data/ 스냅샷 백업 (zip)
data/            실행 데이터 — git 에 올리지 않는다
```

## 테스트

```bash
python test_parse.py      # 대본 파서
python test_sync.py       # 싱크 26항목
python test_features.py   # 기능 9항목
node --check static/app.js
```

## 데이터는 git 에 넣지 않는다

`data/` 는 기기마다 다르고(학습기록·업로드 음원) 커밋하면 충돌만 난다.
코드·문서·설정은 git 으로 관리하고, `data/` 는 각 기기에만 둔다.
`python backup_data.py` 로 `data/` 스냅샷(zip)을 `backups/` 에 남긴다. 기본 14개 보관.

## 비밀

`ADMIN_TOKEN` 은 환경변수 또는 `data/admin_token.txt` 에서 읽는다. 둘 다 git 에 올리지 않는다.
