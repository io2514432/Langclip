/* Langclip · 플레이어 (재생·자막·틱) — app.js 에서 분리 (v8.14.8) */

/* ================= 플레이어 ================= */
async function openVideo(v, idx = 0) {
  closeWave(true);
  stopAudioBar();
  S.cur = v;
  S.idx = Math.max(0, Math.min(idx, (v.segs || []).length - 1));
  S.repeat = false;
  $("#p-title").textContent = v.title;
  $("#loop-lab").textContent = "반복";
  $("#btn-repeat").classList.remove("on");
  setSubClass();
  show("s-play");
  selectSeg(S.idx, true);
  TM.secs = (v.stage && v.stage.secs) || 0;
  paintGoals();
  nudgeLabel();
  await mountPlayer(v.yt);
  setTimeout(() => { sizeVideo(); playFrom(S.idx); }, 350);
  startTick();
}

const HEARD = new Set();
const STAGE = { skip: 0 };

async function stageEvent(kind, idx) {
  if (!S.cur) return null;
  const key = `${S.cur.id}:${kind}:${idx}`;
  if (HEARD.has(key)) return null;
  HEARD.add(key);
  paintGoals();
  try {
    const r = await jsonPost("/api/progress/event", { vid: S.cur.id, kind, idx });
    applyStage(r);
    return r;
  } catch (e) {
    HEARD.delete(key);          // 실패한 기록은 다음 기회에 다시 시도
    return null;
  }
}

function vdur() {
  try { return (S.player && S.player.getDuration) ? (S.player.getDuration() || 0) : 0; } catch { return 0; }
}

function bindScrub() {
  const bar = document.querySelector(".vprog");
  if (!bar || bar._scrub) return;
  bar._scrub = true;
  const ratio = (e) => {
    const b = bar.getBoundingClientRect();
    return (e.clientX - b.left) / Math.max(1, b.width);
  };
  const seek = (e) => {
    const d = vdur();
    if (!d) return;
    try { S.player.seekTo(Math.max(0, Math.min(1, ratio(e))) * d, true); } catch {}
  };
  bar.addEventListener("pointerdown", (e) => {
    if (!S.ready) return;
    bar.classList.add("drag");
    try { bar.setPointerCapture(e.pointerId); } catch {}
    seek(e);
  });
  bar.addEventListener("pointermove", (e) => { if (bar.classList.contains("drag")) seek(e); });
  const end = () => {
    if (!bar.classList.contains("drag")) return;
    bar.classList.remove("drag");
    const t = (() => { try { return S.player.getCurrentTime() || 0; } catch { return 0; } })();
    const i = (S.cur.segs || []).findIndex((x) => t >= x.start - 0.06 && t < x.end);
    if (i >= 0) selectSeg(i, true);
  };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}

/* 스와이프 : 자막이 밀려 나간 뒤 다음 문장으로 교체 */
let SLIDING = false;
function slideTo(dir) {
  if (SLIDING || SH.phase !== "idle" || !S.cur) return;
  const box = $("#vsub");
  if (!box) { step(dir); return; }
  SLIDING = true;
  const outC = dir > 0 ? "sw-out-l" : "sw-out-r";
  const inC = dir > 0 ? "sw-in-r" : "sw-in-l";
  box.classList.add(outC);
  setTimeout(() => {
    box.classList.remove(outC);
    step(dir);
    box.classList.add(inC);
    void box.offsetWidth;
    box.classList.remove(inC);
    setTimeout(() => { SLIDING = false; }, 220);
  }, 190);
}

function markListen(i) {
  if (i < 0) return;
  stageEvent("listen", i);
}

function startTick() { stopTick(); S.tick = setInterval(onTick, 100); }
function stopTick() { if (S.tick) { clearInterval(S.tick); S.tick = null; } }

function onTick() {
  if (!S.player || !S.ready || !S.cur) return;
  if (SH.phase !== "idle" && SH.phase !== "done") return;
  let t = 0;
  try { t = S.player.getCurrentTime() || 0; } catch { return; }
  let state = -1;
  try { state = S.player.getPlayerState(); } catch (e) {}
  const playing = state === 1;
  const dur = vdur();

  // 오늘 학습(Stage 1): 문장 끝을 지나친 순간 = 그 문장을 끝까지 들은 것
  // (문장 전환으로 S.seg 가 바뀌기 전에 판정해야 한다)
  if (playing && S.seg && t >= S.seg.end - 0.12) markListen(S.idx);
  if (S.cur.segs.length && dur > 0 && (t >= dur - 0.6 || state === 0)) {
    markListen(S.cur.segs.length - 1);
  }

  if (S.repeat && S.seg) {
    if (t >= S.seg.end - 0.04) { try { S.player.seekTo(S.seg.start, true); } catch {} }
  } else {
    const i = S.cur.segs.findIndex((x) => t >= x.start - 0.06 && t < x.end);
    if (i >= 0 && i !== S.idx) selectSeg(i, true);
  }

  const vp = $("#vprog"), vw = vp && vp.parentNode;
  if (vp && !(vw && vw.classList.contains("drag"))) {
    const r = dur > 0 ? (t / dur) * 100 : 0;
    vp.style.width = Math.min(100, Math.max(0, r)) + "%";
  }
  const adj = $("#segadj");
  if (adj && !adj.hidden) { NUDGE.now = t; nudgeLabel(); }
  setPlayBtn(playing);
}

function setPlayBtn(on) {
  S.playing = !!on;
  const b = $("#btn-play");
  if (!b) return;
  b.classList.toggle("on", !!on);
  b.innerHTML = on ? `${ic("i-pause")} 일시정지` : `${ic("i-play")} 재생`;
}

function renderSeg() {
  const v = S.cur; if (!v) return;
  $("#p-count").textContent = `${S.idx + 1} / ${v.n}`;
  const s = v.segs[S.idx];
  const en = $("#sub-en"), ko = $("#sub-ko");
  en.innerHTML = wordsHTML(s.en || s.text || "", s.phr);
  en.dataset.plain = s.en || s.text || "";
  ko.textContent = s.ko || "";
  ko.style.display = s.ko ? "" : "none";
  $$("#sub-en .w").forEach((w) => {
    const band = w.classList.contains("phr");
    w.onclick = (e) => {
      if (band && e.target !== w) return;
      openWord(w.dataset.w, w.dataset.ctx, w.dataset.ko || "");
    };
  });
  fitSub();

  const marked = (S.notes.sentences || []).some((n) => n.vid === v.id && n.idx === S.idx);
  const star = $("#btn-star");
  star.innerHTML = ic("i-star");
  star.classList.toggle("on", marked);
  star.hidden = S.sub === "off";
}

function wordsHTML(text, phrases) {
  const plain = String(text || "");
  const parts = plain.split(/(\s+)/);
  const phr = Array.isArray(phrases) ? phrases : [];
  // 토큰 인덱스 -> 숙어
  const owner = new Map();
  phr.forEach((p, k) => {
    const toks = Array.isArray(p.toks) && p.toks.length
      ? p.toks
      : (p.from != null && p.to != null ? rangeOf(p.from, p.to) : []);
    toks.forEach((i) => owner.set(i, { k, p }));
  });
  let ti = -1, run = null;
  const out = [];
  const openRun = (p) => { out.push('<span class="w phr" data-w="' + esc(p.text) + '" data-ctx="'
    + esc(plain) + '" data-ko="' + esc(p.meaning || "") + '">'); };
  parts.forEach((tok) => {
    if (!tok.trim()) { out.push(tok); return; }
    ti += 1;
    const o = owner.get(ti);
    if (o && (!run || run.k !== o.k)) { if (run) out.push("</span>"); openRun(o.p); run = o; }
    if (!o && run) { out.push("</span>"); run = null; }
    const m = tok.match(/^([^\w']*)([\w'\u2019-]+)([^\w']*)$/);
    if (!m) out.push(esc(tok));
    else out.push(esc(m[1]) + '<span class="w" data-w="' + esc(m[2].replace(/\u2019/g, "'"))
      + '" data-ctx="' + esc(plain) + '">' + esc(m[2]) + "</span>" + esc(m[3]));
  });
  if (run) out.push("</span>");
  return out.join("");
}

function rangeOf(a, b) {
  const out = [];
  for (let i = Number(a); i <= Number(b); i++) out.push(i);
  return out;
}

function selectSeg(i, quiet) {
  if (!S.cur) return;
  S.idx = i;
  S.seg = S.cur.segs[i];
  renderSeg();
  if (typeof nudgeLabel === "function") nudgeLabel();
}

function playFrom(i) {
  if (!S.cur) return;
  const s = S.cur.segs[i];
  if (!s) return;
  selectSeg(i, true);
  if (!S.player || !S.ready) return toast("플레이어 준비 중입니다");
  try { S.player.seekTo(s.start, true); S.player.playVideo(); } catch {}
  setPlayBtn(true);
}

function togglePlay() {
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


function step(delta) {
  if (SH.phase !== "idle") return;
  if (!S.cur) return;
  const n = S.cur.segs.length;
  playFrom((S.idx + delta + n) % n);
}

function setSubClass() {
  const v = $("#vsub");
  v.className = "vsub" + (S.sub === "both" ? "" : S.sub === "ko" ? " hide-en" : S.sub === "en" ? " hide-ko" : " hide-en hide-ko");
  $("#sub-lab").textContent = { both: "한/영 자막", ko: "한글 자막", en: "영어 자막", off: "자막 끔" }[S.sub];
  $("#btn-sub").classList.toggle("on", S.sub !== "both");
  const star = $("#btn-star");
  if (star) star.hidden = S.sub === "off";
}

function cycleSub() {
  if (SH.phase !== "idle") return;
  S.sub = S.sub === "both" ? "ko" : S.sub === "ko" ? "en" : S.sub === "en" ? "off" : "both";
  setSubClass();
  toast("자막 " + $("#sub-lab").textContent);
}

function toggleRepeat() {
  if (SH.phase !== "idle") return;
  S.repeat = !S.repeat;
  $("#loop-lab").textContent = S.repeat ? "반복 중" : "반복";
  $("#btn-repeat").classList.toggle("on", S.repeat);
  toast(S.repeat ? "이 문장이 끝나면 자동으로 다시 시작합니다" : "반복을 껐습니다");
}

async function toggleStar() {
  if (SH.phase !== "idle") return;
  if (!S.cur) return;
  try {
    const r = await jsonPost("/api/notes/sentence", { vid: S.cur.id, idx: S.idx });
    await reloadNotes();
    $("#btn-star").classList.toggle("on", r.bookmarked);
    toast(r.bookmarked ? "북마크에 저장했습니다" : "북마크에서 삭제했습니다");
  } catch (e) { toast("저장 실패: " + e.message, 3800); }
}

