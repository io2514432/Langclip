# Langclip 인수인계 문서

> 최종 갱신: 2026-11-11 20:30 (KST) · 대상 독자: 이 프로젝트를 처음 받는 개발자
> 저장소: https://github.com/io2514432/Langclip.git (구 주소 `langclip` 에서 리다이렉트)

---

## 1. 한 줄 요약

유튜브 쇼츠를 문장 단위로 끊어 **그림자처럼 따라 말하기(섀도잉)** 연습을 시키고, 녹음한 발화를 **브라우저에서 즉시 채점**하는 개인 학습 웹앱이다. 서버는 녹음 파일과 학습 기록만 보관한다.

---

## 2. 무엇을 하는 앱인가

1. 관리자가 유튜브 URL을 등록하면 자막을 문장 단위로 쪼갠다 (`segs`)
2. 학습자는 영상/대본을 보며 문장 하나를 고른다
3. **듣기 → 카운트다운 → 녹음** 3단계를 거쳐 따라 말한다
4. 녹음이 끝나면 **약 200~300ms 안에 점수**가 화면에 뜬다 (정확도 / 흐름, 각 50점)
5. 결과는 파형 비교 + 축별 막대로 표시되고, 진도·메달·"오늘의 영상"에 반영된다

채점은 두 축이다.

| 축 | 만점 | 계산 방법 |
|---|---|---|
| 정확도 | 50 | 원어민 구간과 내 녹음의 **로그멜 스펙트럼 DTW 거리** → 로지스틱 곡선 |
| 흐름 | 50 | 0.1초 이상 끊긴 구간 개수 × 9점 + 총 무음 시간(초) × 18점 감점 |

두 축 합이 총점(100점)이다. 이전에는 속도(길이 비율) 축이 있었으나, 원어민과 조금만 빨라도 과하게 깎여 제거했다.

---

## 3. 기술 스택

| 계층 | 사용 기술 |
|---|---|
| 백엔드 | Python 3.12, FastAPI, uvicorn (`--workers 1` **필수**) |
| 오디오 서버측 | numpy, soundfile(libsndfile), ffmpeg(구간 추출·변환) |
| 프런트 | 순수 HTML/CSS/JS (프레임워크 없음), Canvas 파형 |
| 브라우저 채점 | Web Audio API, OfflineAudioContext, 자체 FFT/DTW 구현 |
| 저장 | `data/videos.json`(영상·오디오 메타), SQLite `data/progress.db`(시도 기록), `data/feats/*.json`(참조 특징 캐시) |
| 배포 | GCP e2-micro(무료 티어) + systemd + Caddy(자동 HTTPS) |

---

## 4. 디렉터리 구조

```
C:\dev\langclip\            (로컬) / ~/langclip (GCP)
├─ main.py            # FastAPI 앱. 라우트 40여 개 (1,300줄대, 분리 필요)
├─ build.py           # VERSION 상수 (여기가 버전 원천)
├─ feats.py           # 서버측 참조 특징 생성·캐시 (int8 로그멜)
├─ engine.py          # (구) 서버 채점 엔진 — 현재는 기록용 경로에서만 사용
├─ progress.py        # SQLite 시도 기록, today_focus(), memorized()
├─ store.py           # DATA 경로, storage 추상화(local/remote)
├─ logs.py            # log_err(), 링버퍼 20건 → /api/health.last_errors
├─ verify.py          # 백지 테스트(한국어→영어 작문) 채점
├─ script_md.py       # 대본 마크다운 직렬화
├─ static/
│  ├─ index.html      # 단일 페이지. 스크립트 로드 순서 중요
│  ├─ style.css       # 전체 스타일 (끝에 버전별 오버라이드 블록이 쌓여 있음)
│  ├─ app.js          # 화면·리스트·진도 (2,700줄대)
│  ├─ scoring.js      # 섀도잉 UI + 채점 진입점 (lightPreScore → applyLocalScore)
│  ├─ light.js        # ★브라우저 채점 엔진 (FFT·VTLN·DTW·점수)
│  ├─ util.js         # esc/fmt/mmss/logErr
│  └─ proto-light.html# 채점 프로토타입 (개발용, 앱 동작과 무관)
├─ data/
│  ├─ videos.json     # {"videos": {id: ...}, "audios": {id: ...}}
│  ├─ progress.db     # SQLite
│  ├─ media/audios/   # 원본 mp3
│  ├─ feats/{vid}.json# 참조 특징 캐시 (영상당 ~59KB, gzip 후 ~20KB)
│  ├─ app.log         # 1MB × 3 로테이션
│  └─ admin_token.txt # 관리자 토큰
├─ selftest.mjs       # node 로 돌리는 헤드리스 검사 (36개)
├─ CHANGELOG.md
└─ DEPLOY_GCP.md      # 706줄 배포 가이드
```

---

## 5. 채점 파이프라인 (핵심)

### 5-1. 특징 정의 — 양쪽이 **반드시** 같아야 함

| 파라미터 | 값 |
|---|---|
| 샘플레이트 | 16000 Hz, 모노 |
| 창 / 홉 | 400 / 320 샘플 (25ms / 50fps) |
| FFT | 512 |
| 멜 밴드 | 24개, 80~7600Hz |
| 정규화 | log → CMN(채널 평균 제거) → 프레임 단위벡터 |
| 전송 | int8 양자화(×127) → base64 |

`feats.py` 와 `light.js` 상단 상수가 이 표와 일치한다. **한쪽만 바꾸면 점수가 조용히 틀어진다.**

### 5-2. 흐름

```
[최초 1회] 서버: GET /api/feats/{vid}
  └ feats.get_or_build() → 구간별 int8 로그멜 → data/feats/{vid}.json 캐시 (약 2초)

[매 녹음]
  브라우저: 녹음 Blob → decodeAudioData → 16k 리샘플
          → analyze() (FFT·로그멜·CMN·단위벡터)
          → VTLN α 0.88~1.12 스윕 → DTW 코사인 거리 (최솟값 채택)
          → 정확도(50) + 흐름(50) = 총점
          → 결과 화면 즉시 표시
  동시에: 녹음 + local_total 을 서버로 POST (진도 기록용, 화면엔 미반영)
```

VTLN(보컬 트랙 길이 정규화)은 화자 음색 차이를 흡수하기 위한 것이다. α가 1.05~1.10 근처로 잡히면 "남/여 또는 원어민과 성도 차이"가 큰 경우다.

### 5-3. 점수 곡선 조정점

`static/light.js` 상단 한 곳:

```js
var PT_PRON = 50, PT_FLUENT = 50, D0_SPEC = 0.55, K_SPEC = 6.0;
```

- `D0_SPEC` 올리면 관대해짐 (현재 0.55)
- `K_SPEC` 는 곡선 기울기 (현재 6.0)
- 흐름 감점 계수는 `fluencyScore()` 안 `gaps * 9 + (silent/50) * 18`

실측 기준(개발자 본인 vs 본인): 같은 문장 d=0.135, 다른 문장 d=0.510.

---

## 6. 모드와 포트

`APP_MODE` 환경변수 하나로 두 가지 인스턴스를 띄운다.

| 모드 | 포트 | 특징 |
|---|---|---|
| admin | 8000 | 쓰기 라우트 전부 활성, 관리자 토큰/쿠키 필요 |
| public | 8001 | 쓰기 라우트 미등록, 방문자별 학습기록 분리, `locked:true` |

**`--workers 1` 을 절대 바꾸지 말 것.** `videos.json` 을 프로세스 메모리 없이 파일로만 다루기 때문에, 워커가 2개 이상이면 동시 저장 시 기록이 유실된다.

---

## 7. 로컬 실행

```powershell
cd C:\dev\langclip
.\.venv\Scripts\Activate.ps1
# 두 개의 창에서 각각
$env:APP_MODE='admin';  .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
$env:APP_MODE='public'; .\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
.\start.bat        # 위 둘을 한 번에 띄우는 배치
```

- Python 실행: `./.venv/Scripts/python.exe`
- 테스트 시 `export PYTHONIOENCODING=utf-8` 필요 (Windows 기본 cp949 에서 한글 출력 오류)
- 검사: `node selftest.mjs`, `node --check static/*.js`, `./.venv/Scripts/python.exe -m py_compile main.py feats.py`

---

## 8. GCP 배포

| 항목 | 값 |
|---|---|
| 프로젝트 | `helical-canto-478323-h0` |
| VM | `langclip`, `us-central1-a`, e2-micro, Ubuntu 24.04 x86_64 |
| 고정 IP | `35.209.183.118` |
| 공개 URL | https://35.209.183.118.sslip.io (→ 8001) |
| 관리자 URL | https://35.209.183.118.sslip.io:8443/admin?token=… (→ 8000, basic auth) |
| SSH 사용자 | `io2514432`, 프로젝트 경로 `~/langclip` |

서비스/설정:

```
/etc/systemd/system/langclip.service        APP_MODE=public  → 127.0.0.1:8001 --workers 1
/etc/systemd/system/langclip-admin.service  APP_MODE=admin   → 127.0.0.1:8000 --workers 1
/etc/caddy/Caddyfile                        sslip.io 자동 HTTPS + gzip + 60MB body
방화벽                                      80/443 전체, 8443 은 allow-admin 태그만
```

무료 한도: e2-micro 1대 + 30GB 표준 디스크 + 월 egress 1GB. 스왑 2GB 설정됨.

배포 절차:

```bash
cd ~/langclip && git pull
sudo systemctl restart langclip langclip-admin
curl -s http://127.0.0.1:8001/api/health | grep -o '"version":"[^"]*"'
```

`main.py` 변경은 **재시작 필수**, 정적 파일(HTML/CSS/JS)은 하드 새로고침만으로 반영된다.

---

## 9. 데이터 모델

`data/videos.json`

```jsonc
{
  "videos": {
    "v37e7fd3b": {
      "id": "v37e7fd3b", "yt": "<youtube id>", "title": "...",
      "lang": "en", "langs": ["en","ko"],
      "segs": [{ "start": 1.2, "end": 3.4, "en": "...", "ko": "..." }],
      "audio_id": "a_xxx",          // ← data/audios 의 키
      "pick": true,                  // 관리자가 지정한 "오늘의 영상"
      "duration": 42.1
    }
  },
  "audios": {
    "a_xxx": { "id": "a_xxx", "key": "media/audios/xxx.mp3", "offset": 0.0, "dur": 42.1 }
  }
}
```

- `progress.db` : 시도(attempt) 기록. `progress.today_focus()` 가 "오늘의 학습"을 고른다(pick 우선).
- `data/feats/{vid}.json` : 참조 특징 캐시. 영상 삭제 시 남아도 무해.

---

## 10. 현재 진행 상황

### 완료

- P0~P2 버그 수정, 관측성(`logs.py`, `/api/health.last_errors`, `/api/client_log`, `LCUtil.logErr`)
- 셀프테스트 `selftest.mjs` 36/36
- 관리자 "오늘의 영상으로 설정" (`pick`)
- GCP 배포 전체(HTTPS, 관리자/공개 분리, 방화벽, 백업)
- **서버 참조 특징 API** `feats.py` + `GET /api/feats/{vid}`
- **브라우저 채점 엔진** `static/light.js` (VTLN·DTW)
- **채점 주체를 브라우저로 승격**, 서버 채점 폴백 제거
- **2축 50+50 점수**, 축 이름 `정확도` / `흐름`
- 원본 음원 없는 영상은 섀도잉 버튼 숨김
- 최신 커밋: `3cfc4be` (v8.14.22)

### 현재 차단(Blocker)

**`/api/feats/{vid}` 가 404 를 반환해 채점이 시작되지 않는다.** 로컬·GCP 공통.

확인된 사실:

| 확인 | 결과 |
|---|---|
| `GET /api/videos/{id}` | 200 (영상 정상) |
| `GET /api/feats/{id}` | 404, 본문 `{"ok":false,"error":"not_found"}` |
| `main.py` 내 feats 함수 정의 | 2개 (`video_feats`, `feats_alias`) |
| GCP `openapi.json` | `/api/feats/{vid}` **존재** |
| 로컬 `openapi.json` | 해당 경로 **미검출**(openapi 자체가 비활성일 가능성) |

`{"ok":false,"error":"not_found"}` 는 전역 예외 핸들러가 **404/405 를 뭉개는** 형식이다. 즉 ① 우리 코드가 낸 409(오디오 없음)가 아니라 ② 어딘가에서 404 가 발생했다는 뜻.

가설 두 가지:

- **A. 오디오 참조 불일치** — 영상의 `audio_id` 가 `audios` 사전에 없는 키를 가리킴. `audio_public()` 내부에서 404 를 던져 전역 핸들러가 삼킴. 목록의 `has_audio:true` 는 파일 존재 기준이라 참일 수 있음.
- **B. 라우트 미등록** — 모듈 로딩 단계에서 feats 블록이 실행되지 않음.

판별 명령 (로컬/GCP 양쪽):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8001/api/videos/<vid>/feats
# 409 → 가설 A,  404 → 가설 B
```

그리고 데이터 확인:

```bash
python3 - <<'PY'
import json; d=json.load(open("data/videos.json"))
v=next(iter(d["videos"].values())); print("audio_id:", v.get("audio_id"))
print("in audios:", v.get("audio_id") in d["audios"])
print("audio file:", (d["audios"].get(v.get("audio_id")) or {}).get("key"))
PY
```

### 다음 작업 (우선순위)

1. **feats 404 해결** (위 A/B 판별 후)
2. 오디오 없는 영상 정책: 등록 시 오디오 필수화 / 등록 시점에 특징 미리 생성 후 오디오 폐기
3. 억양·리듬 축 복원: `feats.py` 가 `rms`, `f0` 도 내려주면 4축 또는 3축 확장 가능
4. `uploadTake` 경량화: 점수만 JSON 전송(현재는 녹음 전체 업로드)
5. `main.py` 라우터 분리(1,300줄), GitHub Actions, 데이터 계층 정리

---

## 11. 반드시 알아야 할 함정

| 함정 | 내용 |
|---|---|
| PowerShell 5.1 | `&&` 미지원. `;` 사용 |
| 셸 히어독 | 닫는 토큰은 반드시 단독 줄. `$()` 는 셸이 먼저 해석하므로 JS 코드에 `$("#id")` 를 넣으면 깨진다 → `<<'PY'` 로 인용 |
| 인코딩 | Windows 기본 cp949. Python 실행 전 `PYTHONIOENCODING=utf-8` |
| `--workers 1` | 바꾸면 JSON 기록 유실 |
| 버전 범프 | `build.py VERSION` + `index.html` 의 `?v=` + `CHANGELOG.md` 세 곳 |
| Caddyfile | 문자열은 큰따옴표만 인식(작은따옴표 불가) |
| 캐시 | JS/CSS 는 `?v=` 로 캐시 버스트. 서비스워커 있으면 강력 새로고침 |
| 정적 vs 코드 | 정적 파일은 pull 만으로 반영, `main.py` 는 restart 필수 |

---

## 12. 디버깅 치트시트

```bash
# 서버 상태·최근 오류
curl -s http://127.0.0.1:8001/api/health

# 영상 목록 / 특정 영상
curl -s http://127.0.0.1:8001/api/videos
curl -s http://127.0.0.1:8001/api/videos/<vid>

# 참조 특징 생성 시간·크기
curl -s http://127.0.0.1:8001/api/feats/<vid> | head -c 200

# 브라우저 콘솔
LCScoreDiff.summary()   # {n, meanGap, meanAbsGap, meanMs} — 로컬/서버 점수 차이와 로컬 채점 시간
LCScoreDiff.list()      # 개별 기록 (localStorage lc.score.diff, 최근 200건)
```

기대값: `meanMs` 200~300ms, 첫 호출만 `/feats` 다운로드로 더 느림.

---

## 13. 저장소 규칙

- 커밋 메시지: `타입(범위): 내용 (vX.Y.Z)` — 예 `fix(feats): 오디오 참조 해석 폴백 (v8.14.22)`
- 버전은 `8.14.x` 3단계. 기능 추가 시 마지막 자리 증가
- `CHANGELOG.md` 에 한 줄 요약 추가
- 임시 진단 파일(`_*.json`)은 커밋하지 말 것 (`.gitignore` 처리됨)

---

## 14. 용어

| 용어 | 뜻 |
|---|---|
| 섀도잉 | 원어민 발화를 듣고 곧바로 따라 말하는 학습법 |
| 참조 특징 | 원어민 구간에서 미리 계산해 둔 로그멜 배열 |
| VTLN | 화자 성도 길이 차이를 α로 흡수하는 주파수 왜곡 보정 |
| DTW | 두 시계열의 시간 축을 늘려가며 정렬해 거리를 재는 알고리즘 |
| CMN | 채널 평균 정규화(프레임 간 평균 제거) |
