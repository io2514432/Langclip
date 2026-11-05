# -*- coding: utf-8 -*-
import io, re

def rd(p): return io.open(p, encoding="utf-8").read()
def wr(p, s): io.open(p, "w", encoding="utf-8", newline="\n").write(s)

# ============================================================ sync.js
s = rd("static/sync.js")

auto_fn = '''
  async function waitDuration(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { const d = ST.player && ST.player.getDuration && ST.player.getDuration(); if (d > 0.5) return d; } catch {}
      await new Promise((r) => setTimeout(r, 120));
    }
    return 0;
  }

  /* 자동 싱크: 영상 길이를 문장 수로 균등 분배한다. 정확도는 낮으므로
     저장 후 학습 플레이어에서 '자막 밀기'로 다듬는 것을 전제로 한다. */
  async function auto(opts) {
    const url = (opts.url || "").trim();
    const text = opts.text || "";
    const title = (opts.title || "").trim();
    if (!url) return toast("쇼츠 주소를 입력해주세요");
    if (!text.trim()) return toast("대본을 붙여넣어 주세요");

    const b = $("#btn-auto-sync");
    if (b) { b.disabled = true; b.textContent = "계산 중…"; }
    try {
      const r = await App().jsonPost("/api/sync/split", { text, split_sentences: true });
      if (!r.items || !r.items.length) throw new Error("문장을 찾지 못했습니다");
      ST.url = url; ST.title = title; ST.items = r.items;
      ST.bounds = []; ST.finished = false;
      ST.need = r.items.length > 1 ? r.items.length - 1 : 1;
      const sheet = $("#sheet-add"); if (sheet) sheet.hidden = true;
      show("s-sync");
      const te = $("#sync-title"); if (te) te.textContent = title || "자동 싱크";
      render();
      await mount(url);
      const dur = await waitDuration(9000);
      if (!dur) throw new Error("영상 길이를 읽지 못했습니다. '싱크 맞추기'로 직접 맞춰주세요");

      const n = ST.items.length;
      ST.bounds = [];
      for (let i = 1; i < n; i++) ST.bounds.push(Math.round((dur * i / n) * 100) / 100);
      ST.need = ST.bounds.length || 1;
      render();
      finish();
      toast(`영상 ${dur.toFixed(1)}초 ÷ ${n}문장으로 배치했습니다 · 저장 후 미세조정하세요`, 4200);
    } catch (e) {
      toast("자동 싱크 실패: " + e.message, 5200);
    } finally {
      if (b) { b.disabled = false; b.textContent = "자동 싱크"; }
    }
  }

'''
if "async function auto(opts)" not in s:
    s = s.replace("  function bind() {", auto_fn + "  function bind() {", 1)
    s = s.replace("window.LangclipSync = { ST, start, tap, undo, finish };",
                  "window.LangclipSync = { ST, start, auto, tap, undo, finish };", 1)
wr("static/sync.js", s)

# ============================================================ index.html
h = rd("static/index.html")

# 1) 추가 시트: 싱크 맞추기 + 자동 싱크 (반반)
old_btn = '        <button class="btn primary" id="btn-sync-start">싱크 맞추기</button>'
new_btn = '''        <div class="add-actions">
          <button class="btn primary" id="btn-sync-start">싱크 맞추기</button>
          <button class="btn ghost" id="btn-auto-sync">자동 싱크</button>
        </div>'''
if old_btn in h:
    h = h.replace(old_btn, new_btn, 1)
else:
    raise SystemExit("sync start button not found")

# 2) 플레이어 레일: 관리자용 싱크 미세조정 버튼
rail_anchor = '''            <button class="rail" id="btn-shadow" title="섀도잉 (다시 누르면 취소)">'''
rail_new = '''            <button class="rail" id="btn-nudge" title="자막 싱크 미세조정" hidden>
              <svg class="ic"><use href="#i-list"/></svg><span class="rail-lab">싱크</span>
            </button>
            <button class="rail" id="btn-shadow" title="섀도잉 (다시 누르면 취소)">'''
if 'id="btn-nudge"' not in h:
    if rail_anchor in h:
        h = h.replace(rail_anchor, rail_new, 1)
    else:
        raise SystemExit("rail anchor not found")

# 3) 하단 조작부: 자막 밀기 패널
bottom_anchor = '''            <div class="vprog"><i id="vprog"></i></div>'''
bottom_new = '''            <div class="segadj" id="segadj" hidden>
              <span class="segadj-lab">자막</span>
              <button class="vbtn xs" data-nudge="-0.5">−0.5</button>
              <button class="vbtn xs" data-nudge="-0.1">−0.1</button>
              <button class="vbtn xs" data-nudge="0.1">+0.1</button>
              <button class="vbtn xs" data-nudge="0.5">+0.5</button>
              <button class="vbtn xs" id="segadj-all" title="모든 문장을 함께 옮깁니다">전체</button>
              <span class="segadj-hint" id="segadj-hint"></span>
            </div>
            <div class="vprog"><i id="vprog"></i></div>'''
if 'id="segadj"' not in h:
    if bottom_anchor in h:
        h = h.replace(bottom_anchor, bottom_new, 1)
    else:
        raise SystemExit("vprog anchor not found")

h = h.replace("?v=7.1.0", "?v=7.2.0")
wr("static/index.html", h)

# ============================================================ app.js
a = rd("static/app.js")

nudge_js = '''
/* ================= 자막 싱크 미세조정 (관리자) ================= */
const NUDGE = { on: false, all: false, timer: 0, saving: false };

function nudgeLabel() {
  const el = $("#segadj-hint");
  if (!el || !S.cur) return;
  const s = S.cur.segs[S.idx];
  if (!s) { el.textContent = ""; return; }
  el.textContent = `${S.idx + 1}번 ${s.start.toFixed(1)}–${s.end.toFixed(1)}s` + (NUDGE.all ? " · 전체" : "");
}

function nudgeToggle(force) {
  if (!S.admin || !S.cur) return;
  NUDGE.on = typeof force === "boolean" ? force : !NUDGE.on;
  const box = $("#segadj");
  if (box) box.hidden = !NUDGE.on;
  const rail = $("#btn-nudge");
  if (rail) rail.classList.toggle("on", NUDGE.on);
  nudgeLabel();
}

function nudgeBy(d) {
  if (!S.cur) return;
  const segs = S.cur.segs || [];
  const i = S.idx;
  if (!segs.length) return;
  const r2 = (x) => Math.round(x * 100) / 100;

  if (NUDGE.all) {
    let minStart = Infinity;
    segs.forEach((s) => { minStart = Math.min(minStart, s.start); });
    const dd = minStart + d < 0 ? -minStart : d;
    segs.forEach((s) => { s.start = r2(Math.max(0, s.start + dd)); s.end = r2(Math.max(s.start + 0.2, s.end + dd)); });
  } else {
    const s = segs[i];
    const prev = segs[i - 1];
    let st = r2(s.start + d);
    let en = r2(s.end + d);
    if (st < 0) { const fix = -st; st = 0; en = r2(en + fix); }
    if (prev && st < prev.end) st = prev.end;
    if (en < st + 0.25) en = r2(st + 0.25);
    s.start = st; s.end = en;
    const nx = segs[i + 1];
    if (nx && nx.start < s.end) nx.start = s.end;
  }
  S.seg = segs[i];
  renderSeg();
  nudgeLabel();
  clearTimeout(NUDGE.timer);
  NUDGE.timer = setTimeout(nudgeSave, 650);
}

async function nudgeSave() {
  if (!S.cur || NUDGE.saving) return;
  NUDGE.saving = true;
  try {
    const r = await api(`/api/videos/${S.cur.id}/segs`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segs: S.cur.segs.map((s) => ({ start: s.start, end: s.end })) }),
    });
    S.cur.segs = r.segs;
    S.cur.n = r.n;
    const k = S.videos.findIndex((x) => x.id === S.cur.id);
    if (k >= 0) S.videos[k] = S.cur;
    delete SCRC[S.cur.id];
    S.seg = S.cur.segs[S.idx];
    nudgeLabel();
  } catch (e) {
    toast("싱크 저장 실패: " + e.message, 4200);
  } finally {
    NUDGE.saving = false;
  }
}

'''
if "function nudgeBy(d)" not in a:
    a = a.replace("/* ================= 원본 음성 등록 ================= */", nudge_js + "/* ================= 원본 음성 등록 ================= */", 1)

# 바인딩
bind_add = '''  const bNudge = $("#btn-nudge");
  if (bNudge) bNudge.onclick = () => { try { nudgeToggle(); } catch (e) { toast("열지 못했습니다: " + e.message, 3200); } };
  const bAll = $("#segadj-all");
  if (bAll) bAll.onclick = () => { NUDGE.all = !NUDGE.all; bAll.classList.toggle("on", NUDGE.all); nudgeLabel(); };
  $$("#segadj [data-nudge]").forEach((b) => {
    b.onclick = () => nudgeBy(Number(b.dataset.nudge) || 0);
  });
'''
if 'id="btn-nudge"' not in a and "bNudge" not in a:
    a = a.replace('  const scrEdit = $("#scr-edit");', bind_add + '  const scrEdit = $("#scr-edit");', 1) if '  const scrEdit = $("#scr-edit");' in a else a
    if "bNudge" not in a:
        a = a.replace('  $("#btn-back").onclick = () => {', bind_add + '  $("#btn-back").onclick = () => {', 1)

# 관리자/영상 열기 시 레일 버튼 표시
a = a.replace('''  if (!S.admin) {
    $("#tab-add").hidden = true;''', '''  const railNudge = $("#btn-nudge");
  if (railNudge) railNudge.hidden = !S.admin;
  if (!S.admin) {
    $("#tab-add").hidden = true;''', 1)

a = a.replace('''  setSubClass();
  show("s-play");
  selectSeg(S.idx, true);''', '''  setSubClass();
  show("s-play");
  selectSeg(S.idx, true);
  nudgeLabel();''', 1)
wr("static/app.js", a)

# ============================================================ style.css
c = rd("static/style.css")
if "v7.2 · 자동 싱크" not in c:
    c = c.rstrip() + '''

/* ================= v7.2 · 자동 싱크 / 자막 밀기 ================= */
.add-actions{display:flex;gap:8px;margin-top:2px}
.add-actions .btn{flex:1 1 0;width:auto;min-width:0;margin:0}
.btn.ghost{background:#F2F4F6;color:#334155;border:1px solid #E5E9EF}

.segadj{display:flex;align-items:center;gap:5px;padding:6px 8px;border-radius:12px;
  background:rgba(8,20,32,.55);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(8px)}
.segadj[hidden]{display:none}
.segadj-lab{font-size:10px;font-weight:800;color:#7BD8FF;margin-right:2px}
.segadj-hint{margin-left:auto;font-size:10px;font-weight:700;color:rgba(255,255,255,.6)}
.vbtn.xs{height:26px;min-width:36px;padding:0 7px;font-size:10.5px;font-weight:800;border-radius:8px}
'''
    wr("static/style.css", c)
print("PATCH DONE")
