import re, subprocess
from pathlib import Path
B = Path(r"C:\dev\langclip")
HP, JP, CP = B/"static/index.html", B/"static/app.js", B/"static/style.css"
def rd(p): return p.read_text(encoding="utf-8")
def wr(p, s): p.write_bytes(s.replace("\r\n","\n").replace("\n","\r\n").encode("utf-8"))
h, j, c = rd(HP), rd(JP), rd(CP)
log = []

def brace_fn(src, name, body):
    m = re.search(r'function\s+%s\s*\([^)]*\)\s*\{' % re.escape(name), src)
    if not m: return src, False
    k = src.index("{", m.end()-1); d = 0; end = None
    for i in range(k, len(src)):
        if src[i] == "{": d += 1
        elif src[i] == "}":
            d -= 1
            if d == 0: end = i+1; break
    if not end: return src, False
    return src[:m.start()] + body + src[end:], True

DUMMY = ('const __D={textContent:"",innerHTML:"",innerText:"",value:"",hidden:true,checked:false,'
 'disabled:false,dataset:{},style:{},children:[],scrollHeight:0,clientHeight:0,clientWidth:0,'
 'offsetHeight:0,width:0,height:0,readyState:0,classList:{add(){},remove(){},toggle(){},contains(){return false}},'
 'appendChild(){},removeChild(){},querySelector(){return null},querySelectorAll(){return []},'
 'addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return null},'
 'removeAttribute(){},focus(){},blur(){},closest(){return null},contains(){return false},'
 'scrollIntoView(){},getContext(){return null},play(){return Promise.resolve()},pause(){},load(){}};\n')
if "const __D=" not in j:
    m = re.search(r'(?:const|let|var)\s+\$\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*[^\n;]+;', j)
    if m:
        j = j[:m.start()] + DUMMY + 'const $ = (s) => document.querySelector(s) || __D;' + j[m.end():]
        log.append("dollar-safe")
    else:
        m2 = re.search(r'function\s+\$\s*\([^)]*\)\s*\{[^}]*\}', j)
        if m2:
            j = j[:m2.start()] + DUMMY + 'function $(s){ return document.querySelector(s) || __D; }' + j[m2.end():]
            log.append("dollar-safe-fn")

j, ok = brace_fn(j, "togglePlay", '''function togglePlay() {
  if (SH.phase !== "idle") return;
  if (!S.player || !S.ready) return toast("플레이어 준비 중입니다");
  let st = 0;
  try { st = S.player.getPlayerState(); } catch (e) {}
  if (st === 1) { pausePlayer(); setPlayBtn(false); return; }
  let t = 0;
  try { t = S.player.getCurrentTime() || 0; } catch (e) {}
  const seg = S.seg;
  if (seg && t > seg.start + 0.06 && t < seg.end - 0.03) {
    try { S.player.playVideo(); } catch (e) {}
    setPlayBtn(true);
    return;
  }
  playFrom(S.idx);
}
''')
log.append("togglePlay" if ok else "togglePlay-MISS")

old = 'a.play().catch(() => toast("음원을 재생할 수 없습니다", 3200));'
if old in j:
    j = j.replace(old, '''const go = () => { try { a.play().catch(() => {}); } catch (e) {} };
  if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
  setTimeout(go, 140);''', 1)
    log.append("autoplay")

old7 = '$("#wp-book").classList.toggle("on", WP.saved);'
if old7 in j:
    j = j.replace(old7, '''const wl = (S.notes && (S.notes.words || [])) || [];
    const hasW = wl.some((w) => String(w.word || "").toLowerCase() === String(WP.word).toLowerCase());
    WP.saved = !!WP.saved || hasW;
    const pb = $("#wp-book");
    if (pb) { pb.classList.toggle("on", WP.saved); pb.setAttribute("aria-pressed", WP.saved ? "true" : "false"); }''', 1)
    log.append("word-book-color")

j, ok2 = brace_fn(j, "showScoring", '''function showScoring(on) {
  const el = $("#scoring");
  if (!el) return;
  el.hidden = !on;
  clearTimeout(window.__scT);
  if (on) window.__scT = setTimeout(() => { el.hidden = true; }, 25000);
}
''')
log.append("scoring-watchdog" if ok2 else "scoring-MISS")

for a, b in [("오답 노트", "북마크"), ("오답노트", "북마크"), ("단어장", "단어")]:
    h = h.replace(a, b); j = j.replace(a, b)
h = h.replace('>북마크 <span class="pill" id="n-count-s">', '>문장 <span class="pill" id="n-count-s">')

h = re.sub(r'<symbol id="i-mark".*?</symbol>',
 '<symbol id="i-mark" viewBox="0 0 32 32">\n'
 '    <path d="M16 4.4c7.3 0 13.2 4.6 13.2 10.3S23.3 25 16 25c-1.3 0-2.6-.14-3.8-.4l-5.2 2.3 1.2-5C5.4 20 3 17.4 3 14.7 3 9 8.7 4.4 16 4.4z" fill="#0095F6"/>\n'
 '    <circle cx="12.1" cy="14.4" r="1.75" fill="#FFFFFF"/>\n'
 '    <circle cx="19.9" cy="14.4" r="1.75" fill="#FFFFFF"/>\n'
 '    <path d="M13.5 18q2.5 2.1 5 0" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round"/>\n'
 '  </symbol>', h, flags=re.S)
log.append("logo-bubble")

if "v4.5 런타임 보정" not in j:
    j += r'''

/* ================= v4.5 런타임 보정 ================= */
(function () {
  if (typeof show === "function" && !window.__showWrapped) {
    window.__showWrapped = true;
    const _show = show;
    show = function (id) {
      try { _show(id); } catch (e) { console.warn("show", e); }
      try { showScoring(false); } catch (e) {}
      if (id === "s-script") setTimeout(() => { try { loadScripts(); } catch (e) {} }, 0);
      if (id === "s-list" && (!S.videos || !S.videos.length)) { try { loadVideos(); } catch (e) {} }
      if (id === "s-home") {
        if (!S.videos || !S.videos.length) {
          try { loadVideos().then(() => { try { loadHome(); } catch (e) {} }); } catch (e) {}
        }
        try { loadHome(); } catch (e) {}
      }
    };
  }

  if (typeof renderNotesScreen === "function" && !window.__notesWrapped) {
    window.__notesWrapped = true;
    const _rns = renderNotesScreen;
    renderNotesScreen = function () {
      try { _rns(); } catch (e) { console.warn("notes", e); }
      if (!$("#words-list")) return;
      $$("#words-list .note-card").forEach((el) => {
        el.onclick = null;
        el.style.cursor = "default";
        const ko = el.querySelector(".nc-ko");
        const en = el.querySelector(".nc-en");
        const word = en ? (en.textContent || "").trim() : "";
        if (!ko || !word) return;
        const cur = (ko.textContent || "").trim();
        if (cur && cur.indexOf("적어") < 0) return;
        api("/api/words/" + encodeURIComponent(word)).then((r) => {
          const v = r.ko || ((r.definitions || [])[0] || {}).def || "";
          if (v) ko.textContent = v;
        }).catch(() => {});
      });
    };
  }

  const wire = () => {
    const bs = $("#btn-start");
    if (bs) bs.onclick = () => {
      const f = S.progress && S.progress.focus;
      const go = (v) => { if (v && v.id) jumpTo(v.id, 0); };
      if (f && f.id) return go(f);
      if (S.videos && S.videos.length) return go(S.videos[0]);
      loadVideos().then(() => go(S.videos && S.videos[0])).catch(() => toast("영상을 불러오지 못했습니다"));
    };
    const bsc = $("#btn-script");
    if (bsc) bsc.onclick = () => {
      try { openScriptSheet(); } catch (e) { toast("대본을 열지 못했습니다: " + e.message, 3200); }
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else setTimeout(wire, 40);
})();
'''
    log.append("runtime-block")

if "v4.5 정리" not in c:
    c += '''

/* ================= v4.5 정리 ================= */
.note-card .tag,.note-card .dur,.note-card .nc-time,.note-card .nc-badge{display:none!important}
.note-card .nc-en{display:block!important;overflow:visible!important;white-space:normal!important;
  -webkit-line-clamp:unset!important;text-overflow:clip!important;max-height:none!important}
.note-card .nc-ko{display:block!important;overflow:visible!important;white-space:normal!important;
  -webkit-line-clamp:unset!important;max-height:none!important;margin-top:4px}
#words-list .note-card{cursor:default}
#words-list .note-card:active{transform:none!important;background:#fff!important}
.wp-book.on{color:#FFB800!important}
.wp-book.on .ic{fill:#FFB800!important;stroke:#FFB800!important}
.star.on .ic{fill:#FFB800!important;stroke:#FFB800!important}
'''
    log.append("css-v45")

wr(HP, h); wr(JP, j); wr(CP, c)

def sh(*a):
    r = subprocess.run(list(a), cwd=str(B), capture_output=True)
    return (r.returncode, (r.stdout + b"\n" + r.stderr).decode("utf-8", "replace").strip())

print("PATCH:", ", ".join(log))
print("node app:", sh("node", "--check", "static/app.js")[0])
print("node sync:", sh("node", "--check", "static/sync.js")[0])
sh("git", "add", "-A")
sh("git", "commit", "-q", "-m", "fix: null-safe DOM, resume playback, script autoplay, bookmark colors, flat list, scoring watchdog, bubble logo")
sh("git", "push", "-q", "origin", "main")
print(sh("git", "log", "--oneline", "-1")[1])
