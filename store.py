"""Echo — 오디오 저장소 추상화 (+ 원격 스트리밍 읽기)

로컬 디스크(S3/R2 호환 인터페이스). 운영에서는 S3Storage 로 교체.

공통 계약 (LocalStorage / S3Storage 둘 다 구현)
  put(key, data)      -> 공개 URL
  path(key)           -> Path | None      로컬만. 원격이면 None
  uri(key)            -> str              ffmpeg·브라우저가 바로 열 수 있는 문자열
  open(key)           -> 파일 객체(rb)    ★ 원격도 seek/read 가능 → 구간 채점
  read_at(key, a, b)  -> bytes            바이트 구간만 뽑기
  exists / delete / size / url

★ 구간 채점 경로
  예전에는 storage.path() 가 None 이면(=S3) 타이밍 채점으로 폴백했다.
  지금은 open() 이 로컬·원격 모두 seek 가능한 파일 객체를 돌려주므로
  soundfile(libsndfile) 이 필요한 구간만 읽어 디코드한다.
  원격은 HTTP Range 요청만 나가고, m4a/aac 처럼 libsndfile 이 못 읽는 형식은
  main.py 가 uri() 를 ffmpeg 에 넘겨 ffmpeg 자신이 Range 로 읽게 한다.
"""
from __future__ import annotations

import io
import os
import re
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = Path(os.getenv("LANGCLIP_DATA") or (BASE / "data"))
MEDIA = DATA / "media"

CHUNK = 512 * 1024          # 원격 Range 캐시 단위(바이트)


# --------------------------------------------------------------- 원격 파일
class HttpRangeFile(io.RawIOBase):
    """HTTP Range 로 원격 객체를 '파일처럼' 읽는다.

    libsndfile 은 seek/read/tell 만 있으면 스트리밍 디코드가 가능하므로,
    S3/R2 presigned URL·CDN URL 을 그대로 넘겨도 구간 채점이 된다.
    서버가 Range 를 무시하고 200(전체)을 주면 전체를 한 번 받아 캐시한다.
    """

    def __init__(self, url: str, chunk: int = CHUNK, timeout: float = 20.0,
                 headers: dict | None = None):
        super().__init__()
        self.url = url
        self.chunk = max(4096, int(chunk))
        self.timeout = timeout
        self.headers = dict(headers or {})
        self._size = 0
        self._pos = 0
        self._buf = b""
        self._buf_at = 0
        self._probe()

    # -- 내부
    def _get(self, start: int, end: int | None = None):
        h = dict(self.headers)
        h["Range"] = f"bytes={start}-" if end is None else f"bytes={start}-{end}"
        req = urllib.request.Request(self.url, headers=h)
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return r.read(), (r.headers.get("Content-Range") or ""), r.status

    def _probe(self):
        body, crng, status = self._get(0, 0)
        m = re.search(r"/(\d+)\s*$", crng or "")
        if m and status == 206:
            self._size = int(m.group(1))
            return
        # Range 미지원(200) → 전체를 이미 받았다
        if status == 200:
            full, crng2, _ = self._get(0, None)
            body = full or body
            self._size = len(body)
            self._buf, self._buf_at = body, 0
            return
        self._size = len(body)

    def _fill(self, n: int) -> None:
        start = self._pos
        if start >= self._size:
            self._buf, self._buf_at = b"", start
            return
        end = min(self._size - 1, start + max(n, self.chunk) - 1)
        body, crng, _ = self._get(start, end)
        m = re.match(r"bytes\s+(\d+)-", crng or "")
        self._buf_at = int(m.group(1)) if m else 0
        self._buf = body

    # -- 파일 API
    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        if whence == io.SEEK_SET:
            p = offset
        elif whence == io.SEEK_CUR:
            p = self._pos + offset
        elif whence == io.SEEK_END:
            p = self._size + offset
        else:
            raise ValueError("invalid whence")
        self._pos = max(0, int(p))
        return self._pos

    def read(self, n: int = -1) -> bytes:      # type: ignore[override]
        if n is None or n < 0:
            n = self._size - self._pos
        n = int(min(n, self._size - self._pos))
        if n <= 0:
            return b""
        off = self._pos - self._buf_at
        if 0 <= off and off + n <= len(self._buf):
            out = self._buf[off:off + n]
        else:
            self._fill(n)
            off = max(0, self._pos - self._buf_at)
            out = self._buf[off:off + n]
        self._pos += len(out)
        return out

    def readinto(self, b) -> int:              # type: ignore[override]
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)

    @property
    def size(self) -> int:
        return self._size


# --------------------------------------------------------------- 로컬
class LocalStorage:
    """data/media 아래에 파일을 둔다. URL 은 /api/media/<key>."""

    name = "local"
    can_stream = True

    def __init__(self, root: Path = MEDIA):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        key = key.lstrip("/")
        # 경로 탈출 방지
        p = (self.root / key).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise ValueError("invalid key")
        return p

    def put(self, key: str, data: bytes) -> str:
        p = self._resolve(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return self.url(key)

    def path(self, key: str) -> Path:
        p = self._resolve(key)
        if not p.exists():
            raise FileNotFoundError(key)
        return p

    def open(self, key: str):
        """seek 가능한 로컬 파일 객체."""
        return open(self.path(key), "rb")

    def uri(self, key: str) -> str:
        return str(self.path(key))

    def read_at(self, key: str, start: int, end: int) -> bytes:
        p = self.path(key)
        start = max(0, int(start))
        end = min(int(end), p.stat().st_size - 1)
        if end < start:
            return b""
        with open(p, "rb") as f:
            f.seek(start)
            return f.read(end - start + 1)

    def exists(self, key: str) -> bool:
        try:
            return self._resolve(key).exists()
        except ValueError:
            return False

    def delete(self, key: str) -> None:
        try:
            self._resolve(key).unlink(missing_ok=True)
        except ValueError:
            pass

    def url(self, key: str) -> str:
        return "/api/media/" + key.lstrip("/")

    def size(self, key: str) -> int:
        return self.path(key).stat().st_size


# --------------------------------------------------------------- S3 / R2
class S3Storage:
    """S3 / Cloudflare R2 구현 (boto3 필요).

    버킷은 비공개로 두고 서명 URL 또는 CDN을 앞에 둔다.
        put()   -> 객체 업로드
        url()   -> CDN 도메인 + key (공개 CDN) 또는 presigned URL
        open()  -> presigned URL 위에 HTTP Range 리더 → 구간만 내려받는다
    """

    name = "s3"
    can_stream = True

    def __init__(self, bucket: str, cdn: str | None = None, prefix: str = "echo/"):
        import boto3  # 지연 임포트

        self.s3 = boto3.client("s3")
        self.bucket = bucket
        self.cdn = (cdn or "").rstrip("/")
        self.prefix = prefix

    def _k(self, key: str) -> str:
        return self.prefix + key.lstrip("/")

    def put(self, key: str, data: bytes) -> str:
        import mimetypes

        ct = mimetypes.guess_type(key)[0] or "application/octet-stream"
        self.s3.put_object(Bucket=self.bucket, Key=self._k(key), Body=data,
                           ContentType=ct, CacheControl="public, max-age=31536000")
        return self.url(key)

    def exists(self, key: str) -> bool:
        try:
            self.s3.head_object(Bucket=self.bucket, Key=self._k(key))
            return True
        except Exception:
            return False

    def delete(self, key: str) -> None:
        self.s3.delete_object(Bucket=self.bucket, Key=self._k(key))

    def url(self, key: str) -> str:
        if self.cdn:
            return f"{self.cdn}/{self._k(key)}"
        return self.s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": self._k(key)}, ExpiresIn=3600
        )

    def path(self, key: str):
        # 원격 저장소는 로컬 경로가 없다. (구간 채점은 open()/uri() 로 처리)
        return None

    def uri(self, key: str) -> str:
        """ffmpeg·브라우저가 열 수 있는 URL."""
        return self.url(key)

    def open(self, key: str, chunk: int = CHUNK):
        """presigned URL 위의 HTTP Range 리더 (seek 지원)."""
        return HttpRangeFile(self.url(key), chunk=chunk)

    def read_at(self, key: str, start: int, end: int) -> bytes:
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=self._k(key),
                                   Range=f"bytes={int(start)}-{int(end)}")
            return r["Body"].read()
        except Exception:
            start = max(0, int(start))
            end = min(int(end), self.size(key) - 1)
            if end < start:
                return b""
            f = self.open(key)
            try:
                f.seek(start)
                return f.read(end - start + 1)
            finally:
                f.close()

    def size(self, key: str) -> int:
        return int(self.s3.head_object(Bucket=self.bucket, Key=self._k(key))["ContentLength"])


def build_storage():
    """환경변수로 저장소 선택.

    ECHO_STORAGE=s3  ECHO_S3_BUCKET=...  ECHO_S3_CDN=https://cdn.example.com
    기본값은 로컬.
    """
    if os.environ.get("ECHO_STORAGE", "local").lower() == "s3":
        return S3Storage(
            bucket=os.environ["ECHO_S3_BUCKET"],
            cdn=os.environ.get("ECHO_S3_CDN"),
            prefix=os.environ.get("ECHO_S3_PREFIX", "echo/"),
        )
    return LocalStorage()


storage = build_storage()
