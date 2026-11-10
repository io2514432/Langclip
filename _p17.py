# -*- coding: utf-8 -*-
"""v8.14.0 — style.css : 쉐도잉 목업/메달/설정 그룹"""
import io

def rd(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")

def wr(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)

c = rd("static/style.css")

# --- 기존 as-* / at-med 규칙 제거
for key in [".as-phone{", ".as-fr{", ".as-top{", ".as-top span{", ".as-top b{",
            ".as-sub{", ".as-sub span{", ".as-sub em{", ".as-rail{",
            ".as-rail > span{", ".as-rail .ic{", ".as-rail em{", ".as-rail > span.on{",
            ".as-shot{", ".as-sh-t{", ".as-sh-w{", ".as-sh-w i{", ".as-sh-w i.p{",
            ".as-sh-l{", ".as-sh-l span{", ".as-tap{", ".at-med{",
            ".at-med.b.on{", ".at-med.s.on{"]:
    i = c.find(key)
    if i < 0:
        continue
    j = c.index("}", i) + 1
    while j < len(c) and c[j] == "\n" and j + 1 < len(c) and c[j + 1] == "\n":
        j += 1
    c = c[:i] + c[j:]

# @keyframes asTap 제거
i = c.find("@keyframes asTap{")
if i >= 0:
    j = c.index("100%{transform:scale(1.18);opacity:0}}", i) + len("100%{transform:scale(1.18);opacity:0}}")
    c = c[:i] + c[j:].lstrip("\n")

c = c.rstrip("\n") + '''

/* ================= v8.14.0 ================= */

/* --- 온보딩 2 : 실제 플레이어 화면 기준 미니 목업 --- */
.as-phone{position:relative;width:100%;max-width:252px;margin:0 auto}
.as-fr{position:relative;aspect-ratio:9/13;border-radius:16px;overflow:hidden;
  background:linear-gradient(168deg,#151B23 0%,#1E2A36 56%,#0D1218 100%);border:1px solid #DFE7EF}
.as-top{position:absolute;left:10px;right:10px;top:10px;display:flex;align-items:center;
  justify-content:space-between;gap:8px}
.as-top span{font-size:7px;font-weight:700;color:rgba(255,255,255,.8);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-top b{flex:0 0 auto;font-size:6.5px;font-weight:800;color:rgba(255,255,255,.62)}
.as-sub{position:absolute;left:10px;right:50px;bottom:12px;display:flex;flex-direction:column;gap:4px}
.as-sub span{font-size:7.5px;line-height:1.5;font-weight:700;color:#fff;
  background:rgba(12,22,32,.7);border-radius:6px;padding:4px 6px}
.as-sub em{font-style:normal;font-size:6.5px;line-height:1.5;color:#D8E7F4;
  background:rgba(12,22,32,.55);border-radius:6px;padding:3px 6px}
.as-rail{position:absolute;right:8px;top:47%;transform:translateY(-42%);
  display:flex;flex-direction:column;align-items:center;gap:9px}
.as-rail > span{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;
  width:32px;color:rgba(255,255,255,.66)}
.as-rail .ic{width:13px;height:13px;stroke:currentColor;stroke-width:1.85;fill:none}
.as-rail em{font-style:normal;font-size:5.5px;font-weight:750;letter-spacing:-.03em}
.as-rail .as-cc{font-size:8px;font-weight:900;letter-spacing:-.06em;line-height:1;color:currentColor}
.as-rail > span.on{color:#8BDFFF}
.as-rail > span.on::before{content:"";position:absolute;left:50%;top:3px;width:26px;height:26px;
  margin-left:-13px;border-radius:50%;background:rgba(0,133,255,.22);
  box-shadow:inset 0 0 0 1.6px rgba(123,216,255,.9)}
/* 퍼져나가는 원 : 쉐도잉 버튼 자리에서만 */
.as-rail > span.on::after{content:"";position:absolute;left:50%;top:3px;width:26px;height:26px;
  margin-left:-13px;border-radius:50%;border:1.8px solid rgba(123,216,255,.8);
  animation:asRing 2.4s ease-out infinite}
@keyframes asRing{0%{transform:scale(.92);opacity:.95}72%{transform:scale(1.72);opacity:0}
  100%{transform:scale(1.72);opacity:0}}

/* 결과 화면 패널 : 한 줄 파형 */
.as-shot{position:absolute;left:10px;bottom:10px;width:62%;border-radius:10px;
  border:1.6px solid rgba(255,255,255,.9);background:#0B1524;padding:6px 7px 5px;
  box-shadow:0 10px 22px -14px rgba(0,0,0,.8)}
.as-sh-h{display:flex;align-items:center;gap:4px;margin-bottom:3px}
.as-tag{flex:0 0 auto;font-size:5.5px;font-weight:800;color:#fff;background:#6D5CE0;
  border-radius:99px;padding:1px 5px}
.as-sh-h em{flex:1 1 auto;min-width:0;font-style:normal;font-size:5px;font-weight:600;
  color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.as-sh-h b{flex:0 0 auto;font-size:5px;font-weight:800;color:#7BD8FF}
.as-wave-svg{display:block;width:100%;height:22px}
.as-sh-l{display:flex;gap:8px;margin-top:3px}
.as-sh-l span{display:inline-flex;align-items:center;gap:3px;font-size:5px;font-weight:700;
  color:rgba(255,255,255,.62)}
.as-sh-l span::before{content:"";width:9px;height:3px;border-radius:99px;background:currentColor}
.as-sh-l .k1{color:#A08CFF}
.as-sh-l .k2{color:#F472B6}

/* --- 온보딩 3 : 난이도 메달 --- */
.at-med{flex:0 0 auto;width:17px;height:17px;color:#E2E8F0;fill:currentColor;stroke:currentColor}
.at-med.b{color:#C4794C}
.at-med.s{color:#98A4B3}
.at-med.g{color:#D8A21D}

/* --- 설정 : 그룹 리스트 --- */
.set-group{background:#fff;border:1px solid #EDF1F6;border-radius:14px;overflow:hidden}
.set-group .set-row{margin:0;border-radius:0;background:#fff;border-bottom:1px solid #F1F5F9;
  padding:16px}
.set-group .set-row:last-child{border-bottom:0}
.set-group .set-row.on{background:#F7FBFF}
.set-group .set-row:hover,.set-group .set-row:active{background:#F8FAFC}
.set-tour{margin-top:10px}
'''
wr("static/style.css", c)
print("css ok")
