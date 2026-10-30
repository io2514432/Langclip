"""Echo — 대본(자막) 마크다운 포맷 파서 / 직렬화

■ 왜 마크다운인가
  자막이 없는 영상은 "각 문장이 영상 몇 초에 나오는지"를 사람이 정해줘야 한다.
  SRT는 번호·빈 줄 규칙이 까다롭고 사람이 손으로 쓰기 불편하다.
  그래서 아래처럼 사람이 읽고 쓰기 쉬운 형식을 정본(canonical)으로 삼는다.

■ 형식 (Echo Script Markdown v1)
    # 카페에서 주문하기            <- 영상 제목 (선택)
    @yt aqz-KE-bpKQ                <- 유튜브 ID 또는 URL (필수)
    @duration 58                   <- 영상 길이(초). 없으면 마지막 문장 끝을 사용

    ## 0:04-0:07.5                 <- 문장 구간 (시작-끝)
    EN: Hi, can I get a latte please?
    KO: 라떼 한 잔 주세요.

    ## 8-11.5                      <- 초 단위 숫자만 써도 됨
    EN: Sure. What size would you like?
    KO: 네, 어떤 사이즈로 드릴까요?

  허용되는 변형
    · 구분자  -  ~  –  →  (하이픈/물결/화살표)
    · 시간 표기  0:04 / 00:00:04 / 00:00:04,000 / 4 / 4.5
    · 라벨  EN: / EN / ENG: / 영어:   ·   KO: / KR: / 한: / 한국어:
    · 라벨이 없으면 첫 줄=영어, 둘째 줄=한국어
    · 한 줄 표기   0:04-0:07.5 | Hi, can I get a latte? | 라떼 한 잔 주세요.
    · 구간 없이 문장만 나열하면 전체 길이에 균등 배분(자막 없는 영상 즉시 시작용)

■ 이 모듈은 "사람이 쓴 대본"을 정규화하고, 다시 마크다운으로 돌려준다.
  편집 화면에서 저장 → 다시 열어도 같은 내용이 나와야 하므로 직렬화는 정본 형식만 쓴다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------- 정규식
TC = r"(?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?|\d+(?:\.\d+)?"
RANGE_SEP = r"[-~–—→]"
HEAD_TIME = re.compile(rf"^\s*#{{2,6}}\s*\[?\s*({TC})\s*\]?\s*{RANGE_SEP}\s*\[?\s*({TC})\s*\]?\s*(.*)$")
HEAD_ONE = re.compile(rf"^\s*#{{2,6}}\s*\[?\s*({TC})\s*\]?\s*(.*)$")
INLINE = re.compile(rf"^\s*\[?\s*({TC})\s*\]?\s*{RANGE_SEP}\s*\[?\s*({TC})\s*\]?\s*[|｜]\s*(.+)$")
INLINE_NOEND = re.compile(rf"^\s*\[?\s*({TC})\s*\]?\s*[|｜]\s*(.+)$")
LABEL_EN = re.compile(r"^\s*(?:[-*]\s*)?(?:EN|ENG|ENGLISH|영어)\s*[:：]?\s*(.+)$", re.I)
LABEL_KO = re.compile(r"^\s*(?:[-*]\s*)?(?:KO|KR|KOR|KOREAN|한|한국어|번역)\s*[:：]?\s*(.+)$", re.I)
DIRECTIVE = re.compile(r"^\s*@(\w+)\s*[:=]?\s*(.*)$")
H1 = re.compile(r"^\s*#\s+(.*)$")


# ---------------------------------------------------------------- 시간
def parse_time(tok: str) -> float | None:
    """'0:04' '00:00:04,250' '4' '4.5' -> 초"""
    tok = (tok or "").strip().strip("[]")
    if not tok:
        return None
    tok = tok.replace(",", ".")
    try:
        if ":" in tok:
            parts = tok.split(":")
            if len(parts) == 3:
                h, m, s = parts
                return int(h) * 3600 + int(m) * 60 + float(s)
            if len(parts) == 2:
                m, s = parts
                return int(m) * 60 + float(s)
        return float(tok)
    except ValueError:
        return None


def fmt_time(t: float) -> str:
    """정본 표기: 분:초 (초는 소수 1자리까지, 0이면 생략)"""
    t = max(0.0, float(t))
    m = int(t // 60)
    s = t - m * 60
    if abs(s - round(s)) < 0.05:
        return f"{m}:{int(round(s)):02d}"
    return f"{m}:{s:04.1f}".replace(".0", ".0")


@dataclass
class Seg:
    start: float
    end: float
    en: str = ""
    ko: str = ""

    @property
    def text(self) -> str:
        return self.en or self.ko


@dataclass
class Script:
    title: str = ""
    yt: str = ""
    duration: float = 0.0
    segs: list[Seg] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- 파서
def parse(md: str, default_total: float = 0.0) -> Script:
    sc = Script()
    lines = (md or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cur: Seg | None = None
    pending: list[str] = []          # 구간 헤더 없이 나온 줄들
    seen_h1 = False

    def push() -> None:
        nonlocal cur
        if cur is not None and (cur.en or cur.ko):
            cur.en = _clean(cur.en)
            cur.ko = _clean(cur.ko)
            sc.segs.append(cur)
        cur = None

    def take_time(m: re.Match) -> None:
        nonlocal cur
        push()
        st, en = parse_time(m.group(1)), parse_time(m.group(2))
        if st is None:
            return
        cur = Seg(start=st, end=en if en is not None else st + 4.0)
        rest = (m.group(3) or "").strip()
        if rest:
            _assign(cur, rest)

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        if line.strip() in ("---", "***", "___"):
            continue

        m = DIRECTIVE.match(line)
        if m and not line.strip().startswith("##"):
            k, v = m.group(1).lower(), m.group(2).strip()
            if k in ("yt", "youtube", "video", "url"):
                sc.yt = v
            elif k in ("duration", "dur", "length"):
                sc.duration = parse_time(v) or sc.duration
            elif k in ("title",):
                sc.title = v
            continue

        if not seen_h1:
            m = H1.match(line)
            if m:
                sc.title = m.group(1).strip()
                seen_h1 = True
                continue

        m = HEAD_TIME.match(line)
        if m:
            take_time(m)
            continue
        m = HEAD_ONE.match(line)
        if m and not line.strip().startswith("# "):
            st = parse_time(m.group(1))
            if st is not None:
                push()
                cur = Seg(start=st, end=st + 4.0)
                rest = (m.group(2) or "").strip()
                if rest:
                    _assign(cur, rest)
                continue

        m = INLINE.match(line)
        if m:
            push()
            st, en = parse_time(m.group(1)), parse_time(m.group(2))
            rest = m.group(3)
            bits = [b.strip() for b in re.split(r"\s*[|｜]\s*", rest)]
            cur = Seg(start=st or 0.0, end=en if en is not None else (st or 0) + 4.0,
                      en=bits[0] if bits else "", ko=bits[1] if len(bits) > 1 else "")
            push()
            continue
        m = INLINE_NOEND.match(line)
        if m:
            push()
            st = parse_time(m.group(1)) or 0.0
            bits = [b.strip() for b in re.split(r"\s*[|｜]\s*", m.group(2))]
            cur = Seg(start=st, end=st + 4.0, en=bits[0] if bits else "",
                      ko=bits[1] if len(bits) > 1 else "")
            push()
            continue

        if cur is not None:
            _assign(cur, line)
        else:
            pending.append(line)

    push()

    # 구간 헤더가 하나도 없던 경우: 문장만 나열 → 균등 배분
    if not sc.segs and pending:
        items: list[tuple[str, str]] = []
        for ln in pending:
            m = LABEL_EN.match(ln)
            if m:
                items.append([m.group(1).strip(), ""])            # type: ignore[arg-type]
                continue
            m = LABEL_KO.match(ln)
            if m and items:
                items[-1][1] = m.group(1).strip()                 # type: ignore[index]
                continue
            m = H1.match(ln)
            if m:
                if not sc.title:
                    sc.title = m.group(1).strip()
                continue
            items.append([ln.strip(), ""])                        # type: ignore[arg-type]
        total = sc.duration or default_total or max(6.0, 2.8 * len(items))
        step = total / max(1, len(items))
        for k, (en, ko) in enumerate(items):
            sc.segs.append(Seg(start=round(k * step, 2), end=round((k + 1) * step, 2),
                               en=en, ko=ko))

    _normalize(sc, default_total)
    return sc


def _assign(seg: Seg, text: str) -> None:
    m = LABEL_EN.match(text)
    if m:
        seg.en = (seg.en + " " + m.group(1)).strip() if seg.en else m.group(1)
        return
    m = LABEL_KO.match(text)
    if m:
        seg.ko = (seg.ko + " " + m.group(1)).strip() if seg.ko else m.group(1)
        return
    # 라벨 없는 줄: 영어가 비어 있으면 영어, 아니면 한국어
    if not seg.en:
        seg.en = text.strip()
    elif not seg.ko:
        seg.ko = text.strip()
    else:
        seg.en = (seg.en + " " + text.strip()).strip()


def _clean(s: str) -> str:
    s = re.sub(r"\s+", " ", (s or "").strip())
    return s.strip('"“”').strip()


def _normalize(sc: Script, default_total: float) -> None:
    sc.segs = [s for s in sc.segs if s.en or s.ko]
    for k, s in enumerate(sc.segs):
        if s.end is None or s.end <= s.start:
            nxt = next((x.start for x in sc.segs[k + 1:] if x.start > s.start), None)
            s.end = nxt if nxt else s.start + 4.0
            sc.warnings.append(f"{k + 1}번 문장: 끝 시간이 없어 {fmt_time(s.end)}로 채웠습니다")
        if s.end - s.start < 0.2:
            s.end = s.start + 0.2
        if not s.en and s.ko:
            s.en = s.ko
            sc.warnings.append(f"{k + 1}번 문장: 영어 원문이 없어 한국어를 대신 넣었습니다")

    for k in range(1, len(sc.segs)):
        if sc.segs[k].start < sc.segs[k - 1].end - 1e-6:
            sc.warnings.append(
                f"{k + 1}번 문장이 {k}번과 겹칩니다 "
                f"({fmt_time(sc.segs[k].start)} < {fmt_time(sc.segs[k - 1].end)})")

    if not sc.duration:
        sc.duration = round(max((s.end for s in sc.segs), default=default_total or 0.0), 2)
    for k, s in enumerate(sc.segs):
        s.start = round(max(0.0, s.start), 2)
        s.end = round(max(s.start + 0.2, s.end), 2)


# ---------------------------------------------------------------- 직렬화
def serialize(title: str, yt: str, segs: list[dict], duration: float = 0.0) -> str:
    out = []
    if title:
        out.append(f"# {title}")
    if yt:
        out.append(f"@yt {yt}")
    if duration:
        out.append(f"@duration {fmt_time(duration)}")
    for s in segs:
        en = (s.get("en") or s.get("text") or "").strip()
        ko = (s.get("ko") or "").strip()
        out.append("")
        out.append(f"## {fmt_time(float(s['start']))}-{fmt_time(float(s['end']))}")
        out.append(f"EN: {en}")
        if ko:
            out.append(f"KO: {ko}")
    return "\n".join(out).strip() + "\n"


def to_segs(sc: Script) -> list[dict]:
    """DB 저장 형태로 변환 (text = en 하위호환)"""
    return [{"i": i, "start": round(s.start, 2), "end": round(s.end, 2),
             "en": s.en, "ko": s.ko, "text": s.en}
            for i, s in enumerate(sc.segs)]
