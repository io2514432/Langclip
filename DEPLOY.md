# Langclip 배포 가이드 (관리자 / 사용자 분리)

## 1. 세 가지 실행 방식

| 방식 | 명령 | 포트 | 누가 쓰나 | 친구가 보는 기록 |
|---|---|---|---|---|
| 관리자 | `start.bat` | 8000 | 나만 | — |
| 공개 | `public.bat` | 8001 | 링크를 받은 친구들 | 자기 것만 (빈 상태로 시작) |
| 둘 다 | 두 bat 을 각각 실행 | 8000 + 8001 | 나는 8000, 친구는 8001 | 격리됨 |

**핵심:** `public.bat` 은 `APP_MODE=public` 으로 서버를 띄운다. 이 모드에서는

- 영상 등록 / 삭제 / 대본 수정 / 싱크 / 음원 업로드 라우트가 **아예 등록되지 않는다** (요청하면 404).
- `추가` 탭, 삭제 버튼, 원본 음성 업로드 UI 가 화면에서 숨는다.
- 방문자마다 쿠키(`langclip_uid`)를 발급하고, 학습 기록을 `data/users/<uid>/` 에 따로 저장한다.
  → 친구가 들어오면 오답노트·완료 기록·연속 학습이 **전부 빈 상태**로 시작한다.
  → 내 `data/notes.json`, `data/verify.json` 은 건드리지 않는다.

공개 모드에서 친구에게 열려 있는 API 는 읽기 + 학습 기록 + 3단계 검증뿐이다:
`/api/health`, `/api/videos*`, `/api/media/*`, `/api/progress`, `/api/notes*`, `/api/words/*`,
문장 채점, 검증(spot/check).

## 2. 서버 실행

1. `secure.bat` 한 번 (관리자 토큰 생성 — 나만 쓰는 8000 서버용)
2. `start.bat` → 나는 `http://127.0.0.1:8000`
3. `public.bat` → 친구용 `http://127.0.0.1:8001` (토큰 없음)
4. 터널은 **8001** 로 연결한다 — `tunnel.bat` 이 공개 서버(8001) 기동과 터널 연결을 한 번에 한다
5. 친구에게 터널 주소만 보낸다. 끝.

두 서버는 같은 `data/` 를 공유하므로, 내가 8000 에서 등록한 영상은 친구 8001 에도 바로 보인다.
(친구가 그 영상에 남긴 채점·북마크는 내 기록과 섞이지 않는다.)

## 3. 관리자로 들어가기

브라우저에서 한 번만:

```
https://<내-주소>/admin?token=원하는-비밀문자열
```

→ 쿠키(30일)가 저장되고 앱으로 이동합니다. 그 브라우저에서만 `추가` 탭과 `원본 음성` 카드가 보입니다.
사용자에게는 이 링크를 주지 마세요. `추가` 탭 자체가 숨겨지고, API도 403으로 막힙니다.

## 4. 터널 (B안) — 가장 빠른 HTTPS 공개

### 4-1. Cloudflare Tunnel (도메인 없이 바로)
```powershell
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8000
```
출력에 `https://xxxx.trycloudflare.com` 주소가 나옵니다. 이 주소를 폰에서 열면 끝.
(임시 주소라 재시작하면 바뀝니다. 고정 주소는 Cloudflare 계정 + 도메인 연결이 필요합니다.)

### 4-2. Tailscale (초대한 사람만, 더 안전)
```powershell
winget install --id Tailscale.Tailscale
tailscale up
```
같은 테일넷에 초대된 기기에서 `http://<PC-테일넷-IP>:8000` 으로 접속.
HTTPS 인증서는 `tailscale cert` 로 발급받아 uvicorn에 넘길 수 있습니다.

> 폰에서 **마이크(쉐도잉)** 를 쓰려면 HTTPS가 필수입니다. Cloudflare Tunnel은 자동 HTTPS라 바로 됩니다.

## 5. 사용자에게 보여줄 것

- 접속 주소 하나
- "재생 → 오른쪽 마이크(쉐도잉) → 듣기 → 카운트다운 → 따라 말하기" 3줄 안내

## 6. 영상 등록 순서 (관리자)

1. `추가` 탭 → 쇼츠 주소 + 대본 붙여넣기 → `싱크 맞추기`
2. 영상이 재생되면 **문장이 끝나는 순간마다** 탭 (마지막 문장은 자동)
3. `저장` → 플레이어에서 `대본` → `원본 음성` → 음성 파일 넣기(권리 확인)
4. `최종 검증`을 한 번 돌려 통과되는지 확인 → 사용자 공개

## 7. 데이터 보관

- `data/` 폴더가 전부입니다. 백업은 이 폴더 복사로 끝납니다.
- `videos.json`(영상·대본), `attempts.json`(채점), `final.json`(최종 검증), `notes.json`(북마크·단어), `media/audios/`(음원)

## 8. 버전 백업 · 되돌리기

업데이트 전에 지금 상태를 저장해 두고, 문제가 생기면 그 상태로 되돌린다.

```
python version.py save                    지금 상태 저장 (현재 버전 번호 + 메모)
python version.py list                    저장된 버전 보기
python version.py diff v4.1               지금 코드와 v4.1의 차이
python version.py restore v4.1            v4.1로 되돌리기 (직전 상태 자동 백업)
```

- 저장 위치: `backups/<버전>/`
- 저장 대상: 코드 전체 + `data/*.json` + `data/users/*/*.json`
- 제외: `data/media`(음원·영상), `__pycache__`
- 되돌린 뒤에는 서버를 재시작한다.

**순서: 업데이트 압축을 풀기 전에 `save` → 풀기 → 테스트 → 문제 있으면 `restore`.**
