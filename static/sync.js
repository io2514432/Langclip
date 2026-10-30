/* =========================================================
   Echo · 재생하며 타이밍 찍기 (탭 싱크)
   추가(+) 시트에서 start({url,title,text,split}) 로 시작한다.
   ========================================================= */
(function () {
  const ST = {
    url: "", title: "", vid: null,
    items: [], bounds: [], sentences: [],
    player: null, ready: false, autoPause: true, speed: 1,
    clock: 0, finished: false,
  };

  const fmtT = (t) => {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  };
  const App = () => window.EchoApp;
  const toast = (m, ms) => App() && App().toast(m, ms);
  const show = (id) => App() && App().show(id);

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
      const r = await App().jsonPost("/api/sync/split", { text, split_sentences: opts.split !== false });
      if (!r.items || !r.items.length) throw new Error("문장을 찾지 못했습니다");
      ST.url = url; ST.title = title; ST.items = r.items;
      ST.bounds = []; ST.finished = false;
      show("s-sync");
      $("#sync-title").textContent = title || "싱크 맞추기";
      render();
      await mount(url);
      toast(`문장 ${r.items.length}개 · 문장이 끝날 때마다 버튼을 누르세요`, 4200);
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
        playerVars: { enablejsapi: 1, playsinline: 1, rel: 0, modestbranding: 1, controls: 0, origin: location.origin },
        events: {
          onReady: () => { ST.ready = true; fitFrame(); res(); },
          onError: () => { ST.ready = false; res(); },
        },
      });
    });
    setTimeout(fitFrame, 220);
    if (ST.clock) clearInterval(ST.clock);
    ST.clock = setInterval(() => {
      if (!ST.player || !ST.player.getCurrentTime) return;
      $("#sync-clock").textContent = fmtT(ST.player.getCurrentTime());
    }, 80);
  }

  function render() {
    const n = ST.items.length, k = ST.bounds.length;
    $("#sync-count").textContent = `${Math.min(k, n)} / ${n}`;
    const i = Math.min(k, n - 1);
    const it = ST.items[i] || { en: "", ko: "" };
    const nextIt = ST.items[i + 1];

    $("#sync-step").textContent = k === 0
      ? "① 첫 문장이 시작되는 순간에 누르세요"
      : (k <= n ? `② ${i + 1}번 문장이 끝나는 순간에 누르세요` : "완료!");
    $("#sync-en").textContent = it.en || "—";
    $("#sync-ko").textContent = it.ko || "";

    const done = [];
    for (let j = 0; j < k - 1 && j < n; j++) {
      done.push(`<span class="sd-chip"><b>${j + 1}</b>${fmtT(ST.bounds[j])}–${fmtT(ST.bounds[j + 1])}</span>`);
    }
    $("#sync-done").innerHTML = done.length ? done.join("") : `<span class="sd-none">아직 찍은 구간이 없습니다</span>`;

    const tap = $("#sync-tap");
    tap.querySelector("span").textContent = k === 0 ? "시작 찍기" : k >= n ? "마지막 끝 찍기" : "경계 찍기";
    $("#sync-hint").textContent = nextIt
      ? `다음 문장: ${(nextIt.en || "").slice(0, 42)}${(nextIt.en || "").length > 42 ? "…" : ""}`
      : "마지막 문장입니다";
  }

  function tap() {
    if (!ST.player || !ST.ready) return toast("플레이어 준비 중입니다");
    const n = ST.items.length;
    if (ST.bounds.length > n) return;
    const t = Math.round(ST.player.getCurrentTime() * 100) / 100;
    const last = ST.bounds.length ? ST.bounds[ST.bounds.length - 1] : -1;
    if (last >= 0 && t - last < 0.12) return toast("너무 가깝습니다. 조금 더 진행한 뒤 눌러주세요");

    ST.bounds.push(t);
    render();

    if (ST.autoPause) {
      if (ST.bounds.length > n) ST.player.pauseVideo();
      else if (ST.bounds.length === 1) ST.player.pauseVideo();
      else ST.player.playVideo();
    }
    if (ST.bounds.length >= n + 1) finish();
  }

  function undo() {
    if (!ST.bounds.length) return;
    ST.bounds.pop();
    ST.finished = false;
    render();
    toast("마지막 경계를 지웠습니다");
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
    ST.sentences = ST.items.map((it, i) => {
      const st = b[i] != null ? b[i] : (i ? b[i - 1] + 3 : 0);
      let en = b[i + 1] != null ? b[i + 1] : st + 3;
      if (en <= st) en = st + 0.2;
      return { en: it.en || "", ko: it.ko || "", start: Math.round(st * 100) / 100, end: Math.round(en * 100) / 100 };
    }).slice(0, n);
  }

  function vidOf(url) {
    return (url.match(/(?:v=|shorts\/|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/) || [])[1] || "";
  }

  function toMd() {
    const L = [];
    if (ST.title) L.push("# " + ST.title);
    const v = vidOf(ST.url);
    if (v) L.push("@yt " + v);
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
      });
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
    try { ST.player && ST.player.seekTo(0, true); } catch {}
    render();
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
    $("#sync-autopause").onclick = () => {
      ST.autoPause = !ST.autoPause;
      $("#sync-autopause").classList.toggle("on", ST.autoPause);
      toast(ST.autoPause ? "찍으면 자동 일시정지" : "재생 유지하며 연속 찍기");
    };
    $("#btn-sync-back").onclick = () => {
      try { ST.player && ST.player.pauseVideo(); } catch {}
      if (ST.clock) clearInterval(ST.clock);
      show("s-home");
    };
    $("#btn-sync-save").onclick = save;
    $("#btn-sync-redo").onclick = redo;

    document.addEventListener("keydown", (e) => {
      if (!$("#s-sync").classList.contains("is-active")) return;
      if (!$("#sheet-sync-review").hidden) return;
      if (e.target.matches("input,textarea")) return;
      if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); tap(); }
      else if (e.key === "Backspace") { e.preventDefault(); undo(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); $("#sync-play").click(); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.EchoSync = { ST, start, tap, undo, finish };
})();
