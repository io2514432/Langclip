# HANDOFF — Echo (유튜브 문장별 셰도잉 + 서버 보관 원본 음원)

최종 갱신: 2026-10-30 · 버전 3.1 (offset 자동 캘리브레이션 / 타임스탬프 미세조정 / 원격 저장소 스트리밍 채점)

---

## 0. 이 문서를 읽는 다른 AI에게 (먼저 읽을 것)

이 프로젝트는 **음성 유사도 채점 기반 언어학습 웹앱**이다. 아래 3가지를 절대 깨지 말 것.

1. **TTS 금지.** 원어민의 실제 육성을 듣고 따라 말하는 것이 학습 목적이므로 합성 음성을 쓰지 않는다.
   `grep -rniE "tts|gtts|elevenlabs|polly" .` 결과가 비어 있어야 한다.
2. **제3자 YouTube 영상의 오디오 추출 금지.** yt-dlp/ffmpeg 등으로 남의 영상에서 오디오를 뽑는 기능·스크립트·안내를
   추가하지 않는다(YouTube 약관 + 저작권 위반). 영상은 **YouTube IFrame Player API로 재생만** 한다.
   `tools/yt_ref.py` 같은 다운로드 유틸은 이 저장소에 두지 않는다(과거 버전에서 삭제됨).
3. **오디오는 "소유/라이선스 확보" 전제로만 서버에 보관.** 업로드 API에 `source`(owned/licensed/public)와
   `license` 메모를 남기고, UI에 동의 체크박스를 둔다. 이 장치는 유지할 것.

디자인 토큰(화이트·스카이블루)도 유지: `--sky:#38BDF8`, `--sky-d:#0EA5E9`, `--bg:#F4FAFF`, `--line:#DCEDFB`.

---

## 1. 파일 트리

```
shadowing2/
├─ main.py              # FastAPI 앱. videos/audios CRUD, 링크, 구간 채점, Range 서빙,
│                       #   offset 자동 캘리브레이션, 원격 스트리밍 디코드
├─ engine.py            # 음향 유사도 채점 엔진 (pyin + CMVN-MFCC + 밴드 DTW, 4축)
├─ store.py             # 저장소 추상화: LocalStorage / S3Storage(R2) + HttpRangeFile(원격 스트리밍)
├─ seed.py              # 데모 시드: 영상 2개 + 원본 음원 wav 1개 생성
├─ test_parse.py        # 자막 파서 / yt_id / timing_score 단위 테스트
├─ test_features.py     # ★ v3.1: 캘리브레이션·원격 스트리밍 채점·Range 206·미세조정 검증
├─ requirements.txt
├─ README.md
├─ v31_styles.css       # ★ style.css 끝에 덧붙이는 v3.1 스타일 블록 (설치 시 1회 append)
├─ data/
│  ├─ videos.json       # {"videos":{...},"audios":{...}}  (구버전 평면 dict 자동 승격)
│  └─ media/audios/*.wav# 서버 보관 음원 (LocalStorage 루트)
├─ static/
│  ├─ index.html        # 3화면(home/play/result) + 시트 2개 + 타임스탬프 미세조정 UI
│  ├─ style.css         # 폰 프레임 390×844 고정, PC는 레터박스
│  ├─ app.js            # SegmentController(80ms 폴링), MediaRecorder, nudge/calibrate
│  └─ selftest.html     # 헤드리스 브라우저용 SegmentController 자체 테스트
└─ HANDOFF.md
```

## 2. 데이터 모델

```jsonc
{
  "audios": {
    "a1b2c3d4": {
      "id":"a1b2c3d4", "key":"audios/a1b2c3d4.m4a",
      "title":"카페 주문 대화", "dur":32.4,
      "offset": 0.0,              // ★ 영상 0초 == 음원 몇 초
      "source":"owned|licensed|public", "license":"CC BY 4.0",
      "mime":"audio/mp4"
    }
  },
  "videos": {
    "v9f8e7d6": {
      "id":"v9f8e7d6", "yt":"aqz-KE-bpKQ", "title":"...", "thumb":"...",
      "audio_id":"a1b2c3d4",      // null 이면 타이밍 채점
      "segs":[{"i":0,"start":4.0,"end":7.5,"text":"Hi, can I get a latte?"}]
    }
  }
}
```

**offset 정의(중요)**: `audio_time = video_time − offset`.
영상 전체를 그대로 받은 파일이면 0. 영상의 일부만 잘라낸 파일이면 그 파일이 시작하는 영상 시각.
애매하면 자동 캘리브레이션(`POST /api/videos/{vid}/calibrate`)으로 추정한다.

## 3. API

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/health` | `{ok, sr, storage, range:true, remote_open:true, version}` |
| GET | `/api/videos` | 영상 목록 + `audio{url,offset,dur}` + `has_audio` |
| POST | `/api/videos` | `{url,title,transcript,duration,audio_id?}` → 자막 파싱 후 저장 |
| DELETE | `/api/videos/{vid}` | 삭제 |
| PATCH | `/api/videos/{vid}/segments/{i}` | 문장 start/end/text 수정 → `{ok, seg, prev, dur}` (역전 시 422) |
| GET | `/api/audios` | 보관 음원 목록 + `used_by` |
| POST | `/api/audios` | multipart: `file,title,offset,source,license` → 60MB 제한 |
| PATCH | `/api/audios/{aid}` | offset/제목/라이선스 수정 |
| DELETE | `/api/audios/{aid}` | 파일+레코드 삭제, 연결된 영상은 자동 해제 |
| POST | `/api/videos/{vid}/link-audio` | `{audio_id, offset?}` 영상↔음원 연결 |
| **POST** | **`/api/videos/{vid}/calibrate`** | **★ offset 자동 추정(상호상관). `{audio_id?,search_s?,step_ms?,smooth_s?,min_overlap_s?,apply?,link?}`** |
| GET | `/api/media/{key}` | HTTP Range(206) 지원 스트리밍. 원격 저장소면 307 |
| POST | `/api/videos/{vid}/segments/{i}/score` | multipart `take` → 4축 또는 타이밍 채점 |

점수 응답: `{total,pitch,rhythm,timbre,attack,has_pitch,mode:"acoustic"|"timing",lag_applied_s,raw,ref_dur,ref_src?,note?}`

### 3.1 `/calibrate` 응답

```jsonc
{
  "offset": 3.399, "offset_prev": 0.0, "applied": true,
  "confidence": 1.0, "peak": 0.87, "second": 0.59, "contrast": 0.28,
  "method": "envelope_xcorr", "step_ms": 20.0,
  "search": [-18.6, 18.0], "audio_dur": 20.6, "video_dur": 20.0,
  "n_lags": 1732, "curve": [[lag_s, r], ...], "note": null
}
```

## 4. 현재 구현된 기능 (v3.0 + v3.1)

- 유튜브 영상은 IFrame API로만 재생. `seekTo(start) → playVideo() → 80ms 폴링 → end에서 pauseVideo()`.
  반복 1/3/5회, 0.75배속, 문장 클릭 시 즉시 구간 재생.
- 자막 파서: SRT · `0:03-0:06 문장` · `[0:04] 문장` · `0:04 문장` · 시간 없는 줄(균등 배분) 5형식.
  URL 파서: shorts/ · youtu.be/ · watch?v= · 11자리 ID.
- **서버 보관 음원 라이브러리**: 업로드 → `data/media/audios/` 저장 → 영상에 연결 → 문장 구간만 잘라 채점.
  앱 재접속 후에도 다시 올릴 필요 없음. 동일 음원을 여러 영상이 공유 가능(`/api/audios`의 `used_by`).
- 원본 듣기 버튼(🎧): `<audio>`로 `currentTime = seg.start − offset` 설정 후 `end`에서 정지.
- 채점 분기: 연결된 음원 있으면 4축 음향 채점, 없으면 길이 비율 타이밍 채점(안내 문구 표시).

### v3.1 신규

1. **offset 자동 캘리브레이션 — `POST /api/videos/{vid}/calibrate`**
   - 자막 타임스탬프를 "발화 중=1"인 영상 타임라인 신호로 만들고, 저장소 음원의 log-RMS 엔벨로프와
     **정규화 상호상관**으로 `offset`을 찾는다. (영상 오디오는 절대 건드리지 않는다 — 규칙 2 준수)
   - 2단계: ① 0.12초 평활화 신호로 굵은 탐색(누적합으로 O(1) 평균/분산, 20ms 프레임)
     ② 발화 시작(어택) 성분만 남긴 신호로 ±0.3초 미세 재탐색 → 자막 끝이 실제 발화보다 길 때 생기는
     뒤쪽 편향 제거. 최고점은 3점 포물선 보간으로 프레임 이하 정밀도.
   - 겹침이 짧은 lag은 상관이 우연히 높아지므로 `max(2초, 0.35 × 짧은 쪽 길이)` 미만 겹침은 후보에서 제외.
   - 신뢰도 = `clip((peak−0.10)/0.35) × clip(contrast/0.08)` (contrast = peak − 0.5초 밖 최고 상관).
     `confidence < 0.35`면 `note`로 수동 확인을 권고. `apply:true`면 DB에 저장(선택적으로 `link`).
   - 실측: 잘라낸 음원(정답 3.4초)에서 **3.399초**, 오차 1ms. 데모(정답 0)에서 −0.001초.
2. **문장 타임스탬프 ±0.1초 미세조정 UI** — 플레이어의 "따라 말할 문장" 카드에 시작/끝 각각 `◀ 0.1` / `0.1 ▶`.
   - 값은 즉시 화면에 반영(낙관적 업데이트), 0.26초 디바운스로 PATCH 1회 저장. 실패 시 마지막 저장 지점으로 롤백 + 토스트.
   - 구간이 0.2초 미만이 되면 거부. 재생 중 조정하면 재생을 멈춘다(경계 불일치 방지).
   - 저장된 값은 문장 목록·결과 화면·채점 구간에 모두 반영된다.
3. **원격 저장소 스트리밍 채점 — `storage.open()`**
   - `store.py`에 `open(key) → seek 가능한 파일 객체` 계약 추가.
     `LocalStorage.open`은 로컬 파일, `S3Storage.open`은 **presigned/CDN URL 위의 `HttpRangeFile`**
     (HTTP Range 요청을 512KB 청크로 캐시, seek/tell/readinto 지원).
   - `main.load_ref_slice(key, t0, t1)`가 `soundfile`로 필요한 구간만 디코드한다.
     libsndfile이 못 읽는 형식(m4a/aac)은 `storage.uri(key)`를 ffmpeg에 넘겨 ffmpeg가 Range로 직접 읽는다.
   - 결과: 예전에는 `storage.path() is None`이면 타이밍 채점으로 폴백했지만, 이제 S3/R2에서도 4축 채점.
   - 캘리브레이션 엔벨로프도 `open()` 스트리밍으로 계산 → 전체 파일을 메모리에 올리지 않는다.
   - 응답의 `ref_src: {storage, read:"open+range"}`로 어느 경로로 읽었는지 확인 가능.

## 5. 이 세션에서 실제로 확인한 것 (v3.1)

Linux(Python 3.12, ffmpeg, librosa) 환경에서 실행·검증:

- `python seed.py` → 영상 2개 / 오디오 1개(`ademo0001.wav`, 24.0s) 생성.
- `python test_parse.py` → 5형식 파싱 + `yt_id` + `timing_score`(1.0→100.0, 1.5→31.4, 0.6→23.2) **통과**.
- `python test_features.py` → **9개 항목 통과**
  - `/api/health` `storage=local, remote_open=true`
  - `Range: bytes=0-1023` → **206**, `Content-Range: bytes 0-1023/659244`
  - calibrate: 제안 offset **3.399s**(정답 3.4, 오차 0.001), `apply` 후 DB 저장 확인
  - score acoustic `total=95.5` (pitch 99.3 / rhythm 100.0 / timbre 81.0 / attack 100.0)
  - score timing `total=83.1` (ratio 0.937)
  - PATCH 문장 `4.0→4.1`, `7.5→7.3`(dur 3.2s), 종료<시작 요청은 **422**
  - **원격(S3 흉내 HTTP 서버)**: acoustic `total=87.9`, `ref_src.storage=s3-test, read=open+range`,
    엔벨로프 1030프레임 계산에 Range 요청 **12회**(전체 다운로드 없음), 원격 calibrate도 3.399s
- `uvicorn main:app` 기동 후 curl 확인:
  - `/api/health` → `{"ok":true,"sr":16000,"storage":"local","range":true,"remote_open":true,"version":"3.1"}`
  - `Range: bytes=100-1099` → `HTTP/1.1 206`, `content-range: bytes 100-1099/768044`, `content-length: 1000`
  - `vdemo0001` 구간 0 채점 → `mode=acoustic, total=100.0, ref_dur=3.5`
  - `vdemo0002` 구간 0 채점 → `mode=timing, total=83.2`
  - calibrate(데모) → `offset=-0.001, confidence=1.0, peak=0.924`
  - PATCH → `{"ok":true,"seg":{"start":4.1,"end":7.3...}}` 형식 정상
- `node --check static/app.js` → 문법 오류 없음.

## 6. 다음 작업 (우선순위)

1. **점수 기록 저장**: 세션별 점수 DB(SQLite) + 하단 "기록" 탭 활성화, 문장별 최고점 추이 그래프.
2. **업로드 소유자 확인**: 업로드 시 서명 URL + 만료, 사용자 인증(간단한 세션 or OAuth).
3. **캘리브레이션 고도화**: 음원이 영상보다 훨씬 길 때(겹침 비율이 낮을 때)를 위한 다중 후보 제시,
   `curve`를 미니 그래프로 그려 신뢰도를 눈으로 확인.
4. **배포**: Cloudflare R2 + CDN, `ffmpeg` 포함 Docker 이미지, HTTPS(마이크 필수).
5. **모바일 UX**: 타임스탬프 미세조정을 길게 눌러 연속 조정, 진동 피드백.

## 7. 실행

```bash
pip install -r requirements.txt
sudo apt install ffmpeg          # ★ 필수 (webm→16k mono wav 변환, ffprobe로 길이 추출)
python seed.py
python -m uvicorn main:app --reload   # http://localhost:8000
```

검증:

```bash
python test_parse.py        # 파서/타이밍
python test_features.py     # 캘리브레이션·원격 스트리밍·Range·미세조정 (httpx 필요)
```

마이크는 HTTPS 또는 localhost 필수. 폰에서 테스트: `npx localtunnel --port 8000`.

## 8. 붙여넣기용 프롬프트 (다른 AI에게)

```
너는 이 저장소(shadowing2)를 이어서 개발한다. 먼저 HANDOFF.md, main.py, store.py, static/app.js를 읽어라.

절대 규칙:
1) TTS를 쓰지 않는다. 원어민 실제 육성만 사용한다.
2) 제3자 YouTube 영상에서 오디오를 추출하는 기능/스크립트/안내를 절대 추가하지 않는다.
   영상은 YouTube IFrame Player API로 재생만 한다.
3) 서버에 보관하는 오디오는 본인 소유 또는 라이선스 보유 음원만. source/license 필드와
   동의 체크박스를 유지한다.

아키텍처: FastAPI(main.py) + engine.py(4축 채점) + store.py(Local/S3 추상화) + data/videos.json.
offset 규칙: audio_time = video_time - offset.

이번 작업: (여기에 원하는 작업을 적는다)

완료 조건: `python seed.py` 후 `uvicorn main:app` 기동, `test_parse.py`·`test_features.py` 통과,
Range 요청이 206을 반환, 채점 API가 acoustic/timing 두 모드 모두 정상 응답.
```

---

## 9. v3.3 — 재생하며 싱크 맞추기 (탭 타이밍)

### 왜 자동 정렬이 아니라 "사람이 찍는" 방식인가
제3자 유튜브 영상의 오디오를 받아 강제정렬(forced alignment)하려면 오디오 추출이 필요하다 → 규칙 2 위반.
그래서 **영상을 그대로 재생하면서 경계를 찍는** 방식으로 0.1초 단위를 맞춘다.
자동 정렬 대비 정확도는 사람 손 반응속도에 좌우되지만(±0.1~0.2초), 찍은 뒤 ±0.1초 미세조정으로 다듬을 수 있어
결과물은 충분히 정밀하다.

### 사용자 흐름 (요청 6단계 그대로)
1. `추가` 또는 `학습` 화면의 **＋ 싱크 맞추기** → 시트가 열린다.
2. 쇼츠 주소 + 대본 전체를 붙여넣는다. (한 줄 = 한 문장, `EN:`/`KO:` 라벨 선택)
3. **싱크 시작** → `/api/sync/split` 이 문장을 분리하고 풀블리드 플레이어가 뜬다.
4. 재생하며 문장이 끝나는 지점마다 **Space / 경계 찍기** 버튼.
   기본값은 "찍으면 일시정지"(정밀도 우선), 토글하면 재생 유지하며 연속으로 찍을 수 있다.
   `↶ 되돌리기`(Backspace)로 마지막 경계를 취소. 배속 1.0x/0.75x/0.5x 지원.
5. 마지막 경계까지 찍으면 **타이밍 확인 시트**가 열리고 마크다운이 자동 생성된다.
   각 문장의 시작/끝을 ±0.1초로 다듬으면 마크다운도 즉시 갱신된다.
6. **저장** → `POST /api/sync/apply` 가 새 영상을 만들거나 기존 영상의 대본을 교체한다.

### 경계 모델 (N+1 탭)
경계 시각 배열 b0..bN 에서 문장 i = [b_i, b_(i+1)].
즉 "문장이 시작되는 순간 1번 + 문장이 끝나는 순간마다" 누르면 N문장에 N+1탭.
앞뒤 문장이 붙어 있는 쇼츠에서 가장 빠르고, 무음 구간이 있으면 확인 시트에서 시작/끝을 각각 밀면 된다.

### 대본 분리 규칙 (`synclib.split_transcript`)
- `EN:`/`KO:` 라벨 인식
- 라벨이 없으면: 한글이 없는 줄 = 영어, 한글 줄 = 직전 영어의 번역으로 결합
- `Hi there / 안녕하세요` 한 줄 표기 지원
- 불릿(`-`, `1.`, `•`)과 앞머리 타임코드(`0:12-0:15`)는 자동 제거
- `split_sentences` 옵션: 40자 넘는 영어 줄을 마침표 기준으로 추가 분할

### 신규 API
| Method | Path | 설명 |
|---|---|---|
| POST | `/api/sync/split` | `{text, split_sentences}` → `{items:[{en,ko}], count}` |
| POST | `/api/sync/apply` | `{url, title, vid?, sentences:[{start,end,en,ko}], markdown?}` → 영상 생성/교체 + 마크다운 |

### 검증 (`python test_sync.py` → 26개 통과)
한영 교차 페어링·라벨·한 줄 표기·문장 분할·불릿/타임코드 제거, 경계→구간 결합,
마크다운 왕복(시간·한국어 보존), 오류 검출(역전/겹침/빈문장),
API split/apply(신규 생성·기존 교체·markdown 직접 반영) 전부 확인.
실서버에서도 `/api/sync/split` → `/api/sync/apply` → `/api/videos` 반영 확인.
