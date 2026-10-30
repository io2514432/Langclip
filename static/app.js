/* =========================================================
   Echo · 문장별 셰도잉  v3.4
   - 홈 대시보드(XP·레벨·배지·연속일)
   - 연속 재생 플레이어 / 반복 on-off / 별표 북마크
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  videos: [], cur: null, idx: 0,
  player: null, ready: false,
  sub: "both", repeat: false,
  seg: null, tick: null, playedOnce: false,
  stream: null, rec: null, chunks: [], actx: null, an: null,
  raf: 0, t0: 0, lastLoud: 0, timer: 0,
  takeBlob: null, notes: { sentences: [], words: [] },
  progress: null, word: null, lastResult: null,
};

/* ---------------- utils ---------------- */
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), ms);
}
const fmt = (n) => (isFinite(n) ? Number(n).toFixed(1) : "0.0");
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function show(id) {
  $$(".screen").forEach((el) => el.classList.toggle("is-active", el.id === id));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === id));
  const sc = $("#" + id + " .scroll");
  if (sc) sc.scrollTop = 0;
  if (id !== "s-play" && id !== "s-test") stopTick();
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let m = "HTTP " + r.status;
    try { const j = await r.json(); m = j.detail || m; } catch { try { m = (await r.text()).slice(0, 160); } catch {} }
    throw new Error(m);
  }
  return r.json();
}
const jsonPost = (url, body) => api(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
});
const jsonPatch = (url, body) => api(url, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
});

/* ---------------- YouTube ---------------- */
let ytPromise = null;
function loadYT() {
  if (ytPromise) return ytPromise;
  ytPromise = new Promise((res) => {
    if (window.YT && window.YT.Player) return res(window.YT);
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onload = () => {
      const wait = () => (window.YT && window.YT.Player ? res(window.YT) : setTimeout(wait, 60));
      wait();
    };
    s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return ytPromise;
}

/* 쇼츠를 화면에 꽉 채우기: 16:9를 확대해 중앙 정렬(cover) */
function sizeVideo() {
  const host = $("#vframe");
  if (!host) return;
  const iw = host.clientWidth, ih = host.clientHeight;
  if (!iw || !ih) return;
  const scale = Math.max(iw / 16, ih / 9);
  const w = Math.round(16 * scale), h = Math.round(9 * scale);
  const f = host.querySelector("iframe");
  if (!f) return;
  f.style.width = w + "px";
  f.style.height = h + "px";
  f.style.left = Math.round((iw - w) / 2) + "px";
  f.style.top = Math.round((ih - h) / 2) + "px";
}
window.addEventListener("resize", () => { if (S.cur) sizeVideo(); });

async function mountPlayer(videoId) {
  const YT = await loadYT();
  const host = $("#yt");
  host.innerHTML = "";
  const box = document.createElement("div");
  host.appendChild(box);
  if (!YT) {
    box.innerHTML = `<div style="display:grid;place-items:center;width:100vw;height:100vh;color:#8AA5BC;font-size:12px;text-align:center;padding:24px;line-height:1.7">YouTube 플레이어를 불러오지 못했습니다.<br/>네트워크 차단 환경에서는 대본만 볼 수 있습니다.</div>`;
    S.player = null; S.ready = false;
    return;
  }
  await new Promise((resolve) => {
    S.player = new YT.Player(box, {
      videoId,
      playerVars: { enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 0, origin: location.origin },
      events: {
        onReady: () => { S.ready = true; sizeVideo(); resolve(); },
        onError: () => { S.ready = false; resolve(); },
      },
    });
  });
  setTimeout(sizeVideo, 200);
}

/* ================= 홈 ================= */
async function loadHome() {
  try { S.progress = await api("/api/progress"); } catch { S.progress = null; }
  try { S.notes = await api("/api/notes"); } catch { S.notes = { sentences: [], words: [] }; }
  renderHome();
}

function renderHome() {
  const p = S.progress || {};
  const f = p.focus;
  const st = p.streak || { days: 0, week: [] };
  const xp = p.xp || { xp: 0, level: 1, pct: 0, next: 120, need: 120 };
  const bg = p.badges || [];
  const got = bg.filter((b) => b.got).length;

  $("#head-streak").textContent = `🔥 ${st.days}일`;
  $("#streak-days").textContent = `연속 학습 ${st.days}일`;
  $("#streak-sub").textContent = st.today_done ? "오늘도 완료!" : (st.days ? "오늘 하면 이어져요" : "첫 학습을 시작해보세요");

  $("#xp-lv").textContent = `Lv.${xp.level}`;
  $("#xp-t").textContent = `${xp.xp} XP · 다음까지 ${xp.next}`;
  $("#xp-badges").textContent = `🏅 ${got}/${bg.length}`;
  $("#xp-fill").style.width = Math.max(3, xp.pct) + "%";

  $("#week").innerHTML = (st.week || []).map((d) => `
    <div class="wday ${d.done ? "done" : ""} ${d.is_today ? "today" : ""} ${d.is_future ? "future" : ""}">
      <span class="wd-lab">${esc(d.label)}</span>
      <span class="wd-dot">${d.is_today ? "🔥" : (d.done ? "•" : "")}</span>
    </div>`).join("");

  if (f) {
    const m = f.memorized || { pct: 0, done: 0, total: f.segs };
    const doneTxt = f.complete ? "암기 완료 ✅" : `문장 ${m.total}개 중 ${m.done}개 통과`;
    $("#daily-t").innerHTML = f.complete
      ? `오늘의 쇼츠 <b>암기 완료</b>`
      : `오늘의 쇼츠 <b>${Math.round(m.pct)}%</b> 암기`;
    $("#daily-s").textContent = f.title || "학습할 쇼츠";
    $("#focus-s").textContent = `「${f.title}」 · ${doneTxt}`;
    $("#focus-bar").style.width = Math.max(2, Math.min(100, m.pct)) + "%";
    $("#focus-meta-l").textContent = `문장 ${m.total}개 · 오늘 ${f.tried_today}회 시도`;
    $("#focus-meta-r").textContent = f.complete ? "완료" : `${Math.round(m.pct)}%`;
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = f.complete ? "다시 복습하기" : (m.tried ? "이어서 학습하기" : "시작하기");
    $("#fan").innerHTML = [0, 1, 2].map((i) => `
      <div class="fan-item">
        <img src="https://i.ytimg.com/vi/${esc(f.yt)}/mqdefault.jpg" alt="" />
        ${i === 1 ? `<span class="fan-badge">${f.complete ? "완료" : Math.round(m.pct) + "%"}</span>` : ""}
      </div>`).join("");
  } else {
    $("#daily-t").innerHTML = "오늘의 쇼츠 <b>0%</b> 암기";
    $("#daily-s").textContent = "등록된 영상이 없습니다";
    $("#focus-s").textContent = "+ 추가 탭에서 첫 쇼츠를 등록해주세요.";
    $("#btn-start").disabled = true;
    $("#fan").innerHTML = `<div class="fan-item"></div><div class="fan-item"></div><div class="fan-item"></div>`;
  }

  const ns = S.notes.sentences || [];
  $("#note-count").textContent = ns.length;
  const box = $("#note-preview");
  if (!ns.length) {
    box.innerHTML = `<div class="note-empty"><b>아직 저장한 문장이 없습니다</b><br />학습 중 자막 위 ☆ 를 누르면 어려운 문장이 여기에 모입니다.</div>`;
  } else {
    box.innerHTML = ns.slice(0, 4).map(noteCard).join("");
    $$("#note-preview .note-card").forEach((el) => {
      el.onclick = () => jumpTo(el.dataset.vid, +el.dataset.idx);
    });
  }
  renderNotesScreen(bg);
}

const noteCard = (n) => `
  <button class="note-card" data-vid="${esc(n.vid)}" data-idx="${n.idx}">
    <div class="nc-en">${esc(n.en)}</div>
    ${n.ko ? `<div class="nc-ko">${esc(n.ko)}</div>` : ""}
    <div class="nc-meta">
      <span class="tag">${fmt(n.start)}–${fmt(n.end)}s</span>
      <span>${esc(n.title || "")}</span>
      <span class="nc-go">›</span>
    </div>
  </button>`;

function renderNotesScreen(bg) {
  const ns = S.notes.sentences || [];
  const nw = S.notes.words || [];
  const badges = bg || (S.progress && S.progress.badges) || [];
  $("#n-count-s").textContent = ns.length;
  $("#n-count-w").textContent = nw.length;
  $("#n-count-b").textContent = badges.filter((b) => b.got).length;

  $("#notes-list").innerHTML = ns.length
    ? ns.map(noteCard).join("")
    : `<div class="note-empty"><b>오답 노트가 비어 있어요</b><br />학습 화면 자막 위 ☆ 를 누르면 이곳에 쌓입니다.</div>`;
  $$("#notes-list .note-card").forEach((el) => {
    el.onclick = () => jumpTo(el.dataset.vid, +el.dataset.idx);
  });

  $("#words-list").innerHTML = nw.length
    ? nw.map((w) => `
      <div class="note-card" style="cursor:default">
        <div class="nc-en">${esc(w.word)}</div>
        <div class="nc-ko">${esc(w.meaning || "뜻을 적어두세요")}</div>
        <div class="nc-meta"><span class="tag">단어</span><span>${esc((w.ctx || "").slice(0, 40))}</span></div>
      </div>`).join("")
    : `<div class="note-empty"><b>단어장이 비어 있어요</b><br />자막의 단어를 탭하면 뜻을 확인하고 담을 수 있습니다.</div>`;

  $("#badge-list").innerHTML = badges.length
    ? `<div class="badges">${badges.map((b) => `
        <div class="badge ${b.got ? "got" : ""}">
          <span class="bd-e">${b.emoji}</span>
          <span class="bd-n">${esc(b.label)}</span>
        </div>`).join("")}</div>`
    : "";
}

async function jumpTo(vid, idx) {
  let v = S.videos.find((x) => x.id === vid);
  if (!v) { try { v = await api("/api/videos/" + vid); } catch { return toast("영상을 찾을 수 없습니다"); } }
  await openVideo(v, idx);
}

/* ================= 영상 목록 ================= */
async function loadVideos() {
  try { S.videos = await api("/api/videos"); }
  catch (e) { S.videos = []; toast("목록을 불러오지 못했습니다: " + e.message, 4000); }
  renderVideos();
}

function renderVideos() {
  const box = $("#vlist");
  $("#v-count").textContent = S.videos.length;
  if (!S.videos.length) {
    box.innerHTML = `<div class="note-empty"><b>아직 영상이 없습니다</b><br />아래 <b>+ 추가</b>에서 쇼츠 주소와 대본을 넣어주세요.</div>`;
    return;
  }
  box.innerHTML = "";
  S.videos.forEach((v) => {
    const pct = v.complete ? 100 : Math.round((v.memorized && v.memorized.pct) || 0);
    const el = document.createElement("div");
    el.className = "note-card vrowcard";
    el.innerHTML = `
      <button class="vdel" title="삭제" data-del="${esc(v.id)}">✕</button>
      <div class="vc-body">
        <div class="vc-thumb">
          <img src="https://i.ytimg.com/vi/${esc(v.yt)}/mqdefault.jpg" alt="" />
        </div>
        <div class="vc-main">
          <div class="nc-en" style="font-size:13px">${esc(v.title)} ${v.complete ? '<span class="okchip">완료</span>' : ""}</div>
          <div class="nc-meta" style="margin-top:5px">
            <span class="tag">문장 ${v.n}개</span>
            <span>${v.memorized ? v.memorized.done : 0}/${v.n} 통과</span>
          </div>
          <div class="focus-bar" style="margin-top:8px;height:5px"><i style="width:${pct}%"></i></div>
        </div>
        <div class="vc-pct">${pct}%</div>
      </div>`;
    el.querySelector(".vc-body").onclick = () => openVideo(v, 0);
    el.querySelector(".vdel").onclick = (e) => { e.stopPropagation(); deleteVideo(v); };
    box.appendChild(el);
  });
}

async function deleteVideo(v) {
  if (!confirm(`「${v.title}」을(를) 삭제할까요?\n\n대본과 학습 기록이 함께 사라집니다.`)) return;
  try {
    await api("/api/videos/" + v.id, { method: "DELETE" });
    if (S.cur && S.cur.id === v.id) { S.cur = null; show("s-list"); }
    await loadVideos();
    await loadHome();
    toast("삭제했습니다");
  } catch (e) { toast("삭제 실패: " + e.message, 4000); }
}

/* ================= 플레이어 ================= */
async function openVideo(v, idx = 0) {
  S.cur = v;
  S.idx = Math.max(0, Math.min(idx, (v.segs || []).length - 1));
  S.repeat = false;
  $("#p-title").textContent = v.title;
  $("#loop-lab").textContent = "반복 끔";
  $("#btn-repeat").classList.remove("on");
  setSubClass();
  show("s-play");
  selectSeg(S.idx, true);
  await mountPlayer(v.yt);
  setTimeout(() => { sizeVideo(); playFrom(S.idx); }, 350);
  startTick();
}

function startTick() { stopTick(); S.tick = setInterval(onTick, 100); }
function stopTick() { if (S.tick) { clearInterval(S.tick); S.tick = null; } }

function onTick() {
  if (!S.player || !S.ready || !S.cur) return;
  let t = 0;
  try { t = S.player.getCurrentTime() || 0; } catch { return; }
  const playing = (() => { try { return S.player.getPlayerState() === 1; } catch { return false; } })();

  if (S.repeat && S.seg) {
    // 반복 켜짐: 현재 문장 구간만 계속 돈다
    if (t >= S.seg.end - 0.06 || t < S.seg.start - 0.35) {
      try { S.player.seekTo(S.seg.start, true); } catch {}
    }
  } else {
    // 반복 꺼짐: 영상은 계속 재생, 자막만 따라간다
    const i = S.cur.segs.findIndex((x) => t >= x.start - 0.06 && t < x.end);
    if (i >= 0 && i !== S.idx) selectSeg(i, true);
  }

  if (S.seg) {
    const d = Math.max(0.1, S.seg.end - S.seg.start);
    const p = Math.min(100, Math.max(0, ((t - S.seg.start) / d) * 100));
    $("#vprog").style.width = p + "%";
  }
  setPlayBtn(playing);
}

function setPlayBtn(on) {
  const b = $("#btn-play");
  if (!b) return;
  b.classList.toggle("on", !!on);
  b.textContent = on ? "❙❙ 일시정지" : "▶ 재생";
}

function renderSeg() {
  const v = S.cur; if (!v) return;
  $("#p-count").textContent = `${S.idx + 1} / ${v.n}`;
  const s = v.segs[S.idx];
  const en = $("#sub-en"), ko = $("#sub-ko");
  en.innerHTML = wordsHTML(s.en || s.text || "");
  en.dataset.plain = s.en || s.text || "";
  ko.textContent = s.ko || "";
  ko.style.display = s.ko ? "" : "none";
  $$("#sub-en .w").forEach((w) => { w.onclick = () => openWord(w.dataset.w, w.dataset.ctx); });

  const marked = (S.notes.sentences || []).some((n) => n.vid === v.id && n.idx === S.idx);
  const star = $("#btn-star");
  star.textContent = marked ? "★" : "☆";
  star.classList.toggle("on", marked);
  star.hidden = S.sub === "off";
}

function wordsHTML(text) {
  const plain = String(text || "");
  return plain.split(/(\s+)/).map((tok) => {
    if (!tok.trim()) return tok;
    const m = tok.match(/^([^\w']*)([\w'’-]+)([^\w']*)$/);
    if (!m) return esc(tok);
    const [, pre, core, post] = m;
    return `${esc(pre)}<span class="w" data-w="${esc(core.replace(/’/g, "'"))}" data-ctx="${esc(plain)}">${esc(core)}</span>${esc(post)}`;
  }).join("");
}

function selectSeg(i, quiet) {
  if (!S.cur) return;
  S.idx = i;
  S.seg = S.cur.segs[i];
  renderSeg();
  if (!quiet) setHint("마이크를 눌러 따라 말하기");
}

function setHint(h) { const el = $("#rec-hint"); if (el) el.innerHTML = h; }

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
  if (!S.player || !S.ready) return toast("플레이어 준비 중입니다");
  let st = 0;
  try { st = S.player.getPlayerState(); } catch {}
  if (st === 1) { try { S.player.pauseVideo(); } catch {} setPlayBtn(false); }
  else { playFrom(S.idx); }
}

function step(delta) {
  if (!S.cur) return;
  const n = S.cur.segs.length;
  playFrom((S.idx + delta + n) % n);
}

/* 자막 모드: 둘 다 → 한국어 → 영어 → 끔 */
function setSubClass() {
  const v = $("#vsub");
  v.className = "vsub" + (S.sub === "both" ? "" : S.sub === "ko" ? " hide-en" : S.sub === "en" ? " hide-ko" : " hide-en hide-ko");
  $("#sub-lab").textContent = { both: "둘 다", ko: "한글만", en: "영어만", off: "끔" }[S.sub];
  $("#btn-sub").classList.toggle("on", S.sub !== "both");
  const star = $("#btn-star");
  if (star) star.hidden = S.sub === "off";
}

function cycleSub() {
  S.sub = S.sub === "both" ? "ko" : S.sub === "ko" ? "en" : S.sub === "en" ? "off" : "both";
  setSubClass();
  toast("자막 " + $("#sub-lab").textContent);
}

function toggleRepeat() {
  S.repeat = !S.repeat;
  $("#loop-lab").textContent = S.repeat ? "반복 켬" : "반복 끔";
  $("#btn-repeat").classList.toggle("on", S.repeat);
  if (S.repeat && S.seg) {
    try { S.player.seekTo(S.seg.start, true); S.player.playVideo(); } catch {}
    toast("현재 문장을 계속 반복합니다");
  } else {
    toast("반복을 껐습니다 · 영상이 계속 재생됩니다");
  }
}

async function toggleStar() {
  if (!S.cur) return;
  try {
    const r = await jsonPost("/api/notes/sentence", { vid: S.cur.id, idx: S.idx });
    await reloadNotes();
    const star = $("#btn-star");
    star.textContent = r.bookmarked ? "★" : "☆";
    star.classList.toggle("on", r.bookmarked);
    toast(r.bookmarked ? "오답 노트에 저장했습니다" : "오답 노트에서 삭제했습니다");
  } catch (e) { toast("저장 실패: " + e.message, 3800); }
}

/* ================= 녹음 / 채점 ================= */
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia) return toast("이 브라우저는 녹음을 지원하지 않습니다");
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) { return toast("마이크를 사용할 수 없습니다 (" + e.name + ")", 4000); }

  const mimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = mimes.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
  S.chunks = [];
  S.rec = new MediaRecorder(S.stream, mime ? { mimeType: mime } : undefined);
  S.rec.ondataavailable = (e) => { if (e.data.size) S.chunks.push(e.data); };
  S.rec.onstop = onRecStop;

  const ctx = S.actx || (S.actx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === "suspended") await ctx.resume();
  S.an = ctx.createAnalyser();
  S.an.fftSize = 1024;
  ctx.createMediaStreamSource(S.stream).connect(S.an);
  const buf = new Float32Array(S.an.fftSize);
  S.t0 = performance.now(); S.lastLoud = S.t0;

  const loop = () => {
    S.an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    if (Math.sqrt(sum / buf.length) > 0.015) S.lastLoud = performance.now();
    const el = (performance.now() - S.t0) / 1000;
    setHint(`녹음 중 <b>${el.toFixed(1)}s</b> · 조용해지면 자동 종료`);
    if (el > 15) stopRec();
    S.raf = requestAnimationFrame(loop);
  };
  loop();
  S.timer = setInterval(() => {
    if (performance.now() - S.t0 > 900 && performance.now() - S.lastLoud > 1600) stopRec();
  }, 120);

  S.rec.start();
  $("#btn-rec").classList.add("rec");
}
function stopRec() {
  if (!S.rec || S.rec.state !== "recording") return;
  S.rec.stop();
  clearInterval(S.timer);
  cancelAnimationFrame(S.raf);
  $("#btn-rec").classList.remove("rec");
  setHint("채점 중…");
}
function onRecStop() {
  const mime = S.chunks[0]?.type || "audio/webm";
  S.takeBlob = new Blob(S.chunks, { type: mime });
  const dur = (performance.now() - S.t0) / 1000;
  try { S.stream.getTracks().forEach((t) => t.stop()); } catch {}
  if (S.takeBlob.size < 1000 || dur < 0.3) return setHint("너무 짧습니다. 다시 시도해주세요");
  submitScore();
}

async function submitScore() {
  const fd = new FormData();
  fd.append("take", S.takeBlob, "take.webm");
  try {
    const r = await api(`/api/videos/${S.cur.id}/segments/${S.idx}/score`, { method: "POST", body: fd });
    S.lastResult = r;
    renderResult(r);
    show("s-result");
    loadHome();
  } catch (e) {
    setHint("채점 실패");
    toast("채점에 실패했습니다: " + e.message, 4200);
  }
}

function renderResult(r) {
  const total = Math.round(r.total);
  $("#total").textContent = total;
  $("#ring").style.setProperty("--p", Math.max(0, Math.min(100, r.total)));
  $("#res-text").textContent = r.text || "";
  $("#res-ko").textContent = r.ko || "";
  const s = S.cur ? S.cur.segs[S.idx] : null;
  $("#res-time").textContent = s ? `${fmt(s.start)}–${fmt(s.end)}s` : "";

  const acoustic = r.mode === "acoustic";
  const vals = acoustic
    ? { pitch: r.pitch ?? 0, rhythm: r.rhythm ?? 0, timbre: r.timbre ?? 0, attack: r.attack ?? 0, timing: null }
    : { pitch: null, rhythm: null, timbre: null, attack: null, timing: r.timing ?? r.total };
  $$(".axis").forEach((el) => {
    const v = vals[el.dataset.k];
    el.style.display = v === null ? "none" : "flex";
    if (v === null) return;
    el.querySelector("i").style.width = Math.max(0, Math.min(100, v)) + "%";
    el.querySelector(".ax-val").textContent = Math.round(v);
    el.classList.toggle("low", v < 55);
  });

  const note = $("#mode-note");
  note.classList.add("show");
  note.innerHTML = acoustic
    ? `원본 음원과 <b>직접 비교</b>한 4축 채점입니다.`
    : `이 문장의 <b>발화 길이</b>를 기준 구간과 비교했습니다. 문장별 암기 테스트로 내용까지 확인하세요.`;

  const g = gradeOf(total);
  $("#grade").textContent = g.label;
  $("#grade").style.color = g.color;
  $("#verdict").textContent = g.verdict;
  $("#coach").innerHTML = coaching(r, acoustic);
}

function gradeOf(t) {
  if (t >= 90) return { label: "PERFECT", color: "#0EA5E9", verdict: "복제 수준입니다. 원본과 거의 구별되지 않아요." };
  if (t >= 78) return { label: "GREAT", color: "#0EA5E9", verdict: "아주 좋아요. 억양의 흐름을 잘 잡았습니다." };
  if (t >= 62) return { label: "GOOD", color: "#38BDF8", verdict: "방향은 맞습니다. 한두 가지만 다듬으면 크게 오릅니다." };
  if (t >= 45) return { label: "FAIR", color: "#F59E0B", verdict: "핵심이 조금 어긋났어요. 아래 코칭을 참고하세요." };
  if (t >= 25) return { label: "WEAK", color: "#FB923C", verdict: "원본과 많이 다릅니다. 한 번 더 듣고 시도해보세요." };
  return { label: "MISS", color: "#F87171", verdict: "거의 다른 소리입니다. 문장을 짧게 끊어서 따라해보세요." };
}
function coaching(r, acoustic) {
  const tips = [];
  if (acoustic) {
    const p = [
      ["pitch", r.pitch ?? 0, "높낮이가 어긋났습니다. 원본의 멜로디를 손으로 그리듯 따라 해보세요."],
      ["rhythm", r.rhythm ?? 0, "속도가 다릅니다. 원본 문장 길이에 맞춰 끝을 맞추는 연습을 해보세요."],
      ["timbre", r.timbre ?? 0, "음색이 다릅니다. 입 모양과 공명 위치를 원본 화자와 같게 만들어보세요."],
      ["attack", r.attack ?? 0, "소리의 시작(어택)이 다릅니다. 첫 음을 더 또렷하게 터뜨려보세요."],
    ];
    p.sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([k, v, m]) => { if (v < 85) tips.push([k, m]); });
  } else {
    const raw = r.raw || {};
    if ((raw.ratio ?? 1) > 1.25) tips.push(["길이", "원본보다 길게 말했습니다. 문장을 끊지 말고 한 호흡에 이어 말해보세요."]);
    else if ((raw.ratio ?? 1) < 0.8) tips.push(["길이", "원본보다 짧습니다. 문장 끝까지 소리를 유지해보세요."]);
    else tips.push(["길이", "속도는 잘 맞았습니다. 다음은 '⋯ 테스트'에서 전체 암송에 도전해보세요."]);
  }
  if (!tips.length) tips.push(["완료", "모든 항목이 훌륭합니다. 반복 횟수를 늘려 완전히 익혀보세요."]);
  return `<h4>코칭</h4><ul>${tips.map(([k, m]) => `<li><b>${k}</b> · ${m}</li>`).join("")}</ul>`;
}

/* ================= 단어 ================= */
async function openWord(word, ctx) {
  if (!word) return;
  S.word = { word, ctx };
  $("#w-word").textContent = word;
  $("#w-phon").textContent = "";
  $("#w-ctx").textContent = ctx || "";
  $("#w-defs").innerHTML = `<div class="word-def" style="opacity:.6">뜻을 불러오는 중…</div>`;
  $("#w-meaning").value = "";
  $("#sheet-word").hidden = false;
  try {
    const r = await api("/api/words/" + encodeURIComponent(word));
    $("#w-phon").textContent = r.phonetic || "";
    if (r.saved && r.saved.meaning) $("#w-meaning").value = r.saved.meaning;
    const defs = (r.definitions || []).map((d) => `
      <div class="word-def"><i>${esc(d.pos || "")}</i>${esc(d.def)}
        ${d.example ? `<em>${esc(d.example)}</em>` : ""}</div>`).join("");
    $("#w-defs").innerHTML = defs || `<div class="word-def" style="opacity:.75">영영 사전 결과가 없습니다. 내 뜻을 직접 적어 저장해보세요.</div>`;
    $("#w-book").textContent = r.saved ? "🔖 단어장에서 빼기" : "🔖 단어장에 담기";
  } catch {
    $("#w-defs").innerHTML = `<div class="word-def" style="opacity:.75">뜻을 불러오지 못했습니다. 직접 적어 저장할 수 있어요.</div>`;
  }
}

async function saveWordMeaning() {
  if (!S.word) return;
  const meaning = $("#w-meaning").value.trim();
  if (!meaning) return toast("뜻을 입력해주세요");
  try {
    await jsonPost("/api/notes/word", { word: S.word.word, meaning, ctx: S.word.ctx, vid: S.cur?.id || "", idx: S.idx });
    await reloadNotes();
    $("#sheet-word").hidden = true;
    toast("단어장에 저장했습니다");
  } catch (e) { toast("저장 실패: " + e.message, 3800); }
}

async function toggleWordBook() {
  if (!S.word) return;
  try {
    const r = await jsonPost("/api/notes/word", {
      word: S.word.word, meaning: $("#w-meaning").value.trim(),
      ctx: S.word.ctx, vid: S.cur?.id || "", idx: S.idx,
    });
    await reloadNotes();
    $("#w-book").textContent = r.bookmarked ? "🔖 단어장에서 빼기" : "🔖 단어장에 담기";
    toast(r.bookmarked ? "단어장에 담았습니다" : "단어장에서 뺐습니다");
  } catch (e) { toast("실패: " + e.message, 3800); }
}

async function reloadNotes() {
  try { S.notes = await api("/api/notes"); } catch {}
  renderNotesScreen();
  $("#note-count").textContent = (S.notes.sentences || []).length;
}

/* ================= 추가(+) ================= */
function openAdd() {
  $("#sheet-add").hidden = false;
}

async function startSyncFromAdd() {
  const url = $("#sy-url").value.trim();
  const title = $("#sy-title").value.trim();
  const text = $("#sy-text").value;
  if (!url) return toast("쇼츠 주소를 입력해주세요");
  if (!text.trim()) return toast("대본을 붙여넣어 주세요");
  $("#sheet-add").hidden = true;
  if (!window.EchoSync) return toast("싱크 모듈을 불러오지 못했습니다");
  await window.EchoSync.start({ url, title, text, split: $("#sy-split").checked });
}

/* ================= 이벤트 ================= */
function bind() {
  $$(".tab[data-tab]").forEach((t) => { t.onclick = () => show(t.dataset.tab); });
  $("#tab-add").onclick = openAdd;
  $$("[data-close]").forEach((el) => (el.onclick = () => { el.closest(".sheet-wrap").hidden = true; }));

  $("#btn-sync-start").onclick = startSyncFromAdd;

  $("#daily").onclick = () => {
    const f = S.progress && S.progress.focus;
    if (!f) return show("s-list");
    jumpTo(f.id, 0);
  };
  $("#btn-start").onclick = () => {
    const f = S.progress && S.progress.focus;
    if (!f) return;
    jumpTo(f.id, 0);
  };
  $("#note-more").onclick = () => show("s-notes");

  $("#btn-back").onclick = () => { try { S.player && S.player.pauseVideo(); } catch {} stopTick(); show("s-home"); };
  $("#btn-play").onclick = togglePlay;
  $("#btn-prev").onclick = () => step(-1);
  $("#btn-next-seg").onclick = () => step(1);
  $("#btn-sub").onclick = cycleSub;
  $("#btn-repeat").onclick = toggleRepeat;
  $("#btn-star").onclick = toggleStar;
  $("#btn-more").onclick = () => window.EchoTests && window.EchoTests.openMenu();

  $("#btn-rec").onclick = () => {
    if (S.rec && S.rec.state === "recording") stopRec();
    else startRec();
  };
  $("#btn-retry").onclick = () => { show("s-play"); setHint("마이크를 눌러 다시 시도"); startTick(); };
  $("#btn-next").onclick = () => { step(1); show("s-play"); startTick(); };

  $("#w-save").onclick = saveWordMeaning;
  $("#w-book").onclick = toggleWordBook;

  document.addEventListener("keydown", (e) => {
    if (!$("#s-play").classList.contains("is-active")) return;
    if (e.target.matches("input,textarea")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
  });
}

/* ================= 시작 ================= */
(async function boot() {
  const d = new Date();
  $("#clock").textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  bind();
  await loadVideos();
  await loadHome();
})();

window.EchoApp = { S, show, toast, esc, fmt, jsonPost, api, loadHome, loadVideos, openVideo, startTick, stopTick, sizeVideo, reloadNotes, mmss };
