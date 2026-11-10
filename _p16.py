# -*- coding: utf-8 -*-
"""v8.14.0 — 쉐도잉 목업 정리(실제 화면 기준), 메달 심볼, 설정 리스트 그룹화"""
import io

def rd(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")

def wr(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)

def rep(s, old, new, cnt=1):
    assert s.count(old) == cnt, (old[:60], s.count(old))
    return s.replace(old, new)

# ------------------------------------------------------- 파형 SVG 생성
AMP = [3, 6, 12, 8, 16, 22, 15, 9, 19, 26, 14, 7, 11, 18, 24, 13, 6, 10, 21, 28,
       17, 8, 13, 20, 12, 5, 9, 16, 23, 15, 7, 11, 19, 25, 14, 6, 10, 17, 22, 12,
       5, 8, 14, 20, 11, 4, 7, 12, 9, 5]
W, H, CY, STEP = 220.0, 46.0, 23.0, 4.4
top, bot = [], []
for k, a in enumerate(AMP):
    x = round(k * STEP, 1)
    top.append(f"{x},{round(CY - a, 1)}")
    bot.append(f"{x},{round(CY + a * 0.82, 1)}")
PATH = "M" + " L".join(top) + " L" + " L".join(reversed(bot)) + " Z"
PLAY = round(len(AMP) * STEP * 0.78, 1)
WAVE = ('<svg class="as-wave-svg" viewBox="0 0 220 46" preserveAspectRatio="none">'
        '<defs><linearGradient id="asw" x1="0" y1="0" x2="1" y2="0">'
        '<stop offset="0" stop-color="#8B7CF6"/><stop offset="0.55" stop-color="#7C6CF6"/>'
        '<stop offset="1" stop-color="#B388FF"/></linearGradient></defs>'
        f'<path d="{PATH}" fill="url(#asw)" opacity=".92"/>'
        f'<line x1="{PLAY}" y1="2" x2="{PLAY}" y2="44" stroke="#FF5A6E" stroke-width="1.6"/>'
        '</svg>')

# ------------------------------------------------------- index.html
h = rd("static/index.html")

start = h.index('          <div class="ob-art art-shadow">')
end = h.index('</div>\n          </div>\n          <h2 class="ob-t">따라 말하면', start)
end = h.index('\n', end) + 1

ART = '''          <div class="ob-art art-shadow">
            <div class="as-phone">
              <div class="as-fr">
                <div class="as-top"><span>Mother, you are love</span><b>1/7</b></div>
                <div class="as-sub">
                  <span>The first word that a baby learns is mother.</span>
                  <em>아기가 가장 먼저 배우는 단어는 엄마입니다.</em>
                </div>
                <div class="as-rail">
                  <span><svg class="ic"><use href="#i-note"/></svg><em>대본</em></span>
                  <span><svg class="ic"><use href="#i-check"/></svg><em>테스트</em></span>
                  <span><b class="as-cc">CC</b><em>한/영 자막</em></span>
                  <span><svg class="ic"><use href="#i-repeat"/></svg><em>반복</em></span>
                  <span class="on"><svg class="ic"><use href="#i-mic"/></svg><em>쉐도잉</em></span>
                </div>
              </div>
              <div class="as-shot">
                <div class="as-sh-h"><span class="as-tag">듣기</span><em>1. The first word that a baby learns is mother.</em><b>5.1s / 6.0s</b></div>
                ''' + WAVE + '''
                <div class="as-sh-l"><span class="k1">원본</span><span class="k2">내 목소리</span></div>
              </div>
            </div>
          </div>
'''
h = h[:start] + ART + h[end:]

# 테스트 아트 : 메달 심볼
h = rep(h, '<span class="at-med b"></span>', '<svg class="at-med b"><use href="#i-medal"/></svg>')
h = rep(h, '<span class="at-med s"></span>', '<svg class="at-med s"><use href="#i-medal"/></svg>')
h = rep(h, '<span class="at-med g"></span>', '<svg class="at-med g"><use href="#i-medal"/></svg>')

# 반복 아이콘 심볼 추가
if 'id="i-repeat"' not in h:
    h = rep(h, '  <symbol id="i-gear"',
'''  <symbol id="i-repeat" viewBox="0 0 24 24"><path d="M4.5 9.2A7.6 7.6 0 0 1 17 6.1"/><path d="M17.4 2.9v3.5h-3.5"/><path d="M19.5 14.8A7.6 7.6 0 0 1 7 17.9"/><path d="M6.6 21.1v-3.5h3.5"/></symbol>
  <symbol id="i-gear"''')

# 설정 : 앱 둘러보기 헤딩 제거 (카드만)
h = rep(h, '''          <div class="sec-title" style="margin-top:26px">앱 둘러보기</div>
          <div id="set-tour"></div>''', '''          <div id="set-tour" class="set-tour"></div>''')

h = h.replace("?v=8.13.0", "?v=8.14.0")
wr("static/index.html", h)

# ------------------------------------------------------- app.js : 설정 리스트 그룹화
a = rd("static/app.js")

old_settings = '''  const cur = learnLang();
  box.innerHTML = LANG_LIST.map((l) => `<button class="set-row${l.code === cur ? " on" : ""}" data-set="${l.code}">
      <span class="set-n">${esc(l.name)}</span>
      ${l.code === cur ? '<span class="set-ck">사용 중</span>' : ""}
    </button>`).join("");'''
new_settings = '''  const cur = learnLang();
  box.innerHTML = `<div class="set-group">` + LANG_LIST.map((l) => `<button class="set-row${l.code === cur ? " on" : ""}" data-set="${l.code}">
      <span class="set-n">${esc(l.name)}</span>
      ${l.code === cur ? '<span class="set-ck">사용 중</span>' : ""}
    </button>`).join("") + `</div>`;'''
a = rep(a, old_settings, new_settings)

a = rep(a, '''    tb.innerHTML = `<button class="set-row" id="set-tour-btn">
        <span class="set-n">앱 둘러보기</span><span class="set-sub">다시 보기</span>
      </button>`;''',
'''    tb.innerHTML = `<div class="set-group"><button class="set-row" id="set-tour-btn">
        <span class="set-n">앱 둘러보기</span><span class="set-sub">다시 보기</span>
      </button></div>`;''')
wr("static/app.js", a)
print("html/js ok")
