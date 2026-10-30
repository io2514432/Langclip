/* =========================================================
   Echo · 문장별 셰도잉 (YouTube IFrame segment player)
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  videos: [], cur: null, idx: 0,
  player: null, ready: false, loop: 1,
  seg: null, tick: 0,
  stream: null, rec: null, chunks: [], levels: [],
  actx: null, an: null, raf: 0, t0: 0, lastLoud: 0, timer: 0,
  takeBlob: null, scores: {},
  nudgeT: 0, nudgeBase: null, nudgeBusy: false,
};
let AUDIOS = [];

/* =======================================================
   SegmentController — 시험 가능한 재생 제어기
   YouTube IFrame API에는 "여기서 멈춰라"가 없다.
   따라서 80ms 폴링으로 현재 시간을 감시하고 end에 닿으면
   pauseVideo() + seekTo(start) 한다.
   ======================================================= */
class SegmentController {
  constructor(getPlayer, opts = {}) {
    this.get = getPlayer;
    this.poll = opts.poll ?? 80;
    this.eps = opts.eps ?? 0.06;
    this.seg = null;
    this.loopLeft = 0;
    this.timer = null;
    this.onStop = opts.onStop || (() => {});
    this.onTick = opts.onTick || (() => {});
  }
  play(seg, repeats = 1) {
    const p = this.get();
    if (!p) return false;
    this.seg = { start: +seg.start, end: +seg.end };
    this.loopLeft = Math.max(0, repeats - 1);
    p.seekTo(this.seg.start, true);
    p.playVideo();
    this._start();
    return true;
  }
  _start() {
    this._clear();
    this.timer = setInterval(() => this._check(), this.poll);
  }
  _check() {
    const p = this.get();
    if (!p || !this.seg) return this._clear();
    const t = p.getCurrentTime();
    this.onTick(t, this.seg);
    if (t >= this.seg.end - this.eps) {
      if (this.loopLeft > 0) {
        this.loopLeft -= 1;
        p.seekTo(this.seg.start, true);
        p.playVideo();
      } else {
        p.pauseVideo();
        const done = this.seg;
        this.holdAt = { start: done.start, end: done.end };
        this.seg = null;
        this._clear();
        this.onStop(done);
      }
    }
  }
  stop({ hold = false } = {}) {
    const p = this.get();
    if (p && !hold) p.pauseVideo();
    this.seg = null;
    this._clear();
  }
  _clear() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
  get active() { return !!this.seg; }
}

const setNow = (txt) => { const el = $("#now-seg"); if (el) el.textContent = txt; };
const setPlayingBtn = (on) => {
  const b = $("#btn-play-seg"); if (!b) return;
  b.classList.toggle("playing", !!on);
};

const ctrl = new SegmentController(() => S.player, {
  onStop: () => {
    setNow("—");
    setPlayingBtn(false);
    const b = $("#btn-play-seg");
    if (b && b.dataset.wasPlaying) {
      delete b.dataset.wasPlaying;
      setHint("문장 재생 완료 · 이제 따라 말해보세요");
    }
  },
  onTick: (t, seg) => setNow(`${t.toFixed(1)}s / ${seg.end.toFixed(1)}s`),
});
window.Echo = { SegmentController, ctrl, S };

/* ---------------- utils ---------------- */
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.hidden = true), ms);
}
const fmt = (n) => (isFinite(n) ? n.toFixed(1) : "0.0");
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function show(id) {
  $$(".screen").forEach((el) => el.classList.toggle("is-active", el.id === id));
  const sc = $("#" + id + " .scroll");
  if (sc) sc.scrollTop = 0;
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
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---------------- YouTube player ---------------- */
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
async function mountPlayer(videoId) {
  const YT = await loadYT();
  const host = $("#yt");
  host.innerHTML = "";
  const box = document.createElement("div");
  host.appendChild(box);
  if (!YT) {
    box.innerHTML = `<div style="display:grid;place-items:center;height:100%;color:#8AA5BC;font-size:11px;text-align:center;padding:14px;line-height:1.6">YouTube 플레이어를 불러오지 못했습니다.<br/>네트워크 차단 환경에서는 문장 구간 정보만 확인할 수 있습니다.</div>`;
    S.player = null; S.ready = false;
    return;
  }
  await new Promise((resolve) => {
    S.player = new YT.Player(box, {
      videoId,
      playerVars: {
        enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1,
        controls: 1, origin: location.origin,
      },
      events: {
        onReady: () => { S.ready = true; resolve(); },
        onError: () => { S.ready = false; resolve(); },
      },
    });
  });
}

/* ---------------- 홈 ---------------- */
async function loadVideos() {
  try { S.videos = await api("/api/videos"); }
  catch (e) { S.videos = []; toast("목록을 불러오지 못했습니다: " + e.message, 4000); }
  renderVideos();
}
function renderVideos() {
  const box = $("#vlist");
  box.innerHTML = "";
  $("#v-count").textContent = S.videos.length;
  if (!S.videos.length) {
    box.innerHTML = `<div class="tip"><b>아직 영상이 없습니다</b><p>아래 <b>영상 추가</b> 버튼을 눌러 유튜브 링크와 자막을 넣어주세요.</p></div>`;
    return;
  }
  S.videos.forEach((v) => {
    const el = document.createElement("button");
    el.className = "vcard";
    el.innerHTML = `
      <div class="thumb">
        <img src="https://i.ytimg.com/vi/${esc(v.yt)}/mqdefault.jpg" alt="" loading="lazy" />
        <span class="pl"></span>
      </div>
      <div class="vbody">
        <div class="vt">${esc(v.title)}</div>
        <div class="vs">
          <span class="chip">문장 ${v.n}개</span>
          ${v.has_audio ? `<span class="chip">음향 채점</span>` : `<span class="chip gray">타이밍 채점</span>`}
        </div>
      </div>`;
    el.querySelector("img").onerror = (ev) => {
      ev.target.style.display = "none";
      ev.target.parentElement.style.background =
        "linear-gradient(135deg,#EAF7FF,#D6EEFC)";
    };
    el.onclick = () => openVideo(v);
    box.appendChild(el);
  });
}

/* ---------------- 플레이어 화면 ---------------- */
async function openVideo(v) {
  S.cur = v; S.idx = 0; S.seg = null;
  $("#p-title").textContent = v.title;
  $("#p-sub").textContent = `문장 ${v.n}개 · ${v.has_audio ? "원본 음원 비교 채점" : "타이밍 채점"}`;
  $("#seg-count").textContent = v.n;
  $("#alert").hidden = true;
  $("#now-seg").textContent = "—";
  $("#btn-loop").textContent = "🔁 반복 1회";
  S.loop = 1;
  const au = $("#au"); if (au) { au.pause(); au.removeAttribute("src"); delete au.dataset.src; }
  renderAudioCard();
  show("s-play");
  renderSegList();
  selectSeg(0);
  await mountPlayer(v.yt);
}
function renderSegList() {
  const box = $("#seg-list");
  box.innerHTML = "";
  S.cur.segs.forEach((s, i) => {
    const el = document.createElement("button");
    el.className = "seg" + (i === S.idx ? " on" : "");
    el.dataset.i = i;
    const sc = S.scores[`${S.cur.id}:${i}`];
    el.innerHTML = `
      <span class="seg-no">${i + 1}</span>
      <span class="seg-b">
        <span class="seg-t">${esc(s.text)}</span>
        <span class="seg-m"><span>${fmt(s.start)}s – ${fmt(s.end)}s</span>${sc ? `<span class="seg-score">${Math.round(sc)}점</span>` : ""}</span>
      </span>`;
    el.onclick = () => { selectSeg(i); playSeg(true); };
    box.appendChild(el);
  });
}
function selectSeg(i, quiet) {
  S.idx = i;
  const s = S.cur.segs[i];
  S.seg = s;
  $("#seg-text").textContent = s.text;
  $$(".seg").forEach((el) => el.classList.toggle("on", +el.dataset.i === i));
  paintTimes();
  if (!quiet) setHint("마이크를 눌러 따라 말하기");
}
function playSeg(withLabel) {
  if (!S.seg) return;
  const p = S.player;
  if (!p || !S.ready) {
    return warn("YouTube 플레이어가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
  }
  $("#alert").hidden = true;
  if (withLabel) { $("#btn-play-seg").dataset.wasPlaying = "1"; $("#btn-play-seg").classList.add("playing"); }
  ctrl.play(S.seg, S.loop);
}
function setHint(h) { const el = $("#rec-hint"); if (el) el.innerHTML = h; }
function warn(m) { const a = $("#alert"); if (!a) return; a.textContent = m; a.hidden = false; }

/* ============ v3.1 · 문장 타임스탬프 ±0.1s 미세조정 ============ */
function paintTimes() {
  const s = S.cur && S.cur.segs[S.idx];
  if (!s) return;
  const dur = $("#seg-time"), st = $("#seg-start"), en = $("#seg-end");
  if (dur) dur.textContent = `${fmt(s.start)}–${fmt(s.end)}s`;
  if (st) st.textContent = `${Number(s.start).toFixed(1)}s`;
  if (en) en.textContent = `${Number(s.end).toFixed(1)}s`;
}

function nudgeSeg(kind, delta) {
  const s = S.cur && S.cur.segs[S.idx];
  if (!s) return;
  if (!S.nudgeBase) S.nudgeBase = { start: +s.start, end: +s.end };

  const st = Math.max(0, +(kind === "start" ? +s.start + delta : +s.start).toFixed(2));
  const en = Math.max(0, +(kind === "end" ? +s.end + delta : +s.end).toFixed(2));
  if (en - st < 0.2) return toast("구간은 최소 0.2초 이상이어야 합니다");

  if (ctrl.active) ctrl.stop();           // 재생 중 경계가 바뀌면 즉시 멈춘다
  s.start = st; s.end = en;
  S.seg = s;
  paintTimes();
  renderSegList();
  selectSeg(S.idx, true);

  clearTimeout(S.nudgeT);
  S.nudgeT = setTimeout(() => saveSeg(s), 260);   // 연타는 0.26초 모아 한 번만 저장
}

async function saveSeg(s) {
  if (S.nudgeBusy) { clearTimeout(S.nudgeT); S.nudgeT = setTimeout(() => saveSeg(s), 200); return; }
  const base = S.nudgeBase || { start: +s.start, end: +s.end };
  S.nudgeBusy = true;
  try {
    const r = await api(`/api/videos/${S.cur.id}/segments/${S.idx}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: +s.start, end: +s.end }),
    });
    s.start = r.seg.start; s.end = r.seg.end;
    S.nudgeBase = null;
    paintTimes(); renderSegList(); selectSeg(S.idx, true);
  } catch (e) {
    s.start = base.start; s.end = base.end;
    S.nudgeBase = null;
    paintTimes(); renderSegList(); selectSeg(S.idx, true);
    toast("구간 저장 실패: " + e.message, 3800);
  } finally {
    S.nudgeBusy = false;
  }
}

/* ============ v3.1 · offset 자동 캘리브레이션 ============ */
async function calibrateOffset() {
  const v = S.cur;
  if (!v) return;
  if (!v.audio || !v.audio.url) return toast("먼저 원본 음원을 연결해주세요");
  const b = $("#btn-calib");
  if (b) { b.disabled = true; b.textContent = "계산 중…"; }
  try {
    const r = await api(`/api/videos/${v.id}/calibrate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: true }),
    });
    const conf = Math.round((r.confidence || 0) * 100);
    toast(`offset ${Number(r.offset).toFixed(2)}s 로 맞췄습니다 · 신뢰도 ${conf}%` +
      (r.note ? ` · ${r.note}` : ""), 5200);
    const au = $("#au");
    if (au) { au.pause(); au.removeAttribute("src"); delete au.dataset.src; }
    await reloadCur();
  } catch (e) {
    toast("자동 맞춤 실패: " + e.message, 4200);
  } finally {
    if (b) { b.disabled = false; b.textContent = "자동 맞춤"; }
  }
}

/* ============ 원본 음원(서버 저장) — 연결 / 구간 재생 ============ */
function renderAudioCard() {
  const v = S.cur; if (!v) return;
  const a = v.audio;
  const sub = $("#acard-s"), btn = $("#btn-link-audio"), play = $("#btn-ref"), cal = $("#btn-calib");
  if (a && a.url) {
    sub.textContent = `${a.title} · ${mmss(a.dur)} · offset ${Number(a.offset).toFixed(2)}s`;
    sub.classList.add("on"); btn.textContent = "변경"; if (play) play.hidden = false;
    if (cal) { cal.hidden = false; cal.disabled = false; }
  } else {
    sub.textContent = "연결 안 됨 · 지금은 길이만 채점";
    sub.classList.remove("on"); btn.textContent = "오디오 연결"; if (play) play.hidden = true;
    if (cal) cal.hidden = true;
  }
}

function refSrc() {
  const a = S.cur && S.cur.audio;
  if (!a || !a.url || !S.seg) return null;
  return { url: a.url, off: Number(a.offset) || 0,
           s: Math.max(0, S.seg.start - (Number(a.offset) || 0)),
           e: Math.max(0.2, S.seg.end - (Number(a.offset) || 0)) };
}

let refTimer = null;
function playRefAudio() {
  const r = refSrc();
  if (!r) return toast("이 영상에 연결된 원본 음원이 없습니다");
  const au = $("#au");
  if (refTimer) { clearTimeout(refTimer); refTimer = null; }
  au.pause();
  const go = () => {
    try { au.currentTime = r.s; } catch {}
    au.play().catch(() => {});
    refTimer = setTimeout(() => au.pause(), Math.max(200, (r.e - r.s) * 1000));
  };
  if (au.dataset.src !== r.url) {
    au.dataset.src = r.url;
    au.src = r.url;
    au.onloadedmetadata = go;
    au.load();
  } else go();
  toast(`서버 음원 ${r.s.toFixed(2)}–${r.e.toFixed(2)}s 재생 (Range 요청)`);
}

function openAudioSheet() {
  const a = S.cur && S.cur.audio;
  $("#af-title").value = a ? a.title : "";
  $("#af-offset").value = a ? a.offset : "0";
  $("#af-license").value = a ? (a.license || "") : "";
  $("#ff-audio").value = "";
  const lib = $("#audio-lib");
  lib.innerHTML = "";
  AUDIOS.forEach((x) => {
    const el = document.createElement("button");
    el.className = "librow";
    el.innerHTML = `<b>${esc(x.title)}</b><span>${mmss(x.dur)} · offset ${x.offset}s · ${esc(x.source)}</span>`;
    el.onclick = () => linkAudio(x.id, x.offset);
    lib.appendChild(el);
  });
  $("#audio-lib-wrap").hidden = AUDIOS.length === 0;
  $("#sheet-audio").hidden = false;
}

async function reloadCur() {
  const id = S.cur.id, idx = S.idx;
  S.videos = await api("/api/videos");
  const v = S.videos.find((x) => x.id === id);
  if (!v) return;
  S.cur = v;
  $("#p-sub").textContent = `문장 ${v.n}개 · ${v.has_audio ? "원본 음원 비교 채점" : "타이밍 채점"}`;
  renderAudioCard(); renderSegList(); selectSeg(idx, true);
}

async function linkAudio(aid, offset) {
  try {
    await api(`/api/videos/${S.cur.id}/link-audio`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_id: aid, offset: Number(offset) || 0 }),
    });
    $("#sheet-audio").hidden = true;
    const au = $("#au"); au.removeAttribute("src"); delete au.dataset.src;
    await reloadCur();
    toast("원본 음원 연결 완료 · 4축 음향 채점이 켜졌습니다");
  } catch (e) { toast("연결 실패: " + e.message, 4200); }
}

async function uploadAudio() {
  const f = $("#ff-audio").files[0];
  if (!f) return toast("오디오 파일을 선택해주세요");
  if (!$("#af-ok").checked)
    return toast("본인 소유 또는 라이선스 보유 음원임을 확인해주세요");
  const fd = new FormData();
  fd.append("file", f);
  fd.append("title", $("#af-title").value.trim() || f.name.replace(/\.[^.]+$/, ""));
  fd.append("offset", String(parseFloat($("#af-offset").value) || 0));
  fd.append("source", $("#af-source").value);
  fd.append("license", $("#af-license").value.trim());
  const b = $("#btn-audio-up");
  b.disabled = true; b.textContent = "업로드 중…";
  try {
    const r = await api("/api/audios", { method: "POST", body: fd });
    await loadAudios();
    await linkAudio(r.id, r.offset);
  } catch (e) { toast("업로드 실패: " + e.message, 4200); }
  finally { b.disabled = false; b.textContent = "업로드하고 연결"; }
}

async function loadAudios() {
  try { AUDIOS = await api("/api/audios"); } catch { AUDIOS = []; }
}

/* ---------------- 녹음 ---------------- */
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia)
    return warn("이 브라우저는 녹음을 지원하지 않습니다.");
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    return warn("마이크를 사용할 수 없습니다. 브라우저 권한을 확인해주세요. (" + e.name + ")");
  }
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
  S.levels = []; S.t0 = performance.now(); S.lastLoud = S.t0;

  const loop = () => {
    S.an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (rms > 0.015) S.lastLoud = performance.now();
    const el = (performance.now() - S.t0) / 1000;
    setHint(`녹음 중 <b>${el.toFixed(1)}s</b> · 조용해지면 자동 종료`);
    if (el > 15) stopRec();
    S.raf = requestAnimationFrame(loop);
  };
  loop();

  S.timer = setInterval(() => {
    const el = performance.now() - S.t0;
    if (el > 900 && performance.now() - S.lastLoud > 1600) stopRec();
  }, 120);

  S.rec.start();
  $("#btn-rec").classList.add("rec");
  $("#alert").hidden = true;
}
function stopRec() {
  if (!S.rec || S.rec.state !== "recording") return;
  S.rec.stop();
  clearInterval(S.timer);
  cancelAnimationFrame(S.raf);
  $("#btn-rec").classList.remove("rec");
  setHint("채점 중…");
}
async function onRecStop() {
  const mime = S.chunks[0]?.type || "audio/webm";
  S.takeBlob = new Blob(S.chunks, { type: mime });
  const dur = (performance.now() - S.t0) / 1000;
  try { S.stream.getTracks().forEach((t) => t.stop()); } catch {}
  if (S.takeBlob.size < 1000 || dur < 0.3) { setHint("너무 짧습니다. 다시 시도해주세요"); return; }
  await submitScore(dur);
}

/* ---------------- 채점 ---------------- */
async function submitScore(dur) {
  const fd = new FormData();
  fd.append("take", S.takeBlob, "take.webm");
  try {
    const r = await api(`/api/videos/${S.cur.id}/segments/${S.idx}/score`, { method: "POST", body: fd });
    S.scores[`${S.cur.id}:${S.idx}`] = r.total;
    renderSegList();
    renderResult(r, dur);
    show("s-result");
  } catch (e) {
    setHint("채점 실패");
    warn("채점에 실패했습니다: " + e.message);
  }
}

function renderResult(r, dur) {
  const total = Math.round(r.total);
  $("#total").textContent = total;
  $("#ring").style.setProperty("--p", Math.max(0, Math.min(100, r.total)));
  $("#res-text").textContent = r.text || (S.seg ? S.seg.text : "");
  $("#res-time").textContent = S.seg ? `${fmt(S.seg.start)}–${fmt(S.seg.end)}s` : "";

  const acoustic = r.mode === "acoustic";
  const vals = acoustic
    ? { pitch: r.pitch ?? 0, rhythm: r.rhythm ?? 0, timbre: r.timbre ?? 0, attack: r.attack ?? 0, timing: null }
    : { pitch: null, rhythm: null, timbre: null, attack: null, timing: r.timing ?? r.total };

  $$(".axis").forEach((el) => {
    const k = el.dataset.k;
    const v = vals[k];
    el.style.display = v === null ? "none" : "flex";
    if (v === null) return;
    el.querySelector("i").style.width = Math.max(0, Math.min(100, v)) + "%";
    el.querySelector(".ax-val").textContent = Math.round(v);
    el.classList.toggle("low", v < 55);
  });

  const note = $("#mode-note");
  note.classList.add("show");
  if (acoustic) {
    note.innerHTML = `원본 음원과 <b>직접 비교</b>한 4축 채점입니다.${r.has_pitch ? "" : " 피치가 없는 소리라 리듬·음색·어택으로 채점했습니다."}`;
  } else {
    note.innerHTML = `아직 이 영상의 <b>원본 음원이 없어</b> 발화 길이만 비교했습니다. 영상 화면에서 <b>오디오 올리기</b>를 하면 피치·리듬·음색·어택 4축 채점이 켜집니다.`;
  }

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
      ["attack", r.attack ?? 0, "소리의 시작(어택)이 다릅니다. 첫 음을 조금 더 또렷하게 터뜨려보세요."],
    ];
    p.sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([k, v, m]) => { if (v < 85) tips.push([k, m]); });
  } else {
    const raw = r.raw || {};
    if ((raw.ratio ?? 1) > 1.25) tips.push(["길이", "원본보다 길게 말했습니다. 문장을 끊지 말고 한 호흡에 이어 말해보세요."]);
    else if ((raw.ratio ?? 1) < 0.8) tips.push(["길이", "원본보다 짧습니다. 문장 끝까지 소리를 유지해보세요."]);
    else tips.push(["길이", "속도는 잘 맞았습니다. 원본 음원을 올리면 억양까지 채점할 수 있어요."]);
  }
  if (!tips.length) tips.push(["완료", "모든 항목이 훌륭합니다. 반복 횟수를 늘려 완전히 익혀보세요."]);
  return `<h4>코칭</h4><ul>${tips.map(([k, m]) => `<li><b>${k}</b> · ${m}</li>`).join("")}</ul>`;
}

/* ---------------- 시트 / 업로드 ---------------- */
function openSheet() { $("#sheet").hidden = false; }
function closeSheet() { $("#sheet").hidden = true; }
async function addVideo() {
  const url = $("#f-url").value.trim();
  if (!url) return toast("유튜브 링크를 입력해주세요");
  const body = {
    url,
    title: $("#f-title").value.trim(),
    transcript: $("#f-tr").value,
    duration: parseFloat($("#f-dur").value) || 0,
  };
  $("#btn-add").disabled = true;
  $("#btn-add").textContent = "추가 중…";
  try {
    const rec = await api("/api/videos", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    closeSheet();
    $("#f-url").value = ""; $("#f-title").value = ""; $("#f-tr").value = ""; $("#f-dur").value = "";
    toast(`영상 추가 완료 · 문장 ${rec.segs.length}개`);
    await loadVideos();
    const v = S.videos.find((x) => x.id === rec.id);
    if (v) openVideo(v);
  } catch (e) {
    toast("추가 실패: " + e.message, 4200);
  } finally {
    $("#btn-add").disabled = false;
    $("#btn-add").textContent = "영상 추가";
  }
}

/* ---------------- 이벤트 ---------------- */
function bind() {
  $("#btn-back").onclick = () => { ctrl.stop(); show("s-home"); };
  $("#tab-add").onclick = openSheet;
  $$("[data-close]").forEach((el) => (el.onclick = closeSheet));
  $("#btn-add").onclick = addVideo;
  $("#btn-link-audio").onclick = openAudioSheet;
  $("#btn-ref").onclick = playRefAudio;
  $("#btn-audio-up").onclick = uploadAudio;
  $("#ff-audio").onchange = () => {
    const f = $("#ff-audio").files[0];
    if (f && !$("#af-title").value) $("#af-title").value = f.name.replace(/\.[^.]+$/, "");
  };

  /* v3.1 — 타임스탬프 미세조정 / offset 자동 맞춤 */
  $$("[data-nudge]").forEach((el) => {
    el.onclick = () => {
      const [kind, d] = el.dataset.nudge.split(":");
      nudgeSeg(kind, Number(d));
    };
  });
  const cal = $("#btn-calib");
  if (cal) cal.onclick = calibrateOffset;

  $("#btn-play-seg").onclick = () => playSeg(true);
  $("#btn-stop").onclick = () => { ctrl.stop(); $("#now-seg").textContent = "—"; $("#btn-play-seg").classList.remove("playing"); };

  $("#btn-slow").onclick = () => {
    if (!S.player || !S.ready) return warn("플레이어 준비 중입니다");
    const on = S.player.getPlaybackRate && S.player.getPlaybackRate() < 0.95;
    S.player.setPlaybackRate(on ? 1 : 0.75);
    $("#btn-slow").classList.toggle("on", !on);
    toast(on ? "정상 속도" : "0.75배속 (억양 파악용)");
  };

  $("#btn-loop").onclick = () => {
    S.loop = S.loop === 1 ? 3 : S.loop === 3 ? 5 : 1;
    $("#btn-loop").textContent = `🔁 반복 ${S.loop}회`;
    $("#btn-loop").classList.toggle("on", S.loop > 1);
    if (S.seg) playSeg(true);
  };

  $("#btn-rec").onclick = () => {
    if (S.rec && S.rec.state === "recording") stopRec();
    else startRec();
  };

  $("#btn-retry").onclick = () => { show("s-play"); setHint("마이크를 눌러 다시 시도"); };
  $("#btn-next").onclick = () => {
    if (!S.cur) return show("s-home");
    const nxt = Math.min(S.idx + 1, S.cur.segs.length - 1);
    selectSeg(nxt);
    show("s-play");
    setTimeout(() => playSeg(true), 220);
  };
}

(function clock() {
  const d = new Date();
  $("#clock").textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
})();

bind();
loadVideos();
loadAudios();
