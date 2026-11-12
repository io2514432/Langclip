/* Langclip · 채점 UI (파형·녹음·백지테스트) — app.js 에서 분리 (v8.14.8) */

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
  SH.abort = true;
  VF.on = false;
  closeWave();
  setTimeout(() => { SH.abort = false; }, 900);
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
  const mime = SH.chunks[0]?.type || SH.rec?.mimeType || "audio/webm";
  SH.takeExt = mime.includes("mp4") ? ".m4a" : mime.includes("ogg") ? ".ogg" : mime.includes("wav") ? ".wav" : ".webm";
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
  lightPreScore();
}

/* ================= 진폭 파형 채점 (v8.14.29) ================= */
/* 원본 구간과 내 녹음의 "진폭 포락선"만 비교한다. 음소·내용은 보지 않으므로
   말이 달라도 리듬(강약 배치)이 비슷하면 점수가 나온다. */

const ENV_N = 64;          // 포락선 샘플 수
const ENV_D0 = 0.30;       // 점수 곡선: 100 * exp(-d / ENV_D0)

function envOfPcm(ch, n) {
  const out = new Float32Array(n);
  if (!ch || !ch.length) return out;
  const step = ch.length / n;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * step);
    const e = Math.min(ch.length, Math.max(s + 1, Math.floor((i + 1) * step)));
    let m = 0;
    for (let k = s; k < e; k++) { const v = Math.abs(ch[k]); if (v > m) m = v; }
    out[i] = m;
    if (m > peak) peak = m;
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = out[i] / peak;
  return out;
}

/* 앞뒤 무음을 잘라낸 뒤 n개로 다시 샘플링 (길이 차이는 정규화 → 템포 무관) */
function envTrimResample(a, n) {
  const N = a.length;
  let mx = 0;
  for (let i = 0; i < N; i++) if (a[i] > mx) mx = a[i];
  if (mx <= 1e-4) return new Float32Array(n);
  const th = mx * 0.12;
  let s = 0, e = N - 1;
  while (s < N && a[s] < th) s++;
  while (e > s && a[e] < th) e--;
  if (e - s < 2) { s = 0; e = N - 1; }
  const out = new Float32Array(n);
  const span = e - s;
  for (let i = 0; i < n; i++) {
    const p = s + (i / (n - 1)) * span;
    const i0 = Math.max(s, Math.min(e, Math.floor(p)));
    const i1 = Math.max(s, Math.min(e, i0 + 1));
    const t = p - i0;
    out[i] = a[i0] * (1 - t) + a[i1] * t;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) if (out[i] > peak) peak = out[i];
  if (peak > 0) for (let i = 0; i < n; i++) out[i] = out[i] / peak;
  return out;
}

/* 두 포락선의 평균 절대차 (0 = 완전 동일) */
function envDistance(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}

/* 무음 비율 기반 진단값 (점수 미반영) */
function envFluency(a) {
  const n = a.length;
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) if (a[i] < 0.14) s++;
  return Math.max(0, Math.round(100 * (1 - s / n)));
}

async function envScore(seg) {
  const au = S.cur && S.cur.audio;
  if (!au || !au.url) throw new Error("원본 오디오가 없습니다");
  const buf = await ensureDecoded(au.url);
  const off = Number(au.offset || 0);
  const refRaw = peaksFromBuffer(buf, Math.max(0, seg.start - off), Math.max(0.1, seg.end - off), ENV_N * 2);
  const ctx = SH.actx || (SH.actx = new (window.AudioContext || window.webkitAudioContext)());
  const dec = await ctx.decodeAudioData(await S.takeBlob.arrayBuffer());
  const takeRaw = envOfPcm(dec.getChannelData(0), ENV_N * 2);
  const refE = envTrimResample(refRaw, ENV_N);
  const takeE = envTrimResample(takeRaw, ENV_N);
  const d = envDistance(refE, takeE);
  const score = Math.max(0, Math.min(100, 100 * Math.exp(-d / ENV_D0)));
  return {
    score: score,
    sim: score,
    flu: envFluency(takeE),
    d: d,
    alpha: 1,
    env: { ref: Array.from(refE), take: Array.from(takeE) },
  };
}

/* 로컬 채점 단일 경로 — 서버 채점으로 되돌아가지 않는다 (v8.14.14) */
function lightPreScore() {
  if (!S.cur || !S.cur.segs[S.idx]) return lightFail("영상 정보가 없습니다");
  if (!S.takeBlob || S.takeBlob.size < 1000) return lightFail("녹음이 너무 짧습니다");
  const t0 = performance.now();
  envScore(S.cur.segs[S.idx]).then((r) => {
    r.ms = Math.round(performance.now() - t0);
    applyLocalScore(r);
  }).catch((e) => {
    if (window.LCUtil && LCUtil.logErr) LCUtil.logErr("env.score", e && e.message);
    lightFail("채점하지 못했습니다 · " + ((e && e.message) || "원인 불명"));
  });
}

/* 실패: 점수 없이 다시 녹음할 수 있게 안내한다 (서버 채점 대체 없음) */
function lightFail(msg) {
  showScoring(false);
  if (SH.abort) return;
  SH.skipListen = true;                 // 다시 누르면 듣기 생략하고 바로 카운트다운
  closeWave();
  toast(msg + " — 다시 눌러 한 번 더 녹음해 주세요", 4200);
}

/* 로컬 점수로 결과 화면을 직접 그린다 (서버 대기 없음) */
function applyLocalScore(r) {
  if (SH.abort) return;
  const seg = (S.cur.segs || [])[S.idx] || {};
  const total = Math.round(r.score);
  const res = {
    total: r.score,
    text: seg.en || seg.text || "",
    ko: seg.ko || "",
    mode: "light",
    pitch: null,
    sim: Math.round(r.sim),
    rhythm: Math.round(r.flu),      // 진단용(점수 미반영)
    timbre: null,
    attack: null,
    light: { d: +Number(r.d || 0).toFixed(3), alpha: r.alpha || 1, ms: r.ms, sim: +r.sim.toFixed(1), flu: +r.flu.toFixed(1) },
  };
  S.lastResult = res;
  SH.phase = "done";
  SH.score = total;
  SH.playT = SH.dur;
  waveState("완료", "done");
  const sc = $("#wv-score");
  if (sc) {
    sc.textContent = total + "점";
    sc.className = "wv-score " + (total >= 70 ? "good" : "low");
  }
  drawWave();
  renderResult(res);
  show("s-result");
  stageEvent("shadow", S.idx).then(() => paintGoals()).catch(() => {});
  loadHome();
  LCScoreDiff.push({ vid: S.cur.id, idx: S.idx, local: total, d: r.d, alpha: r.alpha, ms: r.ms });
  uploadTake(S.cur.id, S.idx, S.takeBlob, SH.takeExt, total);   // 진도 기록용
}

/* 녹음+로컬 점수를 서버에 보내 기록만 남긴다 (화면엔 반영 안 함) */
function uploadTake(vid, idx, blob, ext, total) {
  if (!vid || !blob) return;
  const fd = new FormData();
  // 점수만 전송 — 녹음 파일은 올리지 않는다 (v8.14.27)
  fd.append("local_total", String(Math.max(0, Math.min(100, Math.round(total || 0)))));
  api(`/api/videos/${vid}/segments/${idx}/score`, { method: "POST", body: fd })
    .catch(() => {});
}

/* ---------------- 학습 완료 검증 (3단계) ---------------- */
function startVerify() {
  if (!S.cur) return;
  if (!S.cur.segs || !S.cur.segs.length) return toast("문장이 없습니다");
  tqOpenSheet();
}

function goHome() {
  TQ.on = false; TQ.res = []; TQ.phase = "q";
  VF.on = false; VF.typed = {}; VF.stage = "recall";
  document.body.classList.remove("vf-focus");
  try { closeWave(true); } catch (e) {}
  show("s-home");
  loadHome().catch(() => {});
}

function exitVerify(ask) {
  if (TQ.phase === "done") ask = false;        // 결과 화면에서는 확인창 없이 닫기
  const segs = (S.cur && S.cur.segs) || [];
  const done = TQ.on ? TQ.res.length : segs.filter((s, i) => String(VF.typed[i] || "").trim()).length;
  if (ask && done > 0) {
    const msg = TQ.on
      ? `진행 중인 테스트 ${done}문항이 사라집니다.\n\n나갈까요?`
      : `작성한 답변 ${done}개가 사라집니다.\n\n백지 테스트를 나갈까요?`;
    if (!confirm(msg)) return;
  }
  TQ.on = false; TQ.res = []; TQ.item = null; TQ.phase = "q";
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
    <p class="test-desc"><b>${PASS_SCORE}점 이상 통과</b> · 한국어를 보고 영어로 옮겨 적으세요</p>
    ${segs.map((s, i) => `
      <div class="vf-row" data-i="${i}">
        <div class="vf-ko"><b>${i + 1}</b><span>${esc(s.ko || "(한국어 없음 · 영어만)")}</span></div>
        <textarea class="vf-in" data-i="${i}" rows="1" spellcheck="false" autocapitalize="off"
          placeholder="${s.ko ? "" : esc((s.en || "").slice(0, 1)) + "…"}"></textarea>
      </div>`).join("")}
    <div class="vf-pad"></div>`;
  $$("#vf-body .vf-in").forEach((el) => {
    el.value = VF.typed[el.dataset.i] || "";
    const fit = () => { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; };
    el.oninput = () => { VF.typed[el.dataset.i] = el.value; fit(); updateVfCount(); };
    fit();
  });
  const sub = $("#vf-submit");
  if (sub) sub.onclick = submitRecall;   // 초급·중급(tqCheck)에서 넘어와도 되돌린다
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
const PASS_SCORE = 80;   // verify.py 의 PASS_SCORE 와 같은 값

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
        <em>${r.passed ? "모든 문장을 확인하세요" : `${rc.need || 80}점 이상이면 통과입니다`}</em>
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
  if (r.passed) setTimeout(() => {
    const okN = rows.filter((x) => !x.lost).length;
    const bb = tqSave("recall", score);
    if (S.cur) S.cur.complete = true;
    tqCelebrate(score, okN, rows.length, bb || score);
  }, 340);
  $("#vf-again").onclick = () => { clearInterval(window.__vrStop); startVerify(); };
  $("#vf-close").onclick = () => { clearInterval(window.__vrStop); exitVerify(false); };
}


/* 음원 없는 영상은 섀도잉 버튼을 숨긴다 (v8.14.21) */
function syncShadowBtn() {
  var b = $("#btn-shadow");
  if (!b) return;
  var ok = !!(S.cur && S.cur.has_audio !== false);
  b.style.display = ok ? "" : "none";
  if (!ok && SH.phase !== "idle") { try { cancelShadow(); } catch (e) {} }
}
(function () {
  var raw = window.show;
  if (typeof raw === "function") {
    window.show = function (n) { raw(n); try { syncShadowBtn(); } catch (e) {} };
  }
})();
