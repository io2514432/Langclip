# Langel 배포 가이드 (관리자 / 사용자 분리)

## 1. 두 가지 모드

| 모드 | 조건 | 쓰기 기능(추가·싱크·음원·삭제) |
|---|---|---|
| 로컬(혼자 쓰기) | `ADMIN_TOKEN` 없음 | 전부 허용 |
| 배포(사용자 공개) | `ADMIN_TOKEN` 설정 | **토큰 가진 관리자만** |

`ADMIN_TOKEN`만 정하면 읽기(재생·쉐도잉·채점·북마크)는 누구나, 등록/수정/삭제는 관리자만 가능해집니다.
사용자는 이미 싱크·음원이 준비된 영상만 보게 됩니다.

## 2. 서버 실행 (배포 모드)

`run.bat` 대신 아래처럼 토큰을 지정해 실행합니다. (Windows PowerShell)

```powershell
$env:ADMIN_TOKEN = "원하는-비밀문자열"
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

`--host 127.0.0.1` 로 두는 것이 안전합니다. 외부 노출은 터널이 담당합니다.

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
