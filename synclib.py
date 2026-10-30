"""Echo — 대본 붙여넣기 → 문장 분리 → 타이밍 결합 유틸

■ 흐름
  1) 사용자가 쇼츠 주소 + 대본 전체를 붙여넣는다.
  2) split_transcript() 가 "한 줄 = 한 문장" 을 영어/한국어 쌍으로 정리한다.
  3) 앱에서 재생하며 찍은 경계 시각(b0..bN)을 문장 구간으로 결합한다.
  4) to_markdown() 이 정본 마크다운을 만든다 (script_md 와 동일 규칙).

■ 왜 자동 정렬(forced alignment)을 쓰지 않는가
  제3자 유튜브 영상의 오디오를 받아야 하기 때문(약관·저작권). 규칙 2 위반.
  그래서 "재생하며 경계 찍기"로 사람이 0.1초 단위를 맞추고,
  찍은 값은 ±0.1초 미세조정으로 다듬는다.
"""
from __future__ import annotations

import re

HANGUL = re.compile(r"[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]")
LABEL_EN = re.compile(r"^\s*(?:EN|ENG|ENGLISH|영어)\s*[:：]\s*", re.I)
LABEL_KO = re.compile(r"^\s*(?:KO|KR|KOR|KOREAN|한|한국어|번역)\s*[:：]\s*", re.I)
BULLET = re.compile(r"^\s*(?:[-*•·]|\[\d{1,3}\]|\d{1,3}[.)])\s+")
TIMECODE = re.compile(
    r"^\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*\]?\s*(?:[-~–—→]\s*\[?\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*\]?)?\s*")
SENT_END = re.compile(r"(?<=[.!?\"'”’])\s+(?=[A-Z\"'“‘(])")


def _clean(line: str) -> str:
    line = line.replace("\u200b", "").replace("\ufeff", "")
    line = BULLET.sub("", line)
    line = TIMECODE.sub("", line)
    return re.sub(r"\s+", " ", line).strip()


def _is_ko(s: str) -> bool:
    return bool(HANGUL.search(s))


def split_transcript(text: str, split_sentences: bool = True) -> list[dict]:
    """붙여넣은 대본 → [{'en': ..., 'ko': ...}, ...]

    규칙
      · `EN:` / `KO:` 라벨이 있으면 그대로 사용
      · 한 줄에 `영어 / 한국어` 처럼 구분자가 있으면 나눈다
      · 라벨이 없으면: 한글이 없는 줄 = 영어, 한글이 있는 줄 = 한국어
        → 영어 다음에 오는 한국어 줄은 같은 문장의 번역으로 붙인다
      · 영어 문장이 길고 마침표가 여러 개면 (split_sentences) 더 잘게 나눈다
    """
    items: list[dict] = []
    for raw in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if not raw.strip():
            continue
        line = raw.strip()

        # 한 줄에 영어+한국어가 같이 있는 경우
        parts = re.split(r"\s+[/|｜]\s+", line, maxsplit=1)
        if len(parts) == 2 and _is_ko(parts[1]) and not _is_ko(parts[0]) and not LABEL_EN.match(line):
            _push(items, _clean(parts[0]), _clean(parts[1]), split_sentences)
            continue

        m_en = LABEL_EN.match(line)
        if m_en:
            _push(items, _clean(LABEL_EN.sub("", line)), "", split_sentences)
            continue
        m_ko = LABEL_KO.match(line)
        if m_ko:
            ko = _clean(LABEL_KO.sub("", line))
            if items and not items[-1]["ko"]:
                items[-1]["ko"] = ko
            elif items:
                items.append({"en": "", "ko": ko})
            continue

        body = _clean(line)
        if not body:
            continue
        if _is_ko(body):
            if items and not items[-1]["ko"]:
                items[-1]["ko"] = body
            else:
                items.append({"en": "", "ko": body})
        else:
            _push(items, body, "", split_sentences)

    # 영어가 비어 있는 항목은 한국어를 영어 자리에 올린다(채점 텍스트로 쓰기 위해)
    for it in items:
        if not it["en"] and it["ko"]:
            it["en"] = it["ko"]
            it["ko"] = ""

    # 앞뒤 공백/중복 정리
    out = []
    for it in items:
        it["en"] = it["en"].strip()
        it["ko"] = it["ko"].strip()
        if it["en"] or it["ko"]:
            out.append(it)
    return out



def _split_en(en: str) -> list[str]:
    """영어 한 줄을 문장 단위로 나눈다.

    "Sure." 처럼 낱말 2개 이하의 조각은 앞 문장에 붙여 오히려 문장을 뭉개지 않게 한다.
    (한영 쌍이 어긋나는 것을 막기 위한 최소 규칙)
    """
    parts = [c.strip() for c in re.split(r"(?<=[.!?])\s+", en) if c.strip()]
    out: list[str] = []
    buf = ""
    for i, part in enumerate(parts):
        cand = (buf + " " + part).strip() if buf else part
        if len(cand.split()) <= 2 and i < len(parts) - 1:
            buf = cand
            continue
        out.append(cand)
        buf = ""
    if buf:
        out.append(buf)
    return out or [en]


def _push(items: list[dict], en: str, ko: str, do_split: bool) -> None:
    if not en:
        if items and ko and not items[-1]["ko"]:
            items[-1]["ko"] = ko
        return
    # v3.5: 체크박스 없이 항상 마침표/물음표/느낌표 기준으로 나눈다.
    chunks = _split_en(en) if do_split else [en]
    for c in chunks:
        items.append({"en": c, "ko": ko if len(chunks) == 1 else ""})


# ---------------------------------------------------------------- 타이밍 결합
def bounds_to_sentences(items: list[dict], bounds: list[float]) -> list[dict]:
    """경계 시각 배열(b0..bN) → 문장 구간 N개

    b0 = 1번 문장 시작, b1 = 1번 문장 끝(=2번 시작) …  bN = 마지막 문장 끝
    """
    n = len(items)
    b = [round(max(0.0, float(x)), 2) for x in (bounds or [])]
    out: list[dict] = []
    for i in range(n):
        st = b[i] if i < len(b) else (b[-1] if b else 0.0)
        en_ = b[i + 1] if i + 1 < len(b) else st + 3.0
        if en_ <= st:
            en_ = round(st + 0.2, 2)
        out.append({"i": i, "start": round(st, 2), "end": round(en_, 2),
                    "en": items[i]["en"], "ko": items[i].get("ko", ""),
                    "text": items[i]["en"]})
    return out


def validate(sentences: list[dict], duration: float = 0.0) -> list[str]:
    w: list[str] = []
    if not sentences:
        return ["문장이 없습니다"]
    for i, s in enumerate(sentences):
        if s["end"] <= s["start"]:
            w.append(f"{i + 1}번 문장: 끝이 시작보다 빠릅니다")
        elif s["end"] - s["start"] < 0.25:
            w.append(f"{i + 1}번 문장: 구간이 {round(s['end'] - s['start'], 2)}초로 너무 짧습니다")
        if not (s.get("en") or "").strip():
            w.append(f"{i + 1}번 문장: 영어 원문이 비어 있습니다")
        if i and s["start"] < sentences[i - 1]["end"] - 1e-6:
            gap = round(sentences[i - 1]["end"] - s["start"], 2)
            w.append(f"{i + 1}번 문장이 {i}번과 {gap}초 겹칩니다")
    if duration and sentences[-1]["end"] > duration + 0.5:
        w.append(f"마지막 문장 끝({sentences[-1]['end']}초)이 영상 길이({duration}초)를 넘습니다")
    quiet = 0
    for i in range(1, len(sentences)):
        if sentences[i]["start"] - sentences[i - 1]["end"] > 2.0:
            quiet += 1
    if quiet:
        w.append(f"문장 사이 2초 이상 빈 구간이 {quiet}곳 있습니다(무음이면 정상)")
    return w


def fmt_time(t: float) -> str:
    t = max(0.0, float(t))
    m = int(t // 60)
    s = t - m * 60
    if abs(s - round(s)) < 0.05:
        return f"{m}:{int(round(s)):02d}"
    return f"{m}:{s:04.1f}"


def to_markdown(title: str, yt: str, sentences: list[dict], duration: float = 0.0) -> str:
    out = []
    if title:
        out.append(f"# {title}")
    if yt:
        out.append(f"@yt {yt}")
    if duration:
        out.append(f"@duration {fmt_time(duration)}")
    for s in sentences:
        out.append("")
        out.append(f"## {fmt_time(s['start'])}-{fmt_time(s['end'])}")
        out.append(f"EN: {s.get('en', '')}")
        if s.get("ko"):
            out.append(f"KO: {s['ko']}")
    return "\n".join(out).strip() + "\n"
