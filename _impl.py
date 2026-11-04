import re
from pathlib import Path

H = Path("static/index.html"); h = H.read_text(encoding="utf-8")
J = Path("static/app.js");    j = J.read_text(encoding="utf-8")
C = Path("static/style.css"); c = C.read_text(encoding="utf-8")
assert c.count(":root{") == 1

# ---------- 1) 북마크 아이콘 추가 ----------
if 'id="i-bookmark"' not in h:
    h = h.replace('<symbol id="i-down"',
        '<symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M6.5 4.2h11a1 1 0 0 1 1 1v14.2l-6.5-4.2-6.5 4.2V5.2a1 1 0 0 1 1-1z"/></symbol>\n    <symbol id="i-down"', 1)

# ---------- 2) 탭: 오답노트 -> 북마크, 대본 추가 ----------
old_nav = '''      <button class="tab" data-tab="s-notes"><svg class="ic"><use href="#i-note"/></svg><span>오답노트</span></button>'''
new_nav = '''      <button class="tab" data-tab="s-script"><svg class="ic"><use href="#i-note"/></svg><span>대본</span></button>
      <button class="tab" data-tab="s-notes"><svg class="ic"><use href="#i-bookmark"/></svg><span>북마크</span></button>'''
assert old_nav in h
h = h.replace(old_nav, new_nav, 1)

# ---------- 3) 대본 화면 ----------
if 'id="s-script"' not in h:
    scr = '''
      <section class="screen" id="s-script">
        <div class="scr-head">
          <div class="scr-t">대본</div>
          <div class="scr-search">
            <svg class="ic xs"><use href="#i-list"/></svg>
            <input id="scr-q" placeholder="문장 검색" autocomplete="off" />
          </div>
        </div>
        <div class="scr-pick" id="scr-pick"></div>
        <div class="scroll scr-body" id="scr-body"></div>
      </section>

'''
    h = h.replace('      <section class="screen" id="s-verify">', scr + '      <section class="screen" id="s-verify">', 1)

# ---------- 4) 단어 팝업 + 사전 시트 ----------
if 'id="word-pop"' not in h:
    pop = '''    <div class="word-pop" id="word-pop" hidden>
      <div class="wp-top">
        <b id="wp-word"></b>
        <button class="wp-book" id="wp-book" aria-label="bookmark"><svg class="ic xs"><use href="#i-bookmark"/></svg></button>
      </div>
      <div class="wp-ko" id="wp-ko"></div>
      <button class="wp-more" id="wp-more">자세히</button>
    </div>

'''
    h = h.replace('    <div class="sheet-wrap" id="sheet-word" hidden>', pop + '    <div class="sheet-wrap" id="sheet-word" hidden>', 1)

# sheet-word -> sheet-dict (사전 모달)
h = h.replace('id="sheet-word"', 'id="sheet-dict"')
j = j.replace('#sheet-word', '#sheet-dict')

# ---------- 5) 결과/학습 화면 여백 안전장치 ----------
# 진행바 아래 시간 텍스트 숨김 (scan 기반, 추측 없음)
m = re.search(r'<section class="screen" id="s-play">(.*?)</section>', h, re.S)
play = m.group(1) if m else ""
hide_rules = []
for _id in re.findall(r'id="([\w-]*(?:time|hint)[\w-]*)"', play):
    hide_rules.append(f"#s-play #{_id}{{display:none !important}}")

# ---------- 6) CSS ----------
css = """
/* ---- 폰 프레임: 창 높이에 맞춰 줄어든다 (버튼 잘림의 근본 원인) ----"""
if "844px" in c:
    css += """
.phone,.app,.frame,.device{}  /* placeholder */"""
fix = re.sub(r'(?<![\w.])844px', 'min(844px, 100dvh)', c)
C.write_text(fix, encoding="utf-8")
c = fix

css += """
.screen{overflow:hidden}
.screen > .scroll{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch}
.screen > *:not(.scroll){flex-shrink:0}
""" + ("\n".join(hide_rules) + "\n" if hide_rules else "")

css += """
/* ---- 영어 자막: 단어별 반투명 박스 ---- */
.sub-en{
  display:flex;flex-wrap:wrap;gap:6px 7px;justify-content:center;
  padding:0 4px;line-height:1.22;
}
.sub-en .w{
  display:inline-block;background:rgba(14,18,24,.58);
  border-radius:10px;padding:4px 9px;
  font-size:19px;font-weight:700;letter-spacing:-.1px;color:#fff;
  box-shadow:0 2px 10px rgba(0,0,0,.22);
  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);
  transition:background .14s ease;
}
.sub-en .w:active{background:rgba(158,91,71,.8)}
.sub-ko{
  margin-top:7px;font-size:12px;font-weight:500;color:rgba(255,255,255,.75);
  text-shadow:0 1px 4px rgba(0,0,0,.85);line-height:1.45;text-align:center;
}

/* ---- 단어 뜻 팝업 ---- */
.word-pop{
  position:fixed;z-index:80;width:min(260px,78vw);
  left:50%;transform:translateX(-50%);bottom:120px;
  background:#15181D;border-radius:14px;padding:13px 15px 11px;
  box-shadow:0 14px 34px rgba(0,0,0,.42);
  animation:wpIn .16s ease-out;
}
@keyframes wpIn{from{opacity:0;transform:translateX(-50%) translateY(6px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.wp-top{display:flex;align-items:center;gap:8px}
.wp-top b{flex:1 1 auto;color:#fff;font-size:15.5px;font-weight:700;letter-spacing:-.1px}
.wp-book{display:none;background:none;border:0;padding:2px;cursor:pointer;color:rgba(255,255,255,.62)}
.wp-book.on{color:#FF6B4A}
.wp-book .ic{width:14px;height:14px}
.wp-book.on .ic{fill:currentColor;stroke:currentColor}
.wp-ko{margin-top:5px;color:rgba(255,255,255,.72);font-size:12.5px;line-height:1.5}
.wp-more{
  display:block;width:100%;margin-top:9px;padding-top:8px;
  border:0;border-top:1px solid rgba(255,255,255,.09);
  background:none;color:#FF6B4A;font-size:12.5px;font-weight:700;cursor:pointer;
}

/* ---- 대본 화면 ---- */
.scr-head{padding:14px 16px 8px}
.scr-t{font-size:19px;font-weight:800;letter-spacing:-.3px;color:var(--ink)}
.scr-search{
  display:flex;align-items:center;gap:7px;margin-top:10px;
  background:var(--surface);border:1px solid var(--line);border-radius:10px;
  padding:0 11px;height:36px;color:var(--ink-3);
}
.scr-search .ic{width:14px;height:14px;flex:0 0 auto}
.scr-search input{
  flex:1 1 auto;border:0;background:none;outline:none;
  font-size:13px;color:var(--ink);font-family:inherit;
}
.scr-search input::placeholder{color:var(--ink-3)}
.scr-pick{display:flex;gap:7px;overflow-x:auto;padding:4px 16px 10px;scrollbar-width:none}
.scr-pick::-webkit-scrollbar{display:none}
.scr-chip{
  flex:0 0 auto;height:29px;padding:0 12px;border-radius:15px;
  border:1px solid var(--line);background:#fff;color:var(--ink-2);
  font-size:11.5px;font-weight:700;white-space:nowrap;cursor:pointer;
}
.scr-chip.on{background:var(--sky);border-color:var(--sky);color:#fff}
.scr-body{padding:0 16px 24px}
.scr-vt{font-size:11px;font-weight:700;color:var(--ink-3);letter-spacing:.04em;margin:6px 0 8px}
.scr-seg{
  display:block;width:100%;text-align:left;background:#fff;
  border:1px solid var(--line);border-radius:11px;
  padding:11px 13px;margin-bottom:8px;cursor:pointer;font-family:inherit;
}
.scr-seg:active{border-color:var(--sky);background:var(--bg)}
.scr-seg .n{font-size:10px;font-weight:700;color:var(--sky-d);margin-right:6px}
.scr-seg .en{font-size:13.5px;line-height:1.55;color:var(--ink)}
.scr-seg .ko{margin-top:3px;font-size:11.5px;line-height:1.5;color:var(--ink-3)}
.scr-empty{padding:40px 0;text-align:center;color:var(--ink-3);font-size:12.5px}
"""
c = c + css
assert c.count(":root{") == 1
C.write_text(c, encoding="utf-8")

# ---------- 7) JS: 팝업 + 대본 ----------
old_open = j[j.index("async function openWord(word, ctx) {"):]
old_open = old_open[:old_open.index("\n}\n") + 3]
new_open = '''async function openWord(word, ctx) {
  if (!word) return;
  if (performance.now() < S.lockUntil) return;
  if (SH.phase !== "idle") return;
  S.word = { word, ctx };
  const pop = $("#word-pop");
  $("#wp-word").textContent = word;
  $("#wp-ko").textContent = "\u2026";
  $("#wp-book").classList.remove("on");
  $("#wp-book").style.display = "none";
  pop.hidden = false;
  try {
    const r = await api("/api/words/" + encodeURIComponent(word));
    const saved = r.saved && r.saved.meaning;
    const first = (r.definitions && r.definitions[0] && r.definitions[0].def) || "";
    $("#wp-ko").textContent = saved || first || r.phonetic || "\uB73B\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4";
    S.word.data = r;
    $("#wp-book").classList.toggle("on", !!(r.saved && r.saved.word));
    $("#wp-book").style.display = "";
  } catch {
    $("#wp-ko").textContent = "\uB73B\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4";
  }
}

function closeWord() {
  const pop = $("#word-pop");
  if (pop) pop.hidden = true;
}

async function openDict() {
  const w = S.word && S.word.word;
  if (!w) return;
  closeWord();
  const r = S.word.data || {};
  $("#w-word").textContent = w;
  $("#w-phon").textContent = r.phonetic || ""
