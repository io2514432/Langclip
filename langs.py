# -*- coding: utf-8 -*-
"""학습 언어 레지스트리. 여기 한 줄 추가하면 사전·TTS·스크립트가 따라온다."""

LANGS = {
    "en": {"name": "English",    "tts": "en-US", "wiktionary": "en", "accents": False},
    "es": {"name": "Español",    "tts": "es-ES", "wiktionary": "es", "accents": True},
}
DEFAULT = "en"

def ok(code: str) -> str:
    c = (code or "").strip().lower()
    return c if c in LANGS else DEFAULT

def info(code: str) -> dict:
    c = ok(code)
    d = dict(LANGS[c])
    d["code"] = c
    return d

def tts(code: str) -> str:
    return info(code)["tts"]

def public() -> list:
    return [{"code": k, **v} for k, v in LANGS.items()]
