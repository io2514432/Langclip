/* =========================================================
   Langclip · 문장별 셰도잉  v3.8
   - 연속 재생 / 반복(문장 끝 자연 반복) / 별표 북마크
   - 전체 스크립트 · 최종 검증(완료 판정) · 원본 음성
   - 쉐도잉: 듣기 → 카운트다운 → 녹음 → 파형 겹치기 → 채점
   ========================================================= */
const __D={textContent:"",innerHTML:"",innerText:"",value:"",hidden:true,checked:false,disabled:false,dataset:{},style:{},children:[],scrollHeight:0,clientHeight:0,clientWidth:0,offsetHeight:0,width:0,height:0,readyState:0,classList:{add(){},remove(){},toggle(){},contains(){return false}},appendChild(){},removeChild(){},querySelector(){return null},querySelectorAll(){return []},addEventListener(){},removeEventListener(){},setAttribute(){},getAttribute(){return null},removeAttribute(){},focus(){},blur(){},closest(){return null},contains(){return false},scrollIntoView(){},getContext(){return null},play(){return Promise.resolve()},pause(){},load(){}};
const $ = (s) => document.querySelector(s) || __D;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  videos: [], cur: null, idx: 0,
  player: null, ready: false,
  sub: "both", repeat: false,
  seg: null, tick: null,
  takeBlob: null, takeUrl: null,
  notes: { sentences: [], words: [] },
  progress: null, word: null, lastResult: null,
  admin: true, lockUntil: 0,
};

/* 쉐도잉 상태 */
const SH = {
  phase: "idle",              // idle | listen | count | take | scoring | done
  dur: 1, ref: new Float32Array(0), user: [],
  playT: 0, raf: 0, cdTimer: 0, startAt: 0,
  stream: null, rec: null, chunks: [], actx: null, an: null, buf: null,
  audio: null, audioUrl: "", decoded: null, score: null, skipListen: false,
  meBuf: null, takeDecoded: null,
};

/* 백지 테스트 */
const VF = { on: false, stage: "recall", typed: {}, n: 0 };

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
const ic = (id, cls = "ic") => `<svg class="${cls}"><use href="#${id}"/></svg>`;

function show(id) {
  if (id !== "s-verify") document.body.classList.remove("vf-focus");
  if (id === "s-script") setTimeout(loadScripts, 0);
  if (id !== "s-play") closeWord();
  if (id === "s-play") stopAudioBar();
  $$(".screen").forEach((el) => el.classList.toggle("is-active", el.id === id));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.tab === id));
  const sc = $("#" + id + " .scroll");
  if (sc) sc.scrollTop = 0;
  S.lockUntil = performance.now() + 420;
  document.body.classList.toggle("play-focus", id === "s-play" || id === "s-sync");
  if (id !== "s-play") { stopTick(); pausePlayer(); closeWave(true); stopMix(); }
  else if (SH.phase !== "idle") closeWave(true);
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
window.addEventListener("resize", () => { if (S.cur) { sizeVideo(); sizeWave(); drawWave(); } });

function killCaptions(p) {
  try { p.unloadModule("captions"); } catch {}
  try { p.unloadModule("cc"); } catch {}
  try { p.setOption("captions", "track", {}); } catch {}
}
function pausePlayer() {
  try { if (S.player && S.ready) S.player.pauseVideo(); } catch {}
}

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
  S.player = null; S.ready = false;
  await new Promise((resolve) => {
    S.player = new YT.Player(box, {
      videoId,
      playerVars: {
        enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 0,
        cc_load_policy: 0, cc_lang_pref: "", iv_load_policy: 3, fs: 0,
        origin: location.origin,
      },
      events: {
        onReady: () => {
          S.ready = true;
          killCaptions(S.player);
          setTimeout(() => S.player && killCaptions(S.player), 900);
          sizeVideo();
          resolve();
        },
        onStateChange: (e) => {
          if (e.data === 1) killCaptions(S.player);
          // 쇼츠가 끝까지 재생되면 처음으로 돌아가 다시 튼다 (쉐도잉·검증 중 제외)
          if (e.data === 0 && SH.phase === "idle") {
            try { S.player.seekTo(0, true); S.player.playVideo(); } catch {}
          }
        },
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

  setStreak(st.days);
  
  

  $("#week").innerHTML = (st.week || []).map((d) => `
    <div class="wday ${d.done ? "done" : ""} ${d.is_today ? "today" : ""} ${d.is_future ? "future" : ""}">
      <span class="wd-lab">${esc(d.label)}</span>
      <span class="wd-dot">${d.done ? "•" : ""}</span>
    </div>`).join("");

  if (f) {
    $("#focus-t").textContent = "오늘의 쇼츠";
    $("#focus-s").textContent = `「${f.title}」 · 문장 ${f.segs}개`;
    const done = !!f.complete;
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = done ? "다시 연습하기" : "학습 시작하기";
    $("#fan").innerHTML = [0, 1, 2].map((i) => `
      <div class="fan-item">
        <img src="https://i.ytimg.com/vi/${esc(f.yt)}/mqdefault.jpg" alt="" />
        ${i === 1 ? `<span class="fan-badge">${done ? "완료" : "학습"}</span>` : ""}
      </div>`).join("");
  } else {
    $("#focus-t").textContent = "오늘의 쇼츠";
    $("#focus-s").textContent = "등록된 영상이 없습니다";
    $("#btn-start").disabled = true;
    $("#btn-start").textContent = "시작하기";
    $("#fan").innerHTML = `<div class="fan-item"></div><div class="fan-item"></div><div class="fan-item"></div>`;
  }

  const ns = S.notes.sentences || [];
  setCount("note-count", ns.length);
  const box = $("#note-preview");
  if (!ns.length) {
    box.innerHTML = `<div class="note-empty"><b>아직 저장한 문장이 없습니다</b><br />학습 중 자막 위 별표를 누르면 어려운 문장이 여기에 모입니다.</div>`;
  } else {
    box.innerHTML = ns.slice(0, 4).map(noteCard).join("");
    $$("#note-preview .note-card").forEach((el) => {
      el.onclick = () => jumpTo(el.dataset.vid, +el.dataset.idx);
    });
  }
  renderNotesScreen();
}

const noteCard = (n) => `
  <button class="note-card" data-vid="${esc(n.vid)}" data-idx="${n.idx}">
    <div class="nc-en">${esc(n.en)}</div>
    ${n.ko ? `<div class="nc-ko">${esc(n.ko)}</div>` : ""}
    <div class="nc-meta">
      <span class="tag">${fmt(n.start)}–${fmt(n.end)}s</span>
      <span>${esc(n.title || "")}</span>
      <span class="nc-go">${ic("i-right", "ic xs")}</span>
    </div>
  </button>`;

function renderNotesScreen() {
  const ns = S.notes.sentences || [];
  const nw = S.notes.words || [];
  setCount("n-count-s", ns.length);
  setCount("n-count-w", nw.length);

  $("#notes-list").innerHTML = ns.length
    ? ns.map(noteCard).join("")
    : `<div class="note-empty"><b>북마크가 비어 있어요</b><br />학습 화면 자막 위 별표를 누르면 이곳에 쌓입니다.</div>`;
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
    : `<div class="note-empty"><b>단어이 비어 있어요</b><br />자막의 단어를 탭하면 뜻을 확인하고 담을 수 있습니다.</div>`;
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
  setCount("v-count", S.videos.length);
  if (!S.videos.length) {
    box.innerHTML = `<div class="note-empty"><b>아직 영상이 없습니다</b><br />아래 <b>추가</b>에서 쇼츠 주소와 대본을 넣어주세요.</div>`;
    return;
  }
  box.innerHTML = "";
  S.videos.forEach((v) => {
    const el = document.createElement("div");
    el.className = "note-card vrowcard";
    el.innerHTML = `
      ${S.admin ? `<button class="vdel" title="삭제" data-del="${esc(v.id)}">${ic("i-close", "ic xs")}</button>` : ""}
      <div class="vc-body">
        <div class="vc-thumb">
          <img src="https://i.ytimg.com/vi/${esc(v.yt)}/mqdefault.jpg" alt="" />
        </div>
        <div class="vc-main">
          <div class="nc-en" style="font-size:13px">${esc(v.title)} ${v.complete ? '<span class="okchip">완료</span>' : ""}</div>
          <div class="nc-meta" style="margin-top:5px">
            ${v.has_audio ? '<span class="tag ok">원본 음성</span>' : ""}
            <span>총 ${v.n}문장</span>
            ${S.admin ? `<button class="v-audio" data-au="${esc(v.id)}">${v.has_audio ? "음원 교체" : "음원 추가"}</button>` : ""}
          </div>
        </div>
        <div class="vc-pct">${v.complete ? ic("i-check", "ic xs") : ""}</div>
      </div>`;
    el.querySelector(".vc-body").onclick = () => openVideo(v, 0);
    const del = el.querySelector(".vdel");
    if (del) del.onclick = (e) => { e.stopPropagation(); deleteVideo(v); };
    const abtn = el.querySelector(".v-audio");
    if (abtn) abtn.onclick = (e) => { e.stopPropagation(); openAudioSheet(v.id); };
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
  await mountPlayer(v.yt);
  setTimeout(() => { sizeVideo(); playFrom(S.idx); }, 350);
  startTick();
}

function startTick() { stopTick(); S.tick = setInterval(onTick, 100); }
function stopTick() { if (S.tick) { clearInterval(S.tick); S.tick = null; } }

function onTick() {
  if (!S.player || !S.ready || !S.cur) return;
  if (SH.phase !== "idle" && SH.phase !== "done") return;
  let t = 0;
  try { t = S.player.getCurrentTime() || 0; } catch { return; }
  const playing = (() => { try { return S.player.getPlayerState() === 1; } catch { return false; } })();

  if (S.repeat && S.seg) {
    if (t >= S.seg.end - 0.04) { try { S.player.seekTo(S.seg.start, true); } catch {} }
  } else {
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
  b.innerHTML = on ? `${ic("i-pause")} 일시정지` : `${ic("i-play")} 재생`;
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
  fitSub();

  const marked = (S.notes.sentences || []).some((n) => n.vid === v.id && n.idx === S.idx);
  const star = $("#btn-star");
  star.innerHTML = ic("i-star");
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

/* ================= 전체 스크립트 ================= */
function openScriptSheet() {
  if (!S.cur) { toast("학습할 쇼츠를 먼저 열어주세요"); return; }
  $("#sc-title").textContent = S.cur.title || "전체 스크립트";
  const segs = S.cur.segs || [];
  $("#sc-list").innerHTML = segs.map((s, i) => `
    <button class="sc-row ${i === S.idx ? "on" : ""}" data-i="${i}">
      <b>${i + 1}</b>
      <span class="sc-txt">
        <em>${esc(s.en || s.text || "")}</em>
        ${s.ko ? `<i>${esc(s.ko)}</i>` : ""}
      </span>
      <span class="sc-time">${fmt(s.start)}s</span>
    </button>`).join("");
  $$("#sc-list .sc-row").forEach((b) => {
    b.onclick = () => { $("#sheet-script").hidden = true; playFrom(+b.dataset.i); };
  });
  $("#sheet-script").hidden = false;
  const cur = $("#sc-list .sc-row.on");
  if (cur) setTimeout(() => cur.scrollIntoView({ block: "center" }), 60);
}

/* ================= 원본 음성 등록 ================= */
function openAudioSheet(vid) {
  if (!S.admin) return toast("관리자만 사용할 수 있습니다", 3000);
  const id = vid || (S.cur && S.cur.id) || SCR.vid || "";
  const v = (S.videos || []).find((x) => x.id === id) || null;
  if (!v) return toast("학습할 쇼츠를 먼저 열어주세요");
  AUD.v = v;
  $("#au-file").value = "";
  $("#au-title").value = v.title || "";
  $("#au-license").value = "";
  $("#au-source").value = "owned";
  $("#au-offset").value = "0";
  $("#au-ok").checked = false;
  $("#sheet-audio").hidden = false;
}

async function saveAudio() {
  const v = AUD.v;
  const f = $("#au-file");
  const file = f && f.files && f.files[0];
  if (!v) return toast("영상을 선택해주세요");
  if (!file) return toast("음성 파일을 선택해주세요");
  if (!$("#au-ok").checked) return toast("권리 확인에 체크해주세요");
  if (file.size > 60 * 1024 * 1024) return toast("60MB를 초과했습니다");
  const b = $("#au-save");
  b.disabled = true; b.textContent = "올리는 중…";
  try {
    const off = Number($("#au-offset").value) || 0;
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("title", $("#au-title").value.trim() || v.title || file.name);
    fd.append("offset", String(off));
    fd.append("source", $("#au-source").value);
    fd.append("license", $("#au-license").value.trim());
    const au = await api("/api/audios", { method: "POST", body: fd });
    await jsonPost(`/api/videos/${v.id}/link-audio`, { audio_id: au.id, offset: off });
    delete SCRC[v.id];
    await loadVideos();
    await loadHome();
    AUD.v = (S.videos || []).find((x) => x.id === v.id) || v;
    if (S.cur && S.cur.id === v.id) await refreshCur();
    AUD.v = null;
    $("#sheet-audio").hidden = true;
    toast("원본 음성을 연결했습니다", 3200);
    if ($("#s-script").classList.contains("is-active")) renderScript();
  } catch (e) {
    toast("올리기 실패: " + e.message, 4600);
  } finally {
    b.disabled = false; b.textContent = "올리고 연결하기";
  }
}

async function unlinkAudio() {
  const v = AUD.v || S.cur;
  if (!v) return;
  if (!confirm("이 영상에서 원본 음성 연결을 해제할까요? (파일은 서버에 남습니다)")) return;
  try {
    await jsonPost(`/api/videos/${v.id}/link-audio`, { audio_id: null });
    delete SCRC[v.id];
    await loadVideos();
    await loadHome();
    AUD.v = (S.videos || []).find((x) => x.id === v.id) || v;
    if (S.cur && S.cur.id === v.id) await refreshCur();
    toast("연결을 해제했습니다");
  } catch (e) { toast("해제 실패: " + e.message, 4000); }
}

async function refreshCur() {
  if (!S.cur) return;
  try {
    const v = await api("/api/videos/" + S.cur.id);
    Object.assign(S.cur, v);
    const i = S.videos.findIndex((x) => x.id === v.id);
    if (i >= 0) S.videos[i] = v;
    S.seg = S.cur.segs[S.idx];
    renderSeg();
  } catch {}
}

/* ================= 파형 ================= */
function sizeWave() {
  const cv = $("#wv-cv");
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
}

function refEnvelope(text) {
  const N = 260;
  const a = new Float32Array(N);
  const words = String(text || "").toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
  const units = [];
  words.forEach((w) => {
    const vs = (w.match(/[aeiouy]+/g) || []).length || 1;
    for (let i = 0; i < vs; i++) units.push(0.85 + 0.15 * (((w.charCodeAt(i % w.length) * 13) % 7) / 7));
    units.push(0.16);
  });
  if (!units.length) units.push(1);
  const total = units.reduce((x, y) => x + y, 0);
  let acc = 0;
  units.forEach((u, k) => {
    const s = Math.floor((acc / total) * N), e = Math.max(s + 1, Math.floor(((acc + u) / total) * N));
    const amp = 0.34 + 0.58 * Math.abs(Math.sin((k + 1) * 2.399));
    for (let i = s; i < Math.min(e, N); i++) {
      const x = (i - s) / Math.max(1, e - s);
      a[i] = Math.max(a[i], amp * Math.sin(Math.PI * x));
    }
    acc += u;
  });
  for (let i = 1; i < N - 1; i++) a[i] = (a[i - 1] + 2 * a[i] + a[i + 1]) / 4;
  return a;
}

function peaksFromBuffer(buf, from, to, N = 260) {
  const out = new Float32Array(N);
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(ch.length, Math.floor(to * sr));
  const span = b - a;
  if (span <= 0) return out;
  const step = span / N;
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const s = a + Math.floor(i * step);
    const e = Math.min(b, s + Math.max(1, Math.floor(step)));
    let m = 0;
    for (let k = s; k < e; k++) { const v = Math.abs(ch[k]); if (v > m) m = v; }
    out[i] = m;
    if (m > peak) peak = m;
  }
  if (peak > 0) for (let i = 0; i < N; i++) out[i] = Math.min(1, out[i] / peak);
  return out;
}

function drawWave() {
  const cv = $("#wv-cv");
  if (!cv || !cv.width) return;
  const g = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  const dpr = w / Math.max(1, cv.clientWidth);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#0B1524";
  g.fillRect(0, 0, w, h);

  const mid = h * 0.5, half = h * 0.42;
  g.strokeStyle = "rgba(255,255,255,.3)";
  g.lineWidth = Math.max(1, dpr * 0.8);
  g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();

  const N = SH.ref.length;
  if (N > 2) {
    g.beginPath();
    for (let i = 0; i < N; i++) g.lineTo((i / (N - 1)) * w, mid - SH.ref[i] * half);
    for (let i = N - 1; i >= 0; i--) g.lineTo((i / (N - 1)) * w, mid + SH.ref[i] * half);
    g.closePath();
    g.fillStyle = "rgba(139,124,246,.42)";
    g.fill();
    g.strokeStyle = "rgba(196,187,255,.95)";
    g.lineWidth = Math.max(1, dpr);
    g.stroke();
  }

  if (SH.user.length > 1) {
    g.beginPath();
    for (let i = 0; i < SH.user.length; i++) g.lineTo((SH.user[i].t / SH.dur) * w, mid - SH.user[i].a * half);
    for (let i = SH.user.length - 1; i >= 0; i--) g.lineTo((SH.user[i].t / SH.dur) * w, mid + SH.user[i].a * half);
    g.closePath();
    g.fillStyle = "rgba(255,45,149,.42)";
    g.fill();
    g.strokeStyle = "#FF6FBF";
    g.lineWidth = Math.max(1, dpr * 1.2);
    g.stroke();
  }

  if (SH.phase === "listen" || SH.phase === "take" || SH.phase === "done") {
    const t = SH.phase === "done" ? SH.dur : Math.min(SH.dur, Math.max(0, SH.playT));
    const x = (t / SH.dur) * w;
    g.strokeStyle = "#FF3B5C";
    g.lineWidth = Math.max(1.5, dpr * 1.6);
    g.shadowColor = "#FF3B5C";
    g.shadowBlur = 10 * dpr;
    g.beginPath(); g.moveTo(x, 3 * dpr); g.lineTo(x, h - 3 * dpr); g.stroke();
    g.shadowBlur = 0;
  }
}

function waveState(txt, cls) {
  const el = $("#wv-state");
  if (!el) return;
  el.textContent = txt;
  el.className = "wv-state " + (cls || "");
}

function lockStage(on) {
  const st = $("#vstage");
  if (st) st.classList.toggle("lock", !!on);
  const b = $("#btn-shadow");
  if (b) b.classList.toggle("on", !!on);
  const lab = $("#shadow-lab"); if (lab) lab.textContent = "쉐도잉";
}

function openWave(label) {
  $("#wave").hidden = false;
  $("#wv-lab").textContent = label;
  $("#wv-score").textContent = "";
  $("#wv-score").className = "wv-score";
  $("#vsub").classList.add("hidden-sub");
  lockStage(true);
  requestAnimationFrame(() => { sizeWave(); drawWave(); });
}

function closeWave(silent) {
  const active = SH.phase !== "idle";
  clearInterval(SH.cdTimer);
  cancelAnimationFrame(SH.raf);
  SH.phase = "idle";
  SH.user = [];
  SH.playT = 0;
  try { if (SH.rec && SH.rec.state === "recording") SH.rec.stop(); } catch {}
  SH.rec = null;
  try { if (SH.stream) SH.stream.getTracks().forEach((t) => t.stop()); } catch {}
  SH.stream = null;
  stopOriginal();
  const w = $("#wave"); if (w) w.hidden = true;
  const cd = $("#countdown"); if (cd) cd.hidden = true;
  const skip = $("#wv-skip"); if (skip) skip.hidden = true;
  const vsub = $("#vsub"); if (vsub) vsub.classList.remove("hidden-sub");
  lockStage(false);
  if (active && !silent) pausePlayer();
}

function countdown(n, onDone) {
  const el = $("#countdown");
  el.hidden = false;
  let k = n;
  $("#cd-num").textContent = k;
  el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  clearInterval(SH.cdTimer);
  SH.cdTimer = setInterval(() => {
    k--;
    if (k <= 0) {
      clearInterval(SH.cdTimer);
      el.hidden = true;
      onDone();
      return;
    }
    $("#cd-num").textContent = k;
    el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  }, 1000);
}

async function ensureDecoded(url) {
  if (!url) return null;
  if (SH.decoded && SH.audioUrl === url) return SH.decoded;
  const ctx = SH.actx || (SH.actx = new (window.AudioContext || window.webkitAudioContext)());
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  SH.decoded = await ctx.decodeAudioData(buf);
  SH.audioUrl = url;
  return SH.decoded;
}

function stopOriginal() {
  if (SH.audio) { try { SH.audio.pause(); } catch {} }
}
function playOriginalSeg(seg) {
  const au = S.cur && S.cur.audio;
  if (!au || !au.url) return false;
  if (!SH.audio) SH.audio = new Audio();
  if (SH.audio.src !== au.url) SH.audio.src = au.url;
  try {
    SH.audio.pause();
    SH.audio.currentTime = Math.max(0, seg.start - Number(au.offset || 0));
    SH.audio.play().catch(() => {});
    return true;
  } catch { return false; }
}

/* ---------------- 쉐도잉 본체 ---------------- */
function cancelShadow() {
  if (SH.phase === "idle") return;
  VF.on = false;
  closeWave();
  toast("쉐도잉을 취소했습니다");
}

function onShadowBtn() {
  if (SH.phase !== "idle") return cancelShadow();
  startShadow();
}

async function startShadow() {
  if (!S.cur || !S.seg) return;
  if (!S.player || !S.ready) return toast("플레이어 준비 중입니다");

  const seg = S.seg;
  const au = S.cur.audio;
  SH.dur = Math.max(0.6, seg.end - seg.start);
  SH.user = [];
  SH.playT = 0;
  SH.score = null;

  openWave(`${S.idx + 1}. ${seg.en || seg.text || ""}`);

  if (au && au.url) {
    waveState("준비", "load");
    try {
      const buf = await ensureDecoded(au.url);
      const off = Number(au.offset || 0);
      SH.ref = peaksFromBuffer(buf, seg.start - off, seg.end - off);
    } catch {
      SH.ref = refEnvelope(seg.en || seg.text);
    }
  } else {
    SH.ref = refEnvelope(seg.en || seg.text);
  }
  drawWave();

  // 다시 하기: 듣기 생략하고 바로 카운트다운
  if (SH.skipListen) {
    SH.skipListen = false;
    SH.phase = "count";
    waveState("준비", "count");
    drawWave();
    countdown(2, beginTake);
    return;
  }

  // 1) 듣기 — 벽시계 기준(원본 음성이 짧아도 반드시 끝난다)
  SH.phase = "listen";
  waveState("듣기", "listen");
  $("#wv-skip").hidden = false;
  pausePlayer();
  await new Promise((r) => setTimeout(r, 40));
  playOriginalSeg(seg) || (() => { try { S.player.seekTo(seg.start, true); S.player.playVideo(); } catch {} })();

  const t0 = performance.now();
  cancelAnimationFrame(SH.raf);
  const listen = () => {
    if (SH.phase !== "listen") return;
    const el = (performance.now() - t0) / 1000;
    const target = Math.min(SH.dur, el);
    SH.playT = SH.playT + (target - SH.playT) * 0.55;
    $("#wv-time").textContent = `${SH.playT.toFixed(1)}s / ${SH.dur.toFixed(1)}s`;
    drawWave();
    if (el >= SH.dur + 0.2) { endListen(); return; }
    SH.raf = requestAnimationFrame(listen);
  };
  listen();
}

function endListen() {
  if (SH.phase !== "listen") return;
  cancelAnimationFrame(SH.raf);
  stopOriginal();
  pausePlayer();
  $("#wv-skip").hidden = true;
  SH.phase = "count";
  SH.playT = 0;
  waveState("준비", "count");
  drawWave();
  countdown(2, beginTake);
}

async function beginTake() {
  if (SH.phase !== "count" || !S.seg || !S.cur) return;
  const seg = S.seg;

  try {
    SH.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    showScoring(false);
    SH.phase = "done";
    closeWave();
    show("s-play"); startTick();
    return toast("마이크를 사용할 수 없습니다 (" + (e && e.name ? e.name : "권한 필요") + ")", 4600);
  }
  showScoring(false);
  if (SH.phase !== "count") { try { SH.stream.getTracks().forEach((t) => t.stop()); } catch {} return; }

  const mimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const mime = mimes.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
  SH.chunks = [];
  try {
    SH.rec = new MediaRecorder(SH.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    closeWave();
    return toast("녹음을 시작할 수 없습니다", 3600);
  }
  SH.rec.ondataavailable = (e) => { if (e.data.size) SH.chunks.push(e.data); };
  SH.rec.onstop = onTakeStop;

  const ctx = SH.actx || (SH.actx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === "suspended") ctx.resume();
  SH.an = ctx.createAnalyser();
  SH.an.fftSize = 1024;
  ctx.createMediaStreamSource(SH.stream).connect(SH.an);
  SH.buf = new Float32Array(SH.an.fftSize);

  SH.phase = "take";
  SH.startAt = performance.now();
  SH.user = [];
  SH.playT = 0;
  SH.rec.start();

  waveState("녹음", "rec");
  stopOriginal();
  pausePlayer();

  cancelAnimationFrame(SH.raf);
  const loop = () => {
    if (SH.phase !== "take") return;
    const el = (performance.now() - SH.startAt) / 1000;
    const target = Math.min(SH.dur, el);
    SH.playT = SH.playT + (target - SH.playT) * 0.55;   // 지수 보간으로 떨림 제거

    if (SH.an && SH.buf) {
      SH.an.getFloatTimeDomainData(SH.buf);
      let sum = 0;
      for (let i = 0; i < SH.buf.length; i++) sum += SH.buf[i] * SH.buf[i];
      const rms = Math.sqrt(sum / SH.buf.length);
      // 고정 시간 버킷: 화면 주사율(60/120/144Hz)과 무관하게 폭 전체가 유지된다.
      // 예전엔 900개를 넘으면 앞을 shift 해서 파형 앞부분이 사라졌다.
      const amp = Math.min(1, rms * 7.5);
      const bw = SH.dur / 320;
      const last = SH.user[SH.user.length - 1];
      if (last && Math.floor(last.t / bw) === Math.floor(Math.min(SH.dur, el) / bw)) {
        if (amp > last.a) last.a = amp;
      } else {
        SH.user.push({ t: Math.min(SH.dur, el), a: amp });
      }
    }

    drawWave();
    $("#wv-time").textContent = `${SH.playT.toFixed(1)}s / ${SH.dur.toFixed(1)}s`;
    if (el >= SH.dur + 0.15) { stopTake(); return; }
    SH.raf = requestAnimationFrame(loop);
  };
  loop();
}

function stopTake() {
  if (SH.phase !== "take") return;
  SH.phase = "scoring";
  cancelAnimationFrame(SH.raf);
  stopOriginal();
  pausePlayer();
  try { if (SH.rec && SH.rec.state === "recording") SH.rec.stop(); } catch {}
  waveState("채점", "score");
  drawWave();
}

function onTakeStop() {
  const mime = SH.chunks[0]?.type || "audio/webm";
  S.takeBlob = new Blob(SH.chunks, { type: mime });
  if (S.takeUrl) URL.revokeObjectURL(S.takeUrl);
  S.takeUrl = S.takeBlob.size ? URL.createObjectURL(S.takeBlob) : null;
  try { if (SH.stream) SH.stream.getTracks().forEach((t) => t.stop()); } catch {}
  SH.stream = null;
  if (!S.takeBlob || S.takeBlob.size < 1000) {
    SH.phase = "done";
    waveState("다시", "done");
    return;
  }
  submitScore();
}

async function submitScore() {
  const fd = new FormData();
  fd.append("take", S.takeBlob, "take.webm");
  showScoring(true, 120000);
  try {
    const r = await api(`/api/videos/${S.cur.id}/segments/${S.idx}/score`, { method: "POST", body: fd });
    SH.__retry = 0;
    showScoring(false);
    S.lastResult = r;
    SH.phase = "done";
    SH.score = Math.round(r.total);
    SH.playT = SH.dur;
    waveState("완료", "done");
    const sc = $("#wv-score");
    sc.textContent = `${SH.score}점`;
    sc.className = "wv-score " + (r.total >= 70 ? "good" : "low");
    drawWave();

    renderResult(r);
    show("s-result");
    loadHome();
  } catch (e) {
    showScoring(false);
    if (!SH.__retry) {
      SH.__retry = 1;
      waveState("다시 채점", "score");
      toast("채점 응답이 늦어 한 번 더 시도합니다", 2400);
      return submitScore();
    }
    SH.__retry = 0;
    SH.phase = "done";
    waveState("오류 · 다시 눌러 재시도", "done");
    toast("채점에 실패했습니다: " + e.message, 5200);
    closeWave();
  }
}

/* ---------------- 학습 완료 검증 (3단계) ---------------- */
function startVerify() {
  if (!S.cur) return;
  if (!S.cur.segs || !S.cur.segs.length) return toast("문장이 없습니다");
  if (SH.phase !== "idle") closeWave(true);
  $("#sheet-script").hidden = true;
  VF.on = false;
  VF.stage = "recall";
  VF.typed = {}; VF.n = S.cur.segs.length;
  document.body.classList.add("vf-focus");
  stopTick(); pausePlayer();
  show("s-verify");
  renderVerify();
}

function exitVerify(ask) {
  const segs = (S.cur && S.cur.segs) || [];
  const done = segs.filter((s, i) => String(VF.typed[i] || "").trim()).length;
  if (ask && done > 0 &&
      !confirm(`작성한 답변 ${done}개가 사라집니다.\n\n백지 테스트를 나갈까요?`)) return;
  VF.on = false;
  VF.typed = {}; VF.stage = "recall";
  document.body.classList.remove("vf-focus");
  show("s-play"); startTick();
}

/* 1단계 끝 → 2단계 */
function renderVerify() {
  if (VF.stage === "recall") return renderRecall();
  if (VF.stage === "done") return renderVerifyResult();
}

/* 2단계: 백지 테스트 */
function renderRecall() {
  const segs = S.cur.segs;
  $("#vf-body").innerHTML = `
    <p class="test-desc"><b>${PASS_SCORE}점 이상 통과</b></p>
    ${segs.map((s, i) => `
      <div class="vf-row" data-i="${i}">
        <div class="vf-ko"><b>${i + 1}</b><span>${esc(s.ko || "(한국어 없음 · 영어만)")}</span></div>
        <textarea class="vf-in" data-i="${i}" rows="1" spellcheck="false" autocapitalize="off"
          placeholder="${s.ko ? "영어로 옮겨 적기" : esc((s.en || "").slice(0, 1)) + "…"}"></textarea>
      </div>`).join("")}
    <div class="vf-pad"></div>`;
  $$("#vf-body .vf-in").forEach((el) => {
    el.value = VF.typed[el.dataset.i] || "";
    const fit = () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
    el.oninput = () => { VF.typed[el.dataset.i] = el.value; fit(); updateVfCount(); };
    fit();
  });
  updateVfCount();
  const first = $("#vf-body .vf-in");
  if (first) first.focus();
}

function updateVfCount() {
  const segs = (S.cur && S.cur.segs) || [];
  const done = segs.filter((s, i) => String(VF.typed[i] || "").trim()).length;
  const foot = $("#vf-foot");
  if (foot) foot.hidden = VF.stage !== "recall";
  const b = $("#vf-submit");
  if (b) {
    b.disabled = false;              // 이전 채점에서 잠긴 상태를 반드시 푼다
    b.textContent = `채점하기 (${done}/${segs.length} 작성됨)`;
  }
}

async function submitRecall() {
  const segs = (S.cur && S.cur.segs) || [];
  const empty = segs.filter((s, i) => !String(VF.typed[i] || "").trim()).length;
  if (empty && !confirm(`아직 쓰지 않은 문장이 ${empty}개 있습니다.\n\n이대로 채점할까요?`)) return;
  await submitVerify();
}

/* 3단계: 무작위 스팟 체크 */
const PASS_SCORE = 90;   // verify.py 의 PASS_SCORE 와 같은 값

async function submitVerify() {
  const b = $("#vf-submit");
  const label = b ? b.textContent : "";
  if (b) { b.disabled = true; b.textContent = "채점 중…"; }
  try {
    const r = await jsonPost(`/api/videos/${S.cur.id}/verify/check`, {
      typed: VF.typed,
    });
    VF.result = r;
    VF.stage = "done";
    await refreshCur();
    await loadHome();
    await loadVideos();
    renderVerify();
  } catch (e) {
    if (b) { b.disabled = false; b.textContent = label || "채점하기"; }
    toast("채점 실패: " + e.message, 4200);
  }
}

function playResultSeg(i) {
  const seg = (S.cur && S.cur.segs) || [];
  const s = seg[i];
  if (!s) return;
  if (!S.player || !S.ready) return toast("플레이어 준비 중입니다");
  try { S.player.seekTo(s.start, true); S.player.playVideo(); } catch {}
  clearInterval(window.__vrStop);
  window.__vrStop = setInterval(() => {
    let t = 0;
    try { t = S.player.getCurrentTime() || 0; } catch { return; }
    if (t >= (s.end || s.start + 1)) { try { S.player.pauseVideo(); } catch {} clearInterval(window.__vrStop); }
  }, 120);
}

/* 서버 응답이 구버전(tokens)이어도 화면이 비지 않도록 정규화한다. */
function rowLines(x) {
  if (Array.isArray(x.mine) && Array.isArray(x.ans) && (x.mine.length || x.ans.length)) {
    return { mine: x.mine, ans: x.ans };
  }
  const toks = Array.isArray(x.tokens) ? x.tokens : [];
  const words = String(x.answer || "").match(/[A-Za-z0-9']+[.,!?;:]*/g) || [];
  const mine = toks.filter(([k]) => k !== "miss").map(([k, w]) => [k === "ok" ? "ok" : k, w]);
  const ans = toks.length
    ? toks.filter(([k]) => k !== "extra").map(([k, w]) => (k === "ok" ? ["ok", w] : ["miss", w]))
    : words.map((w) => ["ok", w]);
  return { mine, ans };
}

function lineHtml(tokens, side) {
  if (!tokens || !tokens.length) return `<span class="vr-none">작성하지 않음</span>`;
  return tokens.map(([k, w]) => {
    const e = esc(w);
    if (side === "mine") {
      const bad = (k === "wrong" || k === "extra") ? " tk-bad" : "";
      return `<span class="tk${bad}">${e}</span>`;
    }
    const hi = (k === "ok") ? "" : " tk-hi";
    return `<span class="tk${hi}">${e}</span>`;
  }).join(" ");
}

function renderVerifyResult() {
  const r = VF.result || {};
  const rc = (r.stages || {}).recall || {};
  const rows = rc.rows || [];
  const score = Math.round(r.score || 0);
  $("#vf-body").innerHTML = `
    <div class="vr-hero ${r.passed ? "ok" : "no"}">
      <div class="vr-num">${score}<small>점</small></div>
      <div class="vr-txt">
        <b>${r.passed ? "통과했습니다" : "다시 도전해보세요"}</b>
        <em>${r.passed ? "모든 문장을 확인하세요" : `${rc.need || 90}점 이상이면 통과입니다`}</em>
      </div>
    </div>
    <div class="vr-segs">
      ${rows.map((row) => { const x = row, ln = rowLines(row); return `
        <div class="vr-seg${x.lost ? "" : " done"}">
          <div class="vr-top">
            <span class="vr-i">${x.i + 1}</span>
            ${x.lost ? `<span class="vr-lost">-${x.lost}</span>` : ""}
            <button class="vr-spk" data-i="${x.i}" aria-label="발음 듣기">
              <svg class="ic"><use href="#i-sound"/></svg>
            </button>
          </div>
          <p class="vr-mine">${lineHtml(ln.mine.length ? ln.mine : ln.ans, "mine")}</p>
          ${x.lost ? `<p class="vr-ans"><span class="vr-lab">정답</span>${lineHtml(ln.ans, "ans")}</p>` : ""}
        </div>`; }).join("")}
    </div>
    <div class="actions">
      <button class="btn primary" id="vf-again">다시 테스트</button>
      <button class="btn ghost" id="vf-close">학습으로 돌아가기</button>
    </div>`;
  const foot = $("#vf-foot");
  if (foot) foot.hidden = true;
  $$("#vf-body .vr-spk").forEach((b) => {
    b.onclick = () => playResultSeg(+b.dataset.i);
  });
  $("#vf-again").onclick = () => { clearInterval(window.__vrStop); startVerify(); };
  $("#vf-close").onclick = () => { clearInterval(window.__vrStop); exitVerify(false); };
}

/* ================= 결과 ================= */
function encodeWav16(x, sr) {
  const len = x.length;
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, len * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, x[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

function takeFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const vid = (S.cur && S.cur.id) || "video";
  const idx = S.idx + 1;
  const seg = (S.cur && S.cur.segs && S.cur.segs[S.idx]) || {};
  const a = seg.start != null ? Number(seg.start).toFixed(1) : "0";
  const b = seg.end != null ? Number(seg.end).toFixed(1) : "0";
  return `langclip_${vid}_s${String(idx).padStart(2, "0")}_${a}-${b}s_${stamp}.wav`;
}

async function saveTake() {
  const btn = $("#dl-take");
  if (!S.takeBlob || !S.takeBlob.size) return toast("저장할 녹음이 없습니다");
  if (btn) btn.disabled = true;
  try {
    const ctx = SH.actx || (SH.actx = new (window.AudioContext || window.webkitAudioContext)());
    const buf = await ctx.decodeAudioData(await S.takeBlob.arrayBuffer());
    const ch = buf.numberOfChannels;
    const mix = new Float32Array(buf.length);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) mix[i] += d[i] / ch;
    }
    const mono = ctx.createBuffer(1, mix.length, buf.sampleRate);
    mono.copyToChannel(mix, 0);
    const SR16 = 16000;
    const frames = Math.max(1, Math.ceil(mix.length * SR16 / buf.sampleRate));
    const off = new OfflineAudioContext(1, frames, SR16);
    const src = off.createBufferSource();
    src.buffer = mono; src.connect(off.destination); src.start();
    const out = await off.startRendering();
    const blob = encodeWav16(out.getChannelData(0), SR16);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = takeFileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    const hint = $("#dl-hint");
    if (hint) hint.textContent = `${(blob.size / 1024).toFixed(0)}KB 저장됨`;
    toast("내 목소리를 WAV로 저장했습니다", 2600);
  } catch (e) {
    toast("저장 실패: " + (e && e.message ? e.message : e), 4000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderResult(r) {
  const total = Math.round(r.total);
  $("#axis-card").style.display = "";
  $("#listen-card").style.display = "";

  $("#total").textContent = total;
  $("#ring").style.setProperty("--p", Math.max(0, Math.min(100, r.total)));
  $("#res-text").textContent = r.text || "";
  $("#res-ko").textContent = r.ko || "";
  const s = S.cur ? S.cur.segs[S.idx] : null;
  $("#res-time").textContent = s ? `${fmt(s.start)}–${fmt(s.end)}s` : "";

  const acoustic = r.mode === "acoustic";
  const vals = { pitch: r.pitch ?? null, rhythm: r.rhythm ?? null, timbre: r.timbre ?? null, attack: r.attack ?? null };
  $$(".axis").forEach((el) => {
    const v = vals[el.dataset.k];
    const off = v === null || v === undefined;
    el.style.display = off ? "none" : "flex";
    if (off) return;
    el.querySelector("i").style.width = Math.max(0, Math.min(100, v)) + "%";
    el.querySelector(".ax-val").textContent = Math.round(v);
    el.classList.toggle("low", v < 55);
  });

  const note = $("#mode-note");
  note.classList.remove("show");
  note.innerHTML = "";

  $("#grade").textContent = "";
  $("#verdict").textContent = "";
  $("#coach").innerHTML = "";

  MIX.peaks = {};
  $("#mix-hint").textContent = (S.cur && S.cur.audio) ? "원본 음성 연결됨" : "영상 구간으로 재생";
  initMixUI();
  const dl = $("#dl-take");
  if (dl) {
    dl.disabled = !(S.takeBlob && S.takeBlob.size);
    dl.onclick = saveTake;
  }
  
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
      ["피치", r.pitch ?? 0, "높낮이가 어긋났습니다. 원본의 멜로디를 손으로 그리듯 따라 해보세요."],
      ["리듬", r.rhythm ?? 0, "속도가 다릅니다. 원본 문장 길이에 맞춰 끝을 맞추는 연습을 해보세요."],
      ["음색", r.timbre ?? 0, "음색이 다릅니다. 입 모양과 공명 위치를 원본 화자와 같게 만들어보세요."],
      ["어택", r.attack ?? 0, "소리의 시작이 다릅니다. 첫 음을 더 또렷하게 터뜨려보세요."],
    ];
    p.sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([k, v, m]) => { if (v < 85) tips.push([k, m]); });
  } else {
    const raw = r.raw || {};
    if ((raw.ratio ?? 1) > 1.25) tips.push(["길이", "원본보다 길게 말했습니다. 한 호흡에 이어 말해보세요."]);
    else if ((raw.ratio ?? 1) < 0.8) tips.push(["길이", "원본보다 짧습니다. 문장 끝까지 소리를 유지해보세요."]);
    else tips.push(["길이", "속도는 잘 맞았습니다. 파형의 봉우리 위치를 비교해보세요."]);
  }
  if (!tips.length) tips.push(["완료", "모든 항목이 훌륭합니다. 반복 횟수를 늘려 완전히 익혀보세요."]);
  return `<h4>코칭</h4><ul>${tips.map(([k, m]) => `<li><b>${k}</b> · ${m}</li>`).join("")}</ul>`;
}

/* ---- 다시 듣기: 파형 3줄 ---- */
const MIX = { playing: "", raf: 0, t0: 0, dur: 1, audios: [], peaks: {} };

function mixCanvas(k) { return $(`.mix-cv[data-k="${k}"]`); }

function sizeMixCanvas(cv) {
  if (!cv) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (!w || !h) return;
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
}

function drawMixRow(k, prog) {
  const cv = mixCanvas(k);
  if (!cv || !cv.width) return;
  const g = cv.getContext("2d");
  const w = cv.width, h = cv.height, dpr = w / Math.max(1, cv.clientWidth);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(11,21,36,.94)";
  g.beginPath();
  const r = 6 * dpr;
  g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r);
  g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();

  const mid = h / 2, half = h * 0.38;
  const ref = SH.ref, me = MIX.peaks[k] || MIX.peaks.me || new Float32Array(0);

  const drawWave = (arr, color, stroke, alpha) => {
    if (!arr || arr.length < 2) return;
    const N = arr.length;
    g.beginPath();
    for (let i = 0; i < N; i++) g.lineTo((i / (N - 1)) * w, mid - arr[i] * half);
    for (let i = N - 1; i >= 0; i--) g.lineTo((i / (N - 1)) * w, mid + arr[i] * half);
    g.closePath();
    g.fillStyle = color;
    g.globalAlpha = alpha;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = stroke;
    g.lineWidth = Math.max(1, dpr);
    g.stroke();
  };

  if (k === "ref") drawWave(ref, "rgba(139,124,246,.55)", "rgba(196,187,255,.95)", 1);
  else if (k === "me") drawWave(me, "rgba(255,45,149,.5)", "#FF6FBF", 1);
  else {
    drawWave(ref, "rgba(139,124,246,.38)", "rgba(196,187,255,.75)", 1);
    drawWave(me, "rgba(255,45,149,.34)", "#FF6FBF", 1);
  }

  if (prog > 0) {
    const x = Math.min(1, prog) * w;
    g.strokeStyle = "#FF3B5C";
    g.lineWidth = Math.max(1.5, dpr * 1.5);
    g.shadowColor = "#FF3B5C"; g.shadowBlur = 8 * dpr;
    g.beginPath(); g.moveTo(x, 2 * dpr); g.lineTo(x, h - 2 * dpr); g.stroke();
    g.shadowBlur = 0;
  }
}

function drawAllMix(prog) {
  ["ref", "me", "both"].forEach((k) => drawMixRow(k, prog));
}

async function peaksFor(kind) {
  if (MIX.peaks[kind]) return MIX.peaks[kind];
  if (kind === "me" && S.takeBlob) {
    try {
      const ctx = SH.actx || (SH.actx = new (window.AudioContext || window.webkitAudioContext)());
      const buf = await ctx.decodeAudioData(await S.takeBlob.arrayBuffer());
      const N = 260, out = new Float32Array(N), ch = buf.getChannelData(0);
      const step = Math.max(1, Math.floor(ch.length / N));
      let peak = 0;
      for (let i = 0; i < N; i++) {
        let m = 0;
        for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j++) {
          const v = Math.abs(ch[j]); if (v > m) m = v;
        }
        out[i] = m; if (m > peak) peak = m;
      }
      if (peak > 0) for (let i = 0; i < N; i++) out[i] /= peak;
      MIX.peaks.me = out;
    } catch {
      const N = 260, out = new Float32Array(N);
      const us = SH.user || [];
      us.forEach((u) => {
        const i = Math.min(N - 1, Math.max(0, Math.round((u.t / SH.dur) * (N - 1))));
        out[i] = Math.max(out[i], u.a);
      });
      MIX.peaks.me = out;
    }
  }
  return MIX.peaks[kind] || MIX.peaks.me || new Float32Array(0);
}

function stopMix() {
  cancelAnimationFrame(MIX.raf);
  (MIX.audios || []).forEach((a) => { try { a.pause(); } catch {} });
  MIX.audios = [];
  pausePlayer();
  MIX.playing = "";
  $$(".mix-play").forEach((b) => { b.classList.remove("on"); b.innerHTML = ic("i-play", "ic xs"); });
  drawAllMix(0);
  $$(".mix-t").forEach((t) => (t.textContent = "0.0s"));
}

async function playMix(kind) {
  if (MIX.playing === kind) return stopMix();
  stopMix();
  if (!S.cur || !S.seg) return;
  const seg = S.seg;
  const dur = Math.max(0.4, seg.end - seg.start);
  MIX.playing = kind; MIX.dur = dur; MIX.t0 = performance.now();
  const btn = $(`.mix-play[data-k="${kind}"]`);
  if (btn) { btn.classList.add("on"); btn.innerHTML = ic("i-pause", "ic xs"); }

  await peaksFor("me");
  if (kind !== "me") {
    const au = S.cur.audio;
    if (au && au.url) {
      const a = new Audio(au.url);
      try { a.currentTime = Math.max(0, seg.start - Number(au.offset || 0)); } catch {}
      a.play().catch(() => {});
      MIX.audios.push(a);
    } else if (S.player && S.ready) {
      try { S.player.seekTo(seg.start, true); S.player.playVideo(); } catch {}
    }
  }
  if (kind !== "ref" && S.takeUrl) {
    const b = new Audio(S.takeUrl);
    b.play().catch(() => {});
    MIX.audios.push(b);
  }

  cancelAnimationFrame(MIX.raf);
  const loop = () => {
    if (!MIX.playing) return;
    const el = (performance.now() - MIX.t0) / 1000;
    const p = Math.min(1, el / dur);
    drawAllMix(p);
    const t = $(`.mix-t[data-k="${kind}"]`);
    if (t) t.textContent = `${Math.min(dur, el).toFixed(1)}s`;
    if (el >= dur + 0.25) { stopMix(); return; }
    MIX.raf = requestAnimationFrame(loop);
  };
  loop();
}

function initMixUI() {
  $$(".mix-play").forEach((b) => { b.onclick = () => playMix(b.dataset.k); });
  requestAnimationFrame(() => {
    $$(".mix-cv").forEach(sizeMixCanvas);
    peaksFor("me").then(() => drawAllMix(0));
  });
}

/* ================= 단어 ================= */
/* ---------- 단어 팝업 (작은 검은 박스) ---------- */
const WP = { word: "", ctx: "", ko: "", saved: false, seq: 0 };

function paintWordStar(on) {
  const b = $("#wp-book");
  if (!b) return;
  b.innerHTML = ic(on ? "i-star-fill" : "i-star");
  b.classList.toggle("on", !!on);
  b.setAttribute("aria-pressed", on ? "true" : "false");
}

async function openWord(word, ctx) {
  if (!word) return;
  if (!$("#s-play").classList.contains("is-active")) return;
  if (performance.now() < S.lockUntil) return;
  if (SH.phase !== "idle") return;
  const pop = $("#word-pop"); if (!pop) return;
  if (!pop.hidden && WP.word === word) return;
  const seq = ++WP.seq;
  S.word = { word, ctx };
  WP.word = word; WP.ctx = ctx || ""; WP.ko = ""; WP.saved = false;
  $("#wp-word").textContent = word;
  $("#wp-ko").textContent = "…";
  paintWordStar(false);
  pop.hidden = false;
  try {
    const r = await api("/api/words/" + encodeURIComponent(word));
    if (seq !== WP.seq) return;
    const d = (r.definitions || [])[0];
    WP.ko = (r.saved && r.saved.meaning) ? r.saved.meaning : (r.ko || (d ? d.def : ""));
    WP.saved = !!r.saved;
    paintWordStar(WP.saved);
    $("#wp-ko").textContent = WP.ko || "뜻을 찾지 못했어요";
    $("#wp-book").classList.toggle("on", !!WP.saved);
  } catch {
    if (seq !== WP.seq) return;
    $("#wp-ko").textContent = "뜻을 불러오지 못했어요";
  }
}

function closeWord() {
  const pop = $("#word-pop");
  if (pop) pop.hidden = true;
}

async function toggleWordStar() {
  if (!WP.word) return;
  try {
    const r = await jsonPost("/api/notes/word", {
      word: WP.word, meaning: WP.ko, ctx: WP.ctx, vid: S.cur?.id || "", idx: S.idx,
      toggle_only: true,
    });
    WP.saved = !!r.bookmarked;
    paintWordStar(WP.saved);
    await reloadNotes();
    toast(r.bookmarked ? "북마크에 담았습니다" : "북마크에서 뺐습니다");
  } catch (e) { toast("실패: " + e.message, 3800); }
}

async function openDict() {
  const word = WP.word;
  if (!word) return;
  const ctx = WP.ctx;
  closeWord();
  $("#w-word").textContent = word;
  $("#w-phon").textContent = "";
  $("#w-ctx").textContent = ctx || "";
  $("#w-defs").innerHTML = `<div class="word-def" style="opacity:.6">불러오는 중…</div>`;
  $("#w-meaning").value = "";
  $("#w-book").textContent = "단어에 담기";
  $("#sheet-dict").hidden = false;
  try {
    const r = await api("/api/words/" + encodeURIComponent(word));
    $("#w-phon").textContent = r.phonetic || "";
    if (r.saved && r.saved.meaning) $("#w-meaning").value = r.saved.meaning;
    const defs = (r.definitions || []).map((d) => `
      <div class="word-def"><i>${esc(d.pos || "")}</i>${esc(d.def)}
        ${d.example ? `<em>${esc(d.example)}</em>` : ""}</div>`).join("");
    const koh = r.ko ? `<div class="word-ko"><b>${esc(r.ko)}</b>${(r.ko_defs || []).map((x) => `<em>${esc(x.ko)}</em>`).join("")}</div>` : "";
    $("#w-defs").innerHTML = koh + (defs || `<div class="word-def" style="opacity:.75">사전에 없는 단어예요. 내 뜻을 직접 적어둘 수 있어요.</div>`);
    $("#w-book").textContent = r.saved ? "단어에서 빼기" : "단어에 담기";
  } catch {
    $("#w-defs").innerHTML = `<div class="word-def" style="opacity:.75">사전을 불러오지 못했어요. 내 뜻을 직접 적어둘 수 있어요.</div>`;
  }
}

/* ================= 대본 ================= */
const SCR = { q: "", vid: "", edit: false };
const AUD = { v: null };   // 원본 음성 작업 대상 영상
const SCRC = {};

async function scrVideo(id) {
  if (!id) return null;
  if (SCRC[id]) return SCRC[id];
  try { SCRC[id] = await api("/api/videos/" + id); } catch { SCRC[id] = null; }
  return SCRC[id];
}

async function loadScripts() {
  if (!S.videos || !S.videos.length) { try { await loadVideos(); } catch {} }
  const ids = (S.videos || []).map((x) => x.id);
  if (SCR.vid && ids.indexOf(SCR.vid) < 0) { delete SCRC[SCR.vid]; SCR.vid = ""; }
  if (!SCR.vid) SCR.vid = S.cur?.id || (S.videos[0] && S.videos[0].id) || "";
  renderPick();
  await renderScript();
}

function renderPick() {
  const box = $("#scr-pick");
  if (!box) return;
  const list = S.videos || [];
  box.innerHTML = list.map((v) =>
    `<button class="scr-chip${v.id === SCR.vid ? " on" : ""}" data-vid="${esc(v.id)}">${esc(v.title || "제목 없음")}</button>`
  ).join("");
  $$("#scr-pick .scr-chip").forEach((b) => {
    b.onclick = () => { SCR.vid = b.dataset.vid; renderPick(); renderScript(); };
  });
}

async function renderScript() {
  const box = $("#scr-body");
  if (!box) return;
  if (!SCR.vid) { box.innerHTML = `<div class="scr-empty">영상이 없습니다</div>`; return; }
  const v = await scrVideo(SCR.vid);
  if (!v) { box.innerHTML = `<div class="scr-empty">대본을 불러오지 못했습니다</div>`; return; }
  if (SCR.vid !== v.id) return;
  const eb = $("#scr-edit");
  if (eb) {
    eb.hidden = !S.admin;
    eb.textContent = SCR.edit ? "보기" : "편집";
    eb.classList.toggle("on", SCR.edit);
  }
  if (SCR.edit && S.admin) return renderScriptEdit(v);
  const q = (SCR.q || "").trim().toLowerCase();
  const segs = (v.segs || []).map((s, i) => ({ s, i })).filter(({ s }) => {
    if (!q) return true;
    return ((s.en || s.text || "") + " " + (s.ko || "")).toLowerCase().indexOf(q) >= 0;
  });
  if (!segs.length) { box.innerHTML = `<div class="scr-empty">검색 결과가 없습니다</div>`; return; }
  box.innerHTML = `<div class="scr-vt">${esc(v.title || "")} · ${segs.length}문장</div>` + segs.map(({ s, i }) => `
    <button class="scr-seg" data-i="${i}">
      <div class="en"><span class="n">${i + 1}</span>${esc(s.en || s.text || "")}</div>
      ${s.ko ? `<div class="ko">${esc(s.ko)}</div>` : ""}
    </button>`).join("");
  $$("#scr-body .scr-seg").forEach((b) => {
    b.onclick = () => playSegAudio(SCR.vid, +b.dataset.i);
  });
  auMark();
}

function renderScriptEdit(v) {
  const box = $("#scr-body");
  const segs = v.segs || [];
  box.innerHTML = `<div class="scr-vt">${esc(v.title || "")} · ${segs.length}문장 편집</div>` +
    segs.map((s, i) => `
      <div class="ed-row" data-i="${i}">
        <div class="ed-head"><b>${i + 1}</b>
          <span class="ed-time">
            <input class="ed-st" type="number" step="0.1" min="0" value="${Number(s.start || 0).toFixed(2)}" />
            <i>–</i>
            <input class="ed-en2" type="number" step="0.1" min="0" value="${Number(s.end || 0).toFixed(2)}" />
            <i>s</i>
          </span>
        </div>
        <input class="ed-en" value="${esc(s.en || s.text || "")}" placeholder="영어 문장" />
        <input class="ed-ko" value="${esc(s.ko || "")}" placeholder="한국어 뜻 (없어도 됨)" />
      </div>`).join("") +
    `<div class="ed-actions">
      <button class="btn primary" id="scr-save">저장</button>
      <button class="btn ghost" id="scr-cancel">취소</button>
    </div>`;
  $("#scr-save").onclick = () => saveScriptEdit(v);
  $("#scr-cancel").onclick = () => { SCR.edit = false; SCR.q = ""; renderScript(); };
}

async function saveScriptEdit(v) {
  const rows = $$("#scr-body .ed-row");
  const segs = rows.map((r, i) => ({
    i,
    en: r.querySelector(".ed-en").value.trim(),
    ko: r.querySelector(".ed-ko").value.trim(),
    start: Number(r.querySelector(".ed-st").value) || 0,
    end: Number(r.querySelector(".ed-en2").value) || 0,
  }));
  const bad = segs.find((s) => s.end <= s.start);
  if (bad) return toast(`${bad.i + 1}번 문장의 종료 시간이 시작보다 빠릅니다`, 4200);
  const b = $("#scr-save");
  if (b) { b.disabled = true; b.textContent = "저장 중…"; }
  try {
    const r = await api(`/api/videos/${v.id}/segs`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segs }),
    });
    delete SCRC[v.id];
    const i = S.videos.findIndex((x) => x.id === v.id);
    if (i >= 0) S.videos[i] = { ...S.videos[i], segs: r.segs, n: r.n };
    if (S.cur && S.cur.id === v.id) { Object.assign(S.cur, { segs: r.segs, n: r.n }); }
    SCR.edit = false;
    toast(`대본을 저장했습니다 · ${r.n}문장`, 3000);
    renderScript();
  } catch (e) {
    if (b) { b.disabled = false; b.textContent = "저장"; }
    toast("저장 실패: " + e.message, 4600);
  }
}

async function saveWordMeaning() {
  if (!S.word) return;
  const meaning = $("#w-meaning").value.trim();
  if (!meaning) return toast("뜻을 입력해주세요");
  try {
    await jsonPost("/api/notes/word", { word: S.word.word, meaning, ctx: S.word.ctx, vid: S.cur?.id || "", idx: S.idx });
    await reloadNotes();
    $("#sheet-dict").hidden = true;
    toast("단어에 저장했습니다");
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
    $("#w-book").textContent = r.bookmarked ? "단어에서 빼기" : "단어에 담기";
    toast(r.bookmarked ? "단어에 담았습니다" : "단어에서 뺐습니다");
  } catch (e) { toast("실패: " + e.message, 3800); }
}

async function reloadNotes() {
  try { S.notes = await api("/api/notes"); } catch {}
  renderNotesScreen();
  setCount("note-count", (S.notes.sentences || []).length);
}

/* ================= 추가(+) · 제목 자동 ================= */
let titleTimer = 0;
let titleAuto = "";
function openAdd() {
  if (!S.admin) return toast("이 영상은 관리자가 등록합니다", 3000);
  $("#sheet-add").hidden = false;
  if (!$("#sy-url").value.trim()) setTimeout(() => $("#sy-url").focus(), 80);
}

async function fetchTitle() {
  const url = $("#sy-url").value.trim();
  const state = $("#sy-title-state");
  if (!url) return;
  const titleEl = $("#sy-title");
  state.textContent = "불러오는 중…";
  try {
    const r = await api("/api/yt/meta?url=" + encodeURIComponent(url));
    if (r && r.title) {
      titleAuto = r.title;
      if (!titleEl.value.trim() || titleEl.value === titleAuto) titleEl.value = r.title;
      state.textContent = r.author ? `· ${r.author}` : "";
      if (r.id) titleEl.dataset.yt = r.id;
    } else {
      state.textContent = "· 제목을 직접 입력하세요";
    }
  } catch {
    state.textContent = "· 제목을 직접 입력하세요";
  }
}

function onUrlInput() {
  clearTimeout(titleTimer);
  const url = $("#sy-url").value.trim();
  if (url.length < 12) return;
  titleTimer = setTimeout(fetchTitle, 700);
}

async function startSyncFromAdd() {
  const url = $("#sy-url").value.trim();
  const title = $("#sy-title").value.trim();
  const text = $("#sy-text").value;
  if (!url) return toast("쇼츠 주소를 입력해주세요");
  if (!text.trim()) return toast("대본을 붙여넣어 주세요");
  $("#sheet-add").hidden = true;
  if (!window.LangclipSync) return toast("싱크 모듈을 불러오지 못했습니다");
  await window.LangclipSync.start({ url, title, text });
}

/* ================= 이벤트 ================= */
function bind() {
  $$(".tab[data-tab]").forEach((t) => { t.onclick = () => show(t.dataset.tab); });
  $("#tab-add").onclick = openAdd;
  $$("[data-close]").forEach((el) => (el.onclick = () => { el.closest(".sheet-wrap").hidden = true; }));

  $("#btn-sync-start").onclick = startSyncFromAdd;
  $("#sy-url").addEventListener("input", onUrlInput);
  $("#sy-url").addEventListener("blur", fetchTitle);
  $("#sy-url").addEventListener("paste", () => setTimeout(onUrlInput, 60));

  $("#btn-start").onclick = () => {
    const f = S.progress && S.progress.focus;
    if (!f) return;
    jumpTo(f.id, 0);
  };
  $("#note-more").onclick = () => show("s-notes");
  $("#wp-book").onclick = toggleWordStar;
  $("#wp-more").onclick = openDict;
  $("#scr-q").oninput = () => { SCR.q = $("#scr-q").value; renderScript(); };
  const se = $("#scr-edit");
  if (se) se.onclick = () => {
    if (!S.admin) return;
    SCR.edit = !SCR.edit;
    renderScript();
  };
  document.addEventListener("pointerdown", (e) => {
    const pop = $("#word-pop");
    if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#sub-en .w")) return;
    closeWord();
  }, true);

  $("#btn-back").onclick = () => {
    if (SH.phase !== "idle") {
      closeWave();
      toast("쉐도잉을 취소했습니다");
      return;
    }
    pausePlayer(); stopTick(); show("s-home");
  };
  $("#btn-play").onclick = togglePlay;
  const vtap = $("#vtap");
  if (vtap) vtap.onclick = () => { if (SH.phase === "idle") togglePlay(); };
  $("#btn-prev").onclick = () => step(-1);
  $("#btn-next-seg").onclick = () => step(1);
  $("#btn-sub").onclick = cycleSub;
  $("#btn-repeat").onclick = toggleRepeat;
  $("#btn-star").onclick = toggleStar;
  $("#btn-shadow").onclick = onShadowBtn;
  $("#wv-skip").onclick = endListen;

  $("#btn-retry").onclick = () => {
    stopMix();
    closeWave(true);
    show("s-play");
    startTick();
    selectSeg(S.idx, true);
    SH.skipListen = true;
    setTimeout(() => startShadow(), 180);
  };
  $("#btn-result-close").onclick = () => { stopMix(); closeWave(true); show("s-play"); startTick(); };
  $("#wv-cancel").onclick = cancelShadow;
  $("#btn-verify-close").onclick = () => exitVerify(true);
  const vfs = $("#vf-submit");
  if (vfs) vfs.onclick = submitRecall;


  const bAsv = $("#au-save");
  if (bAsv) bAsv.onclick = saveAudio;

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

/* ================= 추가 화면: 원본 음성 ================= */
function resetAddAudio() {
  const on = $("#ad-audio-on"); if (on) on.checked = false;
  const body = $("#ad-audio-body"); if (body) body.hidden = true;
  const f = $("#ad-file"); if (f) f.value = "";
  const ok = $("#ad-ok"); if (ok) ok.checked = false;
  const off = $("#ad-offset"); if (off) off.value = "0";
}

async function attachAddAudio(vid) {
  const on = $("#ad-audio-on");
  if (!on || !on.checked || !vid) return;
  const f = $("#ad-file");
  const file = f && f.files && f.files[0];
  if (!file) throw new Error("음성 파일을 선택해주세요");
  if (!$("#ad-ok").checked) throw new Error("원본 음성 권리 확인에 체크해주세요");
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("title", (($("#sy-title") && $("#sy-title").value.trim()) || file.name).slice(0, 80));
  fd.append("offset", String(Number($("#ad-offset").value) || 0));
  fd.append("source", $("#ad-source").value);
  fd.append("license", "추가 화면에서 등록");
  const au = await api("/api/audios", { method: "POST", body: fd });
  await jsonPost(`/api/videos/${vid}/link-audio`, {
    audio_id: au.id, offset: Number($("#ad-offset").value) || 0,
  });
  resetAddAudio();
  toast("원본 음성을 연결했습니다", 3200);
}
window.attachAddAudio = attachAddAudio;

/* ================= 시작 ================= */
(async function boot() {
  try {
    const h = await api("/api/health");
    S.admin = !h.locked;
  } catch { S.admin = true; }
  if (!S.admin) {
    $("#tab-add").hidden = true;
  }
  bind();
  await loadVideos();
  await loadHome();
})();

window.loadYT = loadYT;
window.LangclipApp = {
  S, show, toast, esc, fmt, jsonPost, api, loadHome, loadVideos, openVideo,
  startTick, stopTick, sizeVideo, reloadNotes, mmss, pausePlayer, loadYT, ic,
};


/* ================= 자막 자동 크기 ================= */
function fitSub() {
  const box = $("#sub-en");
  if (!box) return;
  const plain = box.dataset.plain || "";
  const st = $("#vstage");
  const room = Math.max(140, (st ? st.clientHeight : 720) * 0.62);
  let fs = plain.length <= 24 ? 31
    : plain.length <= 40 ? 30
    : plain.length <= 60 ? 28
    : plain.length <= 90 ? 26
    : plain.length <= 130 ? 23 : 21;
  box.style.fontSize = fs + "px";
  let guard = 0;
  while (box.scrollHeight > room && fs > 17 && guard++ < 30) {
    fs -= 1;
    box.style.fontSize = fs + "px";
  }
}

/* ================= 대본 음성 재생바 ================= */
const AU = { a: null, vid: "", idx: -1, start: 0, end: 0, loop: false, on: false, url: "" };
const AU_CACHE = {};

function auInit() {
  if (AU.a) return;
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("timeupdate", auSync);
  a.addEventListener("ended", () => { if (AU.loop) { a.currentTime = AU.start; a.play().catch(() => {}); } else stopAudioBar(); });
  a.addEventListener("play", () => auBtn(true));
  a.addEventListener("pause", () => auBtn(false));
  AU.a = a;
}

function auBtn(on) {
  const b = $("#abar-play");
  if (!b) return;
  b.innerHTML = on ? ic("i-pause") : ic("i-play");
}

function auSync() {
  const a = AU.a;
  if (!a || !AU.on) return;
  const t = a.currentTime;
  if (t >= AU.end - 0.05) {
    if (AU.loop) { a.currentTime = AU.start; }
    else { stopAudioBar(); return; }
  }
  const d = Math.max(0.1, AU.end - AU.start);
  const pr = Math.min(100, Math.max(0, ((t - AU.start) / d) * 100));
  const pb = $("#abar-prog");
  if (pb) pb.style.width = pr + "%";
}

async function playSegAudio(vid, idx) {
  const v = await scrVideo(vid);
  if (!v) return toast("대본을 불러오지 못했습니다");
  const s = (v.segs || [])[idx];
  if (!s) return;
  const au = v.audio || AU_CACHE[vid];
  if (!au || !au.url) return toast("이 영상에는 등록된 음원이 없습니다", 3200);
  auInit();
  const off = Number(au.offset || 0);
  AU.vid = vid;
  AU.idx = idx;
  AU.url = au.url;
  AU.start = Math.max(0, Number(s.start || 0) - off);
  AU.end = Math.max(AU.start + 0.25, Number(s.end || 0) - off);
  AU.on = true;
  const a = AU.a;
  if (a.getAttribute("src") !== au.url) a.src = au.url;
  try { a.currentTime = AU.start; } catch {}
  const bar = $("#abar");
  if (bar) bar.hidden = false;
  document.body.classList.add("has-audio");
  $("#abar-title").textContent = v.title || "대본";
  $("#abar-sub").textContent = (idx + 1) + "문장";
  $("#abar-prog").style.width = "0%";
  const go = () => { try { a.play().catch(() => {}); } catch (e) {} };
  if (a.readyState >= 1) go(); else a.addEventListener("loadedmetadata", go, { once: true });
  setTimeout(go, 140);
}

function stopAudioBar() {
  if (AU.a) { try { AU.a.pause(); } catch {} }
  AU.on = false;
  const bar = $("#abar");
  if (bar) bar.hidden = true;
  document.body.classList.remove("has-audio");
}

function toggleSegAudio() {
  if (!AU.a || !AU.on) return;
  if (AU.a.paused) { AU.a.play().catch(() => {}); } else { AU.a.pause(); }
}

function toggleAuLoop() {
  AU.loop = !AU.loop;
  const b = $("#abar-loop");
  if (b) b.classList.toggle("on", AU.loop);
  toast(AU.loop ? "이 문장을 계속 반복합니다" : "반복을 껐습니다");
}

$("#abar-play").onclick = toggleSegAudio;
$("#abar-loop").onclick = toggleAuLoop;
$("#abar-x").onclick = stopAudioBar;
$("#wp-x").onclick = closeWord;
window.addEventListener("resize", () => { if ($("#s-play").classList.contains("is-active")) fitSub(); });


/* ================= v4.4 UI 유틸 ================= */
function setStreak(days) {
  const n = Number(days) || 0;
  const badge = $("#head-streak");
  const num = $("#head-streak-n");
  if (num) num.textContent = n + "일";
  if (badge) badge.classList.toggle("on", n > 0);
  const b = $("#streak-days");
  if (b) b.textContent = "연속 학습 " + n + "일";
  const sub = $("#streak-sub");
  if (sub) {
    if (n > 0) { sub.hidden = false; sub.textContent = n + "일째 연속 학습 중"; }
    else { sub.hidden = true; sub.textContent = ""; }
  }
}

function setCount(id, n) {
  const el = $("#" + id);
  if (!el) return;
  const v = Number(n) || 0;
  el.textContent = v;
  el.classList.toggle("zero", v === 0);
}

function showScoring(on, ms) {
  const el = $("#scoring");
  if (!el) return;
  el.hidden = !on;
  clearTimeout(window.__scT);
  if (on) window.__scT = setTimeout(() => { el.hidden = true; }, ms || 120000);
}


/* 대본 재생 중 문장 하이라이트 */
function auMark() {
  $$("#scr-body .scr-seg").forEach((b) => {
    b.classList.toggle("on", AU.on && Number(b.dataset.i) === AU.idx);
  });
  const p = $("#abar-play");
  if (p) p.classList.toggle("playing", !!(AU.a && !AU.a.paused));
}

window.auSyncOld = auSync;
auSync = function () {
  window.auSyncOld.apply(this, arguments);
  auMark();
};

window.auStopOld = stopAudioBar;
stopAudioBar = function () {
  window.auStopOld.apply(this, arguments);
  auMark();
};

/* 백지 테스트 진입 (대본 시트) */
(function () {
  const b = $("#sc-final-btn");
  if (b) b.onclick = () => startVerify();
})();


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
    const btest = $("#btn-test");
    if (btest) btest.onclick = () => {
      try { startVerify(); } catch (e) {
        console.error("[langclip] startVerify failed", e);
        toast("테스트를 열지 못했습니다: " + e.message, 3200);
      }
    };
    const aon = $("#ad-audio-on");
    if (aon) aon.onchange = () => { const b = $("#ad-audio-body"); if (b) b.hidden = !aon.checked; };
    const abox = $("#ad-audio-box");
    if (abox) abox.hidden = !S.admin;
    const bsc = $("#btn-script");
    if (bsc) bsc.onclick = () => {
      try { openScriptSheet(); } catch (e) {
        console.error("[langclip] openScriptSheet failed", e);
        toast("대본을 열지 못했습니다: " + e.message, 3200);
      }
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else setTimeout(wire, 40);
})();
