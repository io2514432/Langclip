# -*- coding: utf-8 -*-
"""v8.12.0 — 오늘의 쇼츠 썸네일 원복 + 온보딩 튜토리얼"""
import io

def rd(p):
    with io.open(p, "r", encoding="utf-8", newline="") as f:
        return f.read().replace("\r\n", "\n")

def wr(p, s):
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)

def rep(s, old, new, cnt=1):
    assert s.count(old) == cnt, (old[:70], s.count(old))
    return s.replace(old, new)

# ======================================================= index.html
h = rd("static/index.html")

# --- 설정에 튜토리얼 다시 보기
h = rep(h, '''          <div id="set-langs"></div>''',
'''          <div id="set-langs"></div>
          <div class="sec-title" style="margin-top:26px">앱 둘러보기</div>
          <div id="set-tour"></div>''')

# --- 온보딩 오버레이
ob = '''
  <!-- ================= 온보딩 (첫 실행 1회) ================= -->
  <div class="ob" id="ob" hidden>
    <div class="ob-in">
      <div class="ob-top">
        <span class="ob-brand">Langclip</span>
        <button class="ob-skip" id="ob-skip">건너뛰기</button>
      </div>

      <div class="ob-body" id="ob-body">
        <!-- 1 -->
        <section class="ob-step is-on" data-step="0">
          <div class="ob-art art-play">
            <div class="ap-card">
              <div class="ap-vid">
                <span class="ap-line w1"></span>
                <span class="ap-line w2 is-on"></span>
                <span class="ap-line w3"></span>
              </div>
              <div class="ap-ko">그는 오리들 사이에서 자랐어요</div>
            </div>
          </div>
          <h2 class="ob-t">영어 쇼츠로,<br />문장 하나씩</h2>
          <p class="ob-d">짧은 쇼츠 한 편을 문장 단위로 끊어<br />듣고, 따라 말하고, 확인해요</p>
        </section>

        <!-- 2 -->
        <section class="ob-step" data-step="1">
          <div class="ob-art art-lang">
            <div class="ob-langs" id="ob-langs"></div>
          </div>
          <h2 class="ob-t">어떤 언어를<br />배울까요?</h2>
          <p class="ob-d">고른 언어의 영상만 학습 탭에 모아 보여드려요<br />설정에서 언제든 바꿀 수 있어요</p>
        </section>

        <!-- 3 -->
        <section class="ob-step" data-step="2">
          <div class="ob-art art-shadow">
            <div class="as-wave">
              <i style="height:9px"></i><i style="height:17px"></i><i style="height:26px"></i>
              <i style="height:14px"></i><i style="height:31px"></i><i style="height:22px"></i>
              <i style="height:11px"></i><i style="height:19px"></i><i style="height:7px"></i>
            </div>
            <div class="as-mic"><svg class="ic"><use href="#i-mic"/></svg></div>
            <div class="as-row"><span>억양</span><span>속도</span><span>발음</span><span>강세</span></div>
          </div>
          <h2 class="ob-t">따라 말하면<br />네 가지로 알려드려요</h2>
          <p class="ob-d">억양·속도·발음·첫소리 강세를<br />원본 음성과 견줘 채점해요</p>
        </section>

        <!-- 4 -->
        <section class="ob-step" data-step="3">
          <div class="ob-art art-test">
            <div class="at-rows">
              <div class="at-row"><b>초급</b><em>어절 블록</em><span class="at-med b on"></span></div>
              <div class="at-row"><b>중급</b><em>빈칸 채우기</em><span class="at-med s on"></span></div>
              <div class="at-row"><b>고급</b><em>백지 영작</em><span class="at-med g"></span></div>
            </div>
          </div>
          <h2 class="ob-t">세 단계 테스트로<br />완성도를 확인해요</h2>
          <p class="ob-d">80점을 넘기면 그 난이도의<br />메달을 받아요</p>
        </section>

        <!-- 5 -->
        <section class="ob-step" data-step="4">
          <div class="ob-art art-note">
            <div class="an-card">
              <span class="an-tag">문장</span>
              <b>He always felt downcast</b>
              <em>그는 늘 기가 죽어 있었어요</em>
            </div>
            <div class="an-card back">
              <span class="an-tag">단어</span>
              <b>downcast</b>
              <em>기가 죽은</em>
            </div>
          </div>
          <h2 class="ob-t">어려운 문장은<br />모아서 복습해요</h2>
          <p class="ob-d">북마크한 문장과 단어를<br />잊을 때쯤 다시 꺼내드려요</p>
        </section>
      </div>

      <div class="ob-foot">
        <div class="ob-dots" id="ob-dots"></div>
        <button class="ob-cta" id="ob-cta">다음</button>
      </div>
    </div>
  </div>

'''
h = rep(h, '''    <!-- ===== \\ucd94\\uac00(+) ===== -->''',
           ob + '''    <!-- ===== 추가(+) ===== -->''') if '<!-- ===== \ucd94\uac00(+) ===== -->' in h else h

if 'id="ob"' not in h:
    anchor = '    <div class="sheet-wrap" id="sheet-add" hidden>'
    h = rep(h, anchor, ob + anchor)

h = h.replace("?v=8.11.0", "?v=8.12.0")
wr("static/index.html", h)

# ======================================================= app.js
a = rd("static/app.js")

# 썸네일 원복용 클래스(추가 마크업 불필요) — 온보딩 로직만 추가
ob_js = '''
/* ================= 온보딩 ================= */
const OB = { i: 0, n: 5, lang: "en" };
const OB_KEY = "lc_onboard_v1";

function obRenderLangs() {
  const box = $("#ob-langs");
  if (!box) return;
  box.innerHTML = LANG_LIST.map((l) => `<button class="ob-lang${l.code === OB.lang ? " on" : ""}" data-obl="${l.code}">${esc(l.name)}</button>`).join("");
  box.querySelectorAll("[data-obl]").forEach((el) => {
    el.onclick = () => { OB.lang = el.dataset.obl; setLearnLang(OB.lang); obRenderLangs(); obPaint(); };
  });
}

function obPaint() {
  $$("#ob-body .ob-step").forEach((s) => s.classList.toggle("is-on", +s.dataset.step === OB.i));
  const box = $("#ob-dots");
  if (box) box.innerHTML = Array.from({ length: OB.n }, (_, k) => `<i class="${k === OB.i ? "on" : ""}"></i>`).join("");
  const cta = $("#ob-cta");
  if (cta) cta.textContent = OB.i === OB.n - 1 ? "시작하기" : "다음";
  const body = $("#ob-body");
  if (body) body.scrollTop = 0;
  const skip = $("#ob-skip");
  if (skip) skip.hidden = OB.i === OB.n - 1;
}

function obShow() {
  const box = $("#ob");
  if (!box) return;
  OB.i = 0;
  OB.lang = learnLang();
  box.hidden = false;
  obRenderLangs();
  obPaint();
}

function obClose() {
  const box = $("#ob");
  if (box) box.hidden = true;
  try { localStorage.setItem(OB_KEY, "1"); } catch (e) {}
  renderLangChips();
  renderSettings();
}

function obNext() {
  if (OB.i >= OB.n - 1) return obClose();
  OB.i += 1;
  obPaint();
}
'''

a = rep(a, "/* ================= 홈 ================= */", ob_js + "\n/* ================= 홈 ================= */")

# 설정에 투어 버튼 렌더
a = rep(a, '''  box.querySelectorAll("[data-set]").forEach((el) => {
    el.onclick = () => { setLearnLang(el.dataset.set); renderSettings(); renderLangChips(); };
  });
}''',
'''  box.querySelectorAll("[data-set]").forEach((el) => {
    el.onclick = () => { setLearnLang(el.dataset.set); renderSettings(); renderLangChips(); };
  });
  const tb = $("#set-tour");
  if (tb) {
    tb.innerHTML = `<button class="set-row" id="set-tour-btn">
        <span class="set-n">앱 둘러보기</span><span class="set-sub">다시 보기</span>
      </button>`;
    const b = $("#set-tour-btn");
    if (b) b.onclick = () => obShow();
  }
}''')

# 바인딩 + 첫 실행
a = rep(a, '''  $("#btn-save-blocks").onclick = saveBlocks;''',
'''  $("#btn-save-blocks").onclick = saveBlocks;
  const obCta = $("#ob-cta");
  if (obCta) obCta.onclick = obNext;
  const obSkip = $("#ob-skip");
  if (obSkip) obSkip.onclick = obClose;''')

a = rep(a, '''  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else setTimeout(wire, 40);''',
'''  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else setTimeout(wire, 40);

  try {
    if (localStorage.getItem(OB_KEY) !== "1") {
      const wait = document.getElementById("splash") ? 1700 : 500;
      setTimeout(obShow, wait);
    }
  } catch (e) {}''')

wr("static/app.js", a)

# ======================================================= style.css
c = rd("static/style.css")

# --- 썸네일 원복 : 카드 상단 16:9 커버
old_focus = '''/* --- 오늘의 쇼츠 --- */
.home-sec{margin:20px 0 9px;font-size:12.5px;font-weight:800;color:#0F172A;letter-spacing:-.02em}
.focus{position:relative;padding:12px 13px 13px;border:1px solid #EDF1F6;border-radius:18px;
  background:#fff;box-shadow:none}
.focus-top{display:flex;align-items:center;gap:13px}
.focus-cover{flex:0 0 96px;width:96px;aspect-ratio:9/16;border-radius:11px;overflow:hidden;
  background:#F1F5F9}
.focus-cover img{display:block;width:100%;height:100%;object-fit:cover;object-position:50% 42%}
.focus-tx{flex:1 1 auto;min-width:0}
.focus-title{margin:0;font-size:17px;line-height:1.34;font-weight:850;letter-spacing:-.03em;
  color:#0F172A;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
  word-break:keep-all}
.focus-meta{margin:7px 0 0;font-size:12px;font-weight:650;color:#94A3B8;letter-spacing:-.01em}
.focus .cta{margin-top:13px}'''
new_focus = '''/* --- 오늘의 쇼츠 --- */
.home-sec{margin:20px 0 9px;font-size:12.5px;font-weight:800;color:#0F172A;letter-spacing:-.02em}
.focus{position:relative;padding:0;border:1px solid #EDF1F6;border-radius:18px;background:#fff;
  box-shadow:none;overflow:hidden}
.focus-top{display:block}
.focus-cover{width:100%;aspect-ratio:16/9;border-radius:0;overflow:hidden;background:#F1F5F9}
.focus-cover img{display:block;width:100%;height:100%;object-fit:cover}
.focus-tx{padding:13px 15px 0}
.focus-title{margin:0;font-size:17px;line-height:1.34;font-weight:850;letter-spacing:-.03em;
  color:#0F172A;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  word-break:keep-all}
.focus-meta{margin:6px 0 0;font-size:12px;font-weight:650;color:#94A3B8;letter-spacing:-.01em}
.focus .cta{width:calc(100% - 30px);margin:13px 15px 15px}'''
c = rep(c, old_focus, new_focus)

# --- 설정 부가 텍스트
c = rep(c, '''.set-ck{font-size:10.5px;font-weight:800;color:#0085FF}''',
'''.set-ck{font-size:10.5px;font-weight:800;color:#0085FF}
.set-sub{font-size:11px;font-weight:700;color:#94A3B8}''')

# --- 온보딩
c = c.rstrip("\n") + '''

/* ================= v8.12.0 · 온보딩 ================= */
.ob{position:fixed;inset:0;z-index:9000;background:#fff;display:grid;place-items:center}
.ob[hidden]{display:none}
.ob-in{position:relative;width:100%;max-width:430px;height:100%;max-height:932px;
  display:flex;flex-direction:column;background:#fff}
.ob-top{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;
  padding:18px 20px 4px}
.ob-brand{font-size:13px;font-weight:850;color:#0085FF;letter-spacing:-.02em}
.ob-skip{border:0;background:none;font-family:inherit;font-size:11.5px;font-weight:700;
  color:#B6C2CE;cursor:pointer;padding:4px 0}
.ob-skip[hidden]{display:none}
.ob-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:6px 22px 10px}
.ob-step{display:none;animation:obIn .32s cubic-bezier(.22,.8,.28,1) both}
.ob-step.is-on{display:block}
@keyframes obIn{from{opacity:0;transform:translateY(10px)}}
.ob-art{display:flex;align-items:center;justify-content:center;min-height:236px;margin:6px 0 26px}
.ob-t{margin:0 0 9px;font-size:25px;line-height:1.34;font-weight:850;letter-spacing:-.045em;
  color:#0F172A;word-break:keep-all}
.ob-d{margin:0;font-size:13px;line-height:1.62;font-weight:500;color:#8A96A4;letter-spacing:-.01em;
  word-break:keep-all}
.ob-foot{flex:0 0 auto;padding:6px 22px calc(20px + env(safe-area-inset-bottom,0px))}
.ob-dots{display:flex;justify-content:center;gap:6px;margin-bottom:16px}
.ob-dots i{width:6px;height:6px;border-radius:99px;background:#E2E8F0;transition:width .24s}
.ob-dots i.on{width:18px;background:#0085FF}
.ob-cta{width:100%;height:54px;border:0;border-radius:14px;background:#0085FF;color:#fff;
  font-family:inherit;font-size:15px;font-weight:850;letter-spacing:-.02em;cursor:pointer}
.ob-cta:active{opacity:.88}

/* 1 · 재생 카드 */
.art-play .ap-card{width:100%;max-width:300px;border:1px solid #EDF1F6;border-radius:16px;
  background:#fff;padding:12px}
.art-play .ap-vid{position:relative;aspect-ratio:16/9;border-radius:11px;background:#F1F5F9;
  display:flex;flex-direction:column;justify-content:flex-end;gap:5px;padding:12px}
.art-play .ap-line{display:block;height:7px;border-radius:4px;background:#DDE5EE}
.art-play .ap-line.w1{width:52%}
.art-play .ap-line.w2{width:74%;background:#0085FF}
.art-play .ap-line.w3{width:38%}
.art-play .ap-ko{margin-top:11px;font-size:12px;font-weight:700;color:#5A6B7C;text-align:center;
  letter-spacing:-.01em}

/* 2 · 언어 선택 */
.art-lang{display:block}
.ob-langs{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ob-lang{height:50px;border:0;border-radius:12px;background:#F6F9FC;font-family:inherit;
  font-size:13px;font-weight:750;color:#5A6B7C;letter-spacing:-.01em;cursor:pointer}
.ob-lang.on{background:#0085FF;color:#fff}

/* 3 · 쉐도잉 */
.art-shadow{flex-direction:column;gap:16px}
.as-wave{display:flex;align-items:center;gap:5px;height:40px}
.as-wave i{display:block;width:5px;border-radius:3px;background:#BEDCFA}
.as-wave i:nth-child(5){background:#0085FF}
.as-mic{width:56px;height:56px;border-radius:50%;background:#0085FF;color:#fff;
  display:grid;place-items:center}
.as-mic .ic{width:24px;height:24px;stroke-width:1.9;fill:none;stroke:#fff}
.as-row{display:flex;gap:6px}
.as-row span{font-size:10.5px;font-weight:750;color:#8A96A4;background:#F6F9FC;
  border-radius:7px;padding:4px 9px}

/* 4 · 테스트 */
.art-test{display:block;width:100%;max-width:300px}
.at-rows{display:flex;flex-direction:column;gap:8px}
.at-row{display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:13px;
  background:#F6F9FC}
.at-row b{font-size:12.5px;font-weight:850;color:#0F172A;width:34px}
.at-row em{flex:1 1 auto;font-style:normal;font-size:11.5px;font-weight:600;color:#8A96A4}
.at-med{width:17px;height:17px;border-radius:50%;background:#E2E8F0}
.at-med.b.on{background:#C4794C}
.at-med.s.on{background:#98A4B3}
.at-med.g.on{background:#E2E8F0}

/* 5 · 북마크 */
.art-note{position:relative;height:236px;display:block}
.an-card{position:absolute;left:0;right:0;top:14px;padding:15px 16px;border-radius:14px;
  background:#fff;border:1px solid #EDF1F6}
.an-card.back{top:118px;left:22px;right:-2px;background:#fff}
.an-tag{display:inline-block;font-size:9.5px;font-weight:800;color:#0085FF;background:#EDF6FF;
  border-radius:5px;padding:2px 6px}
.an-card b{display:block;margin-top:8px;font-size:14.5px;font-weight:800;letter-spacing:-.02em;
  color:#0F172A}
.an-card em{display:block;margin-top:4px;font-style:normal;font-size:11.5px;font-weight:600;
  color:#8A96A4}

@media (max-height:700px){
  .ob-art{min-height:190px;margin:2px 0 18px}
  .ob-t{font-size:22px}
  .art-note{height:196px}
  .an-card.back{top:96px}
}
'''
wr("static/style.css", c)
print("p13 ok")
