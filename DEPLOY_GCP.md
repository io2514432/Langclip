# Langclip — Google Cloud 상시 구동 가이드 (처음부터)

> 고등학생도 따라할 수 있게 쓴 단계별 설명서입니다.
> 위에서부터 순서대로 하면 됩니다. 명령어는 **한 줄씩 복사해서 붙여넣기** 하세요.

---

## 0. 준비물

| 필요한 것 | 설명 |
|---|---|
| 구글 계정 | Gmail 있으면 됨 |
| 신용/체크카드 | 본인 확인용. 무료 한도 안에서는 **청구되지 않음** |
| 내 PC | Windows 기준으로 설명 |
| Langclip 코드 | 지금 개발 중인 폴더 |

**결과물:** `https://<IP>.sslip.io` — 24시간 켜져 있고, 주소가 바뀌지 않는 HTTPS 주소.
(HTTPS가 꼭 필요한 이유: 브라우저는 HTTPS가 아니면 **마이크를 막습니다**. 마이크가 없으면 섀도잉 채점이 안 됩니다.)

---

## 1. 구글 클라우드 시작하기

1. 브라우저에서 **https://console.cloud.google.com** 접속
2. 구글 계정으로 로그인
3. 약관 동의 화면이 나오면 국가 → **대한민국**, 약관 체크 → **동의 및 계속**

### 1-1. 프로젝트 만들기

1. 화면 위쪽 **프로젝트 선택** 드롭다운 클릭
2. 오른쪽 위 **새 프로젝트** 클릭
3. 프로젝트 이름: `langclip` → **만들기**
4. 1분쯤 기다린 뒤, 위쪽 드롭다운에서 `langclip` 프로젝트를 **선택**

### 1-2. 결제 계정 연결

1. 왼쪽 위 메뉴(☰) → **결제**
2. **계정 만들기** → 이름 `langclip-billing` → 계속
3. 카드 정보 입력 → **무료 체험 시작**

> **겁먹지 않아도 됩니다.** 신규 계정은 90일 동안 $300 크레딧이 붙고, 그 안에서는 청구되지 않습니다.
> 90일이 지나도 **Always Free 한도 안이면 계속 $0**입니다. 16장에서 경고 알림을 걸어둡니다.

---

## 2. Compute Engine 켜기

1. 왼쪽 위 메뉴(☰) → **Compute Engine** → **VM 인스턴스**
2. **사용 설정** 버튼 클릭 → 1~2분 대기

---

## 3. 가상 컴퓨터(VM) 만들기 ⭐ 가장 중요

**Compute Engine → VM 인스턴스 → 인스턴스 만들기** 를 누르고 아래 표대로 입력하세요.

| 항목 | 값 | 왜? |
|---|---|---|
| 이름 | `langclip` | 아무거나 |
| 리전 | **us-central1 (Iowa)** | 무료 대상 3곳 중 하나 (us-west1, us-central1, us-east1) |
| 영역 | **us-central1-a** | 아무거나 |
| 시리즈 | **E2** | 무료 대상 |
| 머신 유형 | **e2-micro** | 월 1대 무료 |
| 부팅 디스크 - 운영체제 | **Ubuntu 24.04 LTS** | 무료, 안정적 |
| 부팅 디스크 - 크기 | **30 GB** | 무료 한도(30GB 표준 디스크) |
| 부팅 디스크 - 유형 | **표준 영구 디스크** | `balanced`로 두면 **과금됩니다** |
| 방화벽 - HTTP 트래픽 허용 | ✅ 체크 | 80번 포트 |
| 방화벽 - HTTPS 트래픽 허용 | ✅ 체크 | 443번 포트 |

### 3-1. 네트워크 등급을 "표준"으로 바꾸기 ⭐

같은 화면에서 **아래로 스크롤 → 고급 옵션 펼치기 → 네트워킹** 으로 이동합니다.

| 항목 | 값 |
|---|---|
| 네트워크 서비스 등급 | **표준 (Standard)** |
| 외부 IPv4 주소 | **고정 주소 예약** 선택 (아래 4장과 동일) |

> **왜 표준인가?** 기본값인 프리미엄은 월 무료 전송량이 **1GB**뿐입니다.
> 표준은 **200GB**입니다. 200배 차이입니다.
> 영상은 YouTube에서 직접 받으므로 서버 전송량이 거의 늘지 않고, 음성 파일만 이 한도를 씁니다.

다 입력했으면 **만들기** 클릭 → 1분 정도 기다리면 초록색 체크가 뜹니다.

---

## 4. 고정 IP 주소 받기

기본 상태로 두면 재부팅 때 주소가 바뀝니다. 고정으로 바꿉니다.

1. 왼쪽 메뉴 → **VPC 네트워크** → **IP 주소**
2. 위쪽 **고정 주소 예약** 클릭

| 항목 | 값 |
|---|---|
| 이름 | `langclip-ip` |
| 네트워크 서비스 등급 | **표준** |
| IP 버전 | IPv4 |
| 유형 | **지역** |
| 리전 | **us-central1** |
| 연결 대상 | **없음** (지금은) |

3. **예약** 클릭
4. 목록에 나온 **주소**를 메모장에 적어두세요. 예: `34.123.45.67`

### 4-1. VM에 그 IP 붙이기

1. **Compute Engine → VM 인스턴스** → `langclip` 클릭
2. **수정** 클릭
3. **네트워크 인터페이스** 펼치기 → 외부 IP 항목에서 `langclip-ip` 선택
4. **저장**

> 고정 IP는 **VM에 붙어 있는 동안 무료**입니다. (떼어놓기만 하면 과금)

---

## 5. 방화벽 열기

3장에서 체크했다면 이미 열려 있습니다. 확인만 하세요.

**VPC 네트워크 → 방화벽** 에서 `default-allow-http`, `default-allow-https` 두 개가 있으면 통과. 없으면 **방화벽 규칙 만들기**로 추가:
- 이름: `allow-web`
- 대상 태그: `http-server`, `https-server`
- 소스 IPv4 범위: `0.0.0.0/0`
- 프로토콜/포트: `tcp:80`, `tcp:443`

---

## 6. 서버에 접속하기

1. **Compute Engine → VM 인스턴스** 목록으로 이동
2. `langclip` 행의 **SSH** 버튼 클릭
3. 검은 창이 뜨고 `ubuntu@langclip:~$` 가 보이면 성공

> 이 창을 **서버 창**이라고 부르겠습니다. 여기에 명령어를 붙여넣고 Enter를 칩니다.
> 붙여넣기는 **Ctrl+V** 또는 창에서 마우스 오른쪽 클릭.

---

## 7. 서버 준비 (한 번만)

### 7-1. 기본 업데이트

```bash
sudo apt update && sudo apt upgrade -y
```

### 7-2. 메모리 늘리기 (스왑) ⭐ 먼저 하세요

e2-micro는 램이 1GB뿐이라, 이 작업 없이 라이브러리를 설치하면 도중에 뻗습니다.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

마지막 줄에 `Swap: 2.0Gi` 가 보이면 성공.

### 7-3. 필요한 프로그램 설치

```bash
sudo apt install -y python3-venv python3-pip ffmpeg libsndfile1 git curl
```

| 패키지 | 역할 |
|---|---|
| `python3-venv` | 파이썬 전용 공간 |
| `ffmpeg` | 음성 변환·길이 측정 (채점에 필수) |
| `libsndfile1` | 오디오 파일 읽기 (librosa가 필요로 함) |
| `git` | 코드 내려받기 |

### 7-4. Caddy 설치 (HTTPS 자동)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

---

## 8. Langclip 코드 올리기

`data/` 폴더는 git에 안 올라가므로, 코드와 데이터를 따로 올립니다.

### 8-1. 코드

**방법 A — GitHub에 올려둔 경우 (권장)**

```bash
cd ~
git clone https://github.com/<내계정>/<저장소이름>.git langclip
```

**방법 B — 내 PC에서 직접 올리기**

내 PC에서 PowerShell을 열고:

```powershell
cd C:\dev
scp langclip.zip ubuntu@34.123.45.67:~/
```

> 처음 접속이면 `yes` 를 입력하고, 비밀번호 대신 **아무것도 입력하지 말고 Enter**.
> (VM은 기본적으로 SSH 키로 인증하므로 비밀번호가 없습니다. 위 명령이 안 되면 방법 A를 쓰세요.)

그다음 서버 창에서:

```bash
cd ~ && unzip langclip.zip && mv langclip-main langclip
```

### 8-2. 데이터 폴더 (영상·대본·북마크·학습기록)

**내 PC의 PowerShell에서:**

```powershell
cd C:\dev\langclip
scp -r data ubuntu@34.123.45.67:~/langclip/
```

> `data/` 폴더만 옮기면 영상 목록, 대본, 북마크, 학습 기록이 전부 따라갑니다.

---

## 9. 파이썬 환경 만들기

서버 창에서:

```bash
cd ~/langclip
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

> 10~20분 걸립니다. `librosa`, `numpy` 를 컴파일하느라 느립니다. 멈춘 것처럼 보여도 기다리세요.
> 중간에 `Killed` 가 뜨면 7-2 스왑이 제대로 안 된 것입니다.

---

## 10. 일단 손으로 실행해보기

```bash
cd ~/langclip
APP_MODE=public .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

같은 SSH 창에서 **새 탭**을 열 수 없으니, 일단 서버 창은 그대로 두고 확인만:

```bash
curl -s http://127.0.0.1:8001/api/health
```

`{"ok":true,...}` 가 나오면 성공. **Ctrl+C** 로 멈춥니다.

---

## 11. 자동 실행 등록 (재부팅해도 알아서 켜짐)

### 11-1. 공개 서버 (친구들이 쓰는 것)

```bash
sudo tee /etc/systemd/system/langclip.service > /dev/null <<'EOF'
[Unit]
Description=Langclip public
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/langclip
Environment=APP_MODE=public
ExecStart=/home/ubuntu/langclip/.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8001 --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now langclip
sudo systemctl status langclip
```

`active (running)` 이 보이면 성공. **`q`** 를 눌러 빠져나옵니다.

> **`--workers 1` 을 절대 바꾸지 마세요.** 이 앱은 JSON 파일에 직접 쓰기 때문에,
> 워커가 2개 이상이면 서로 덮어써서 기록이 사라집니다.

### 11-2. 관리자 서버 (영상 등록용, 나만)

```bash
sudo tee /etc/systemd/system/langclip-admin.service > /dev/null <<'EOF'
[Unit]
Description=Langclip admin
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/langclip
Environment=APP_MODE=admin
Environment=ADMIN_TOKEN=여기에-내-비밀번호
ExecStart=/home/ubuntu/langclip/.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

`여기에-내-비밀번호` 를 원하는 문자열로 바꾼 뒤 실행:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now langclip-admin
```

---

## 12. HTTPS 주소 만들기 (Caddy)

고정 IP가 `34.123.45.67` 이라면 주소는 **`34.123.45.67.sslip.io`** 입니다.
(점을 그대로 써도 되고, `34-123-45-67.sslip.io` 처럼 써도 됩니다. 도메인 구매 불필요)

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
34.123.45.67.sslip.io {
    reverse_proxy 127.0.0.1:8001
    encode gzip
    request_body {
        max_size 60MB
    }
}
EOF
```

> `34.123.45.67` 부분을 **본인 IP로 바꾸세요.** (두 군데)

```bash
sudo systemctl reload caddy
sudo journalctl -u caddy -n 20 --no-pager
```

1~2분 뒤 브라우저에서 `https://34.123.45.67.sslip.io` 접속 → 자물쇠(🔒)가 보이면 완성입니다.

---

## 13. 관리자로 영상 등록하기

관리자 서버는 **인터넷에 열지 않았습니다**(`127.0.0.1`). 내 PC에서 안전하게 터널을 뚫어 접속합니다.

**내 PC의 PowerShell에서:**

```powershell
ssh -L 8000:127.0.0.1:8000 ubuntu@34.123.45.67
```

> 이 창은 **닫지 말고** 그대로 두세요. 이 창이 열려 있는 동안만 터널이 유지됩니다.

그다음 내 PC 브라우저에서:

```
http://127.0.0.1:8000/admin?token=여기에-내-비밀번호
```

→ `추가` 탭이 보이면 성공. 영상 등록·대본 수정·원본 음성 업로드를 여기서 합니다.
한 번 접속하면 30일간 기억됩니다.

---

## 14. 비용 폭탄 방지 알림

1. 콘솔 → **결제** → **예산 및 알림**
2. **예산 만들기**
3. 이름 `langclip-guard`, 범위는 프로젝트 `langclip`, 금액 **$1**
4. 알림 기준: **50%**, **100%** 체크 → 저장

$1라도 청구되면 메일이 옵니다. 무료 한도 안이면 계속 $0입니다.

---

## 15. 최종 확인 체크리스트

| 확인 | 방법 |
|---|---|
| 서버 자동 실행 | `sudo systemctl status langclip` → active |
| HTTPS | `https://<IP>.sslip.io` 에 🔒 표시 |
| 영상 목록 | 폰에서 접속해 영상이 보이는지 |
| **마이크(섹션 채점)** | 폰에서 재생 → 마이크 → 권한 허용 → 채점 결과 |
| 재부팅 후 자동 복구 | `sudo reboot` 후 2분 뒤 다시 접속 |
| 비용 | 결제 → 보고서에서 $0 확인 |

---

## 16. 자주 막히는 곳

| 증상 | 원인 / 해결 |
|---|---|
| `pip install` 중 `Killed` | 메모리 부족 → 7-2 스왑 다시 확인 |
| 사이트가 안 열림 | `sudo systemctl status langclip caddy` 로 두 서비스 확인 |
| 🔒 대신 경고 | Caddyfile의 IP 오타. `sudo journalctl -u caddy -n 50` |
| 마이크 버튼이 안 됨 | HTTPS 아님. `http://` 로 접속하고 있지 않은지 확인 |
| 채점이 500 | `ffmpeg` 누락. `ffmpeg -version` 으로 확인 |
| 기록이 사라짐 | `--workers` 가 1인지 확인 |
| 디스크 100% | `df -h` → 오래된 음성 파일 정리 |

---

## 17. 백업

학습 기록은 전부 `data/` 폴더 안에 있습니다.

```bash
cd ~/langclip && tar czf ~/backup-$(date +%m%d).tgz data
```

내 PC로 가져오기 (PowerShell):

```powershell
scp ubuntu@34.123.45.67:~/backup-*.tgz .
```
