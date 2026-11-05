/* =========================================================
   Langclip · 싱크 맞추기 (문장 끝만 찍기)  v3.8
   · 영상은 들어가자마자 재생되고, 찍어도 멈추지 않는다.
   · 각 문장의 '끝나는 순간'만 찍는다. (문장 n개 → n-1번)
   · 마지막으로 찍은 지점부터 영상 끝까지는 마지막 문장이 된다.
   ========================================================= */
(function () {
  "use strict";
  const ST = {
    url: "", title: "", items: [], bounds: [],
    sentences: [], player: null, ready: false, speed: 1,
    clock: 0, finished: false, need: 0,
  };

  const fmtT = (t) => {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  };
  const App = () => window.LangclipApp;
  const toast = (m, ms) => App() && App().toast(m, ms);
  const show = (id) => App() && App().show(id);
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) => App().esc(s);

  function fitFrame() {
    const host = $("#sync-frame");
    if (!host) return;
    const iw = host.clientWidth, ih = host.clientHeight;
    if (!iw || !ih) return;
    const k = Math.max(iw / 16, ih / 9);
    const w = Math.round(16 * k), h = Math.round(9 * k);
    const f = host.querySelector("iframe");
    if (!f) return;
    f.style.width = w + "px";
    f.style.height = h + "px";
    f.style.left = Math.round((iw - w) / 2) + "px";
    f.style.top = Math.round((ih - h) / 2) + "px";
  }
  window.addEventListener("resize", fitFrame);

  async function start(opts) {
    const url = (opts.url || "").trim();
    const text = opts.text || "";
    const title = (opts.title || "").trim();
    if (!url) return toast("쇼츠 주소를 입력해주세요");
    if (!text.trim()) return toast("대본을 붙여넣어 주세요");

    const b = $("#btn-sync-start");
    if (b) { b.disabled = true; b.textContent = "준비 중…"; }
    try {
      const r = await App().jsonPost("/api/sync/split", { text, split_sentences: true });
      if (!r.items || !r.items.length) throw new Error("문장을 찾지 못했습니다");
      ST.url = url; ST.title = title; ST.items = r.items;
      ST.bounds = []; ST.finished = false;
      ST.need = r.items.length > 1 ? r.items.length - 1 : 1;
      show("s-sync");
      const te = $("#sync-title"); if (te) te.textContent = title || "싱크 맞추기";
      render();
      mount(url);
    } catch (e) {
      toast("시작 실패: " + e.message, 4400);
    } finally {
      if (b) { b.disabled = false; b.textContent = "싱크 맞추기"; }
    }
  }

  async function mount(url) {
    const YT = await (window.loadYT ? window.loadYT() : Promise.resolve(null));
    const host = $("#yt-sync");
    host.innerHTML = "";
    const box = document.createElement("div");
    host.appendChild(box);
    if (!YT || !YT.Player) {
      ST.ready = false;
      return toast("YouTube 플레이어를 불러오지 못했습니다", 4000);
    }
    const vid = (url.match(/(?:v=|shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/) || [])[1] || url;
    await new Promise((res) => {
      ST.player = new YT.Player(box, {
        videoId: vid,
        playerVars: {
          enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 0,
          cc_load_policy: 0, cc_lang_pref: "", iv_load_policy: 3, fs: 0,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            ST.ready = true;
            try { ST.player.unloadModule("captions"); } catch {}
            fitFrame();
            res();
          },
          onStateChange: (e) => {
            if (e.data === 1) { try { ST.player.unloadModule("captions"); } catch {} }
          },
          onError: () => { ST.ready = false; res(); },
        },
      });
    });
    setTimeout(fitFrame, 220);

    // 들어가자마자 재생
    try {
      ST.player.seekTo(0, true);
      ST.player.playVideo();
      ST.player.setPlaybackRate(ST.speed);
    } catch {}

    if (ST.clock) clearInterval(ST.clock);
    ST.clock = setInterval(() => {
      if (!ST.player || !ST.player.getCurrentTime) return;
      const t = ST.player.getCurrentTime() || 0;
      const ce = $("#sync-clock"); if (ce) ce.textContent = fmtT(t);
    }, 80);
  }

  function tipFor(k) {
    const n = ST.items.length;
    if (k === 0) return "첫 문장이 끝나는 순간에 누르세요.";
    if (k >= ST.need) return "완료!";
    if (k === ST.need - 1 && n > 1) {
      return `${k + 1}번째 문장이 끝나는 순간에 누르세요 · 이후는 마지막 문장으로 처리됩니다.`;
    }
    return `${k + 1}번째 문장이 끝나는 순간에 누르세요.`;
  }

  function render() {
    const n = ST.items.length, k = ST.bounds.length;
    const cnt = $("#sync-count"); if (cnt) cnt.textContent = `${Math.min(k, n)} / ${n}`;
    const i = Math.min(k, n - 1);
    const it = ST.items[i] || { en: "", ko: "" };

    const ste = $("#sync-step"); if (ste) ste.textContent = tipFor(k);
    const ene = $("#sync-en"); if (ene) ene.textContent = it.en || "—";
    const koe = $("#sync-ko"); if (koe) koe.textContent = it.ko || "";

    const done = [];
    for (let j = 0; j < k; j++) {
      const st = j === 0 ? 0 : ST.bounds[j - 1];
      done.push(`<span class="sd-chip"><b>${j + 1}</b>${fmtT(st)}–${fmtT(ST.bounds[j])}</span>`);
    }
    const dn = $("#sync-done"); if (dn) dn.innerHTML = done.length ? done.join("") : `<span class="sd-none">아직 찍은 구간이 없습니다</span>`;

    const tap = $("#sync-tap");
    const lab = tap.querySelector("span");
    if (k === 0) lab.textContent = "첫 문장 끝";
    else if (k >= ST.need - 1) lab.textContent = "마지막 문장 전";
    else lab.textContent = "이 지점에서 문장 끊기";

    // ※ 이후 화면에서 힌트 영역을 빼냈으므로 없을 수 있다. 없으면 건너뛰긴다.
    const hintEl = $("#sync-hint");
    if (hintEl) {
      const next = ST.items[k + 1];
      hintEl.textContent = next
        ? `다음 문장: ${(next.en || "").slice(0, 40)}${(next.en || "").length > 40 ? "…" : ""}`
        : "영상은 계속 재생됩니다 · 멈추지 않고 찍으세요";
    }
  }

  function tap() {
    if (!ST.player || !ST.ready) return toast("플레이어 준비 중입니다");
    if (ST.bounds.length >= ST.need) return;
    const t = Math.round((ST.player.getCurrentTime() || 0) * 100) / 100;
    const last = ST.bounds.length ? ST.bounds[ST.bounds.length - 1] : -1;
    if (last >= 0 && t - last < 0.15) return toast("너무 가깝습니다. 조금 더 진행한 뒤 눌러주세요");
    if (ST.bounds.length && t <= last) return toast("앞 지점입니다. 조금 더 진행한 뒤 눌러주세요");

    ST.bounds.push(t);
    render();
    if (ST.bounds.length >= ST.need) finish();
  }

  function undo() {
    if (!ST.bounds.length) return;
    ST.bounds.pop();
    ST.finished = false;
    render();
    toast("마지막 지점을 지웠습니다");
  }

  function duration() {
    let d = 0;
    try { d = ST.player.getDuration() || 0; } catch {}
    return d > 0 ? Math.round(d * 100) / 100 : 0;
  }

  function finish() {
    if (ST.finished) return;
    ST.finished = true;
    try { ST.player && ST.player.pauseVideo(); } catch {}
    build();
    openReview();
  }

  function build() {
    const n = ST.items.length, b = ST.bounds;
    const dur = duration();
    ST.sentences = ST.items.map((it, i) => {
      const st = i === 0 ? 0 : (b[i - 1] != null ? b[i - 1] : 0);
      let en;
      if (i < n - 1) en = b[i] != null ? b[i] : st + 2;
      else {
        // 마지막 문장 = 마지막으로 찍은 지점 ~ 영상 끝
        en = dur > st + 0.3 ? dur : (b.length ? b[b.length - 1] + 2.5 : st + 2.5);
      }
      if (en <= st + 0.15) en = st + 0.4;
      return {
        en: it.en || "", ko: it.ko || "",
        start: Math.round(st * 100) / 100, end: Math.round(en * 100) / 100,
      };
    });
  }

  function vidOf(url) {
    return (url.match(/(?:v=|shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/) || [])[1] || "";
  }

  function toMd() {
    const L = [];
    if (ST.title) L.push("# " + ST.title);
    const v = vidOf(ST.url);
    if (v) L.push("@yt " + v);
    const d = duration();
    if (d) L.push("@duration " + d);
    ST.sentences.forEach((s) => {
      L.push("");
      L.push(`## ${fmtT(s.start)}-${fmtT(s.end)}`);
      L.push("EN: " + s.en);
      if (s.ko) L.push("KO: " + s.ko);
    });
    return L.join("\n") + "\n";
  }

  function openReview() {
    renderReview();
    $("#sheet-sync-review").hidden = false;
  }

  function localWarn() {
    const o = [];
    ST.sentences.forEach((s, i) => {
      if (s.end - s.start < 0.25) o.push(`${i + 1}번 구간이 ${(s.end - s.start).toFixed(2)}초로 짧습니다`);
      if (i && s.start < ST.sentences[i - 1].end - 0.001) o.push(`${i + 1}번이 ${i}번과 겹칩니다`);
      if (!s.en.trim()) o.push(`${i + 1}번 영어가 비었습니다`);
    });
    return o;
  }

  function renderReview() {
    $("#sync-review-list").innerHTML = ST.sentences.map((s, i) => `
      <div class="rv-row">
        <div class="rv-top"><b>${i + 1}</b><span class="rv-en">${esc(s.en)}</span></div>
        <div class="rv-times">
          <span class="rv-k">시작</span>
          <button class="nb dark" data-rv="${i}:start:-0.1">◀</button>
          <b class="rv-v">${s.start.toFixed(2)}</b>
          <button class="nb dark" data-rv="${i}:start:0.1">▶</button>
          <span class="rv-k">끝</span>
          <button class="nb dark" data-rv="${i}:end:-0.1">◀</button>
          <b class="rv-v">${s.end.toFixed(2)}</b>
          <button class="nb dark" data-rv="${i}:end:0.1">▶</button>
          <span class="rv-len">${(s.end - s.start).toFixed(1)}s</span>
        </div>
      </div>`).join("");
    $$("#sync-review-list [data-rv]").forEach((el) => {
      el.onclick = () => {
        const [i, k, d] = el.dataset.rv.split(":");
        const s = ST.sentences[+i];
        const v = +(k === "start" ? s.start : s.end) + Number(d);
        if (k === "start") s.start = Math.max(0, Math.round(v * 100) / 100);
        else s.end = Math.max(0.2, Math.round(v * 100) / 100);
        if (s.end <= s.start + 0.1) s.end = Math.round((s.start + 0.2) * 100) / 100;
        renderReview();
      };
    });
    $("#sync-md").value = toMd();
    const w = localWarn();
    const box = $("#sync-warn");
    box.hidden = !w.length;
    box.innerHTML = w.length ? "<b>확인</b><br/>" + w.map(esc).join("<br/>") : "";
  }

  async function save() {
    if (!ST.sentences.length) return toast("저장할 문장이 없습니다");
    const b = $("#btn-sync-save");
    b.disabled = true; b.textContent = "저장 중…";
    try {
      const r = await App().jsonPost("/api/sync/apply", {
        url: ST.url, title: ST.title, vid: null,
        sentences: ST.sentences, markdown: $("#sync-md").value,
        duration: duration(),
      });
      try { if (window.attachAddAudio) await window.attachAddAudio(r.video.id); }
      catch (e) { toast("원본 음성 연결 실패: " + e.message, 5200); }
      $("#sheet-sync-review").hidden = true;
      toast(`저장 완료 · 문장 ${r.segs.length}개`, 3000);
      await App().loadVideos();
      await App().loadHome();
      const v = App().S.videos.find((x) => x.id === r.video.id);
      if (v) App().openVideo(v, 0);
      else show("s-list");
    } catch (e) {
      toast("저장 실패: " + e.message, 4600);
    } finally {
      b.disabled = false; b.textContent = "저장";
    }
  }

  function redo() {
    $("#sheet-sync-review").hidden = true;
    ST.bounds = []; ST.finished = false;
    try { ST.player && ST.player.seekTo(0, true); ST.player.playVideo(); } catch {}
    render();
  }

  function stopAll() {
    try { ST.player && ST.player.pauseVideo(); } catch {}
    if (ST.clock) clearInterval(ST.clock);
    ST.clock = 0;
  }


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

  function bind() {
    $("#sync-tap").onclick = tap;
    $("#sync-undo").onclick = undo;
    $("#sync-play").onclick = () => {
      if (!ST.player || !ST.ready) return;
      const st = ST.player.getPlayerState ? ST.player.getPlayerState() : 0;
      if (st === 1) ST.player.pauseVideo(); else ST.player.playVideo();
    };
    $("#sync-speed").onclick = () => {
      ST.speed = ST.speed === 1 ? 0.75 : ST.speed === 0.75 ? 0.5 : 1;
      try { ST.player && ST.player.setPlaybackRate(ST.speed); } catch {}
      $("#sync-speed").textContent = ST.speed.toFixed(2).replace(/0$/, "") + "x";
    };
    $("#btn-sync-back").onclick = () => { stopAll(); show("s-home"); };
    $("#btn-sync-save").onclick = save;
    $("#btn-sync-redo").onclick = redo;

    document.addEventListener("keydown", (e) => {
      if (!$("#s-sync").classList.contains("is-active")) return;
      if ($("#sheet-sync-review").hidden === false) return;
      if (e.target.matches("input,textarea")) return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); tap(); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); $("#sync-play").click(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.LangclipSync = { ST, start, auto, tap, undo, finish };
})();
