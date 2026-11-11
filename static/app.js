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
  langFilter: "all",
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
const LC = window.LCUtil;
const fmt = LC.fmt;
const esc = LC.esc;
const mmss = LC.mmss;
const ic = (id, cls = "ic") => `<svg class="${cls}"><use href="#${id}"/></svg>`;
const MEDALS = ["bronze", "silver", "gold"];
const LANG_LIST = [
  { code: "en", name: "English" }, { code: "es", name: "Español" },
  { code: "fr", name: "Français" }, { code: "de", name: "Deutsch" },
  { code: "it", name: "Italiano" }, { code: "pt", name: "Português" },
  { code: "ja", name: "日本語" }, { code: "zh", name: "中文" },
];
const LANG_NAME = (c) => (LANG_LIST.find((l) => l.code === c) || {}).name || "English";
const LANG_TTS = { en: "en-US", es: "es-ES", fr: "fr-FR", de: "de-DE",
  it: "it-IT", pt: "pt-BR", ja: "ja-JP", zh: "zh-CN" };
const learnLang = () => { try { return localStorage.getItem("lc_lang") || "en"; } catch (e) { return "en"; } };
const setLearnLang = (c) => { try { localStorage.setItem("lc_lang", c); } catch (e) {} };

function renderLangChips() {
  const box = $("#lang-chips");
  if (!box) return;
  const have = [...new Set((S.videos || []).map((v) => v.lang || "en"))];
  if (have.length < 2) { box.innerHTML = ""; box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = [{ code: "all", name: "전체" }]
    .concat(have.map((c) => ({ code: c, name: LANG_NAME(c) })))
    .map((c) => `<button class="chip${S.langFilter === c.code ? " on" : ""}" data-langf="${c.code}">${esc(c.name)}</button>`)
    .join("");
  box.querySelectorAll("[data-langf]").forEach((el) => {
    el.onclick = () => { S.langFilter = el.dataset.langf; renderVideos(); };
  });
}

function renderSettings() {
  const box = $("#set-langs");
  if (!box) return;
  const cur = learnLang();
  box.innerHTML = `<div class="set-group">` + LANG_LIST.map((l) => `<button class="set-row${l.code === cur ? " on" : ""}" data-set="${l.code}">
      <span class="set-n">${esc(l.name)}</span>
      ${l.code === cur ? '<span class="set-ck">사용 중</span>' : ""}
    </button>`).join("") + `</div>`;
  box.querySelectorAll("[data-set]").forEach((el) => {
    el.onclick = () => { setLearnLang(el.dataset.set); renderSettings(); renderLangChips(); };
  });
  const tb = $("#set-tour");
  if (tb) {
    tb.innerHTML = `<div class="set-group"><button class="set-row" id="set-tour-btn">
        <span class="set-n">앱 둘러보기</span><span class="set-sub">다시 보기</span>
      </button></div>`;
    const b = $("#set-tour-btn");
    if (b) b.onclick = () => obShow(true);
  }
}
const medalHTML = (on) => {
  const set = new Set(on || []);
  return `<span class="m-med">${MEDALS.map((k) => `<svg class="med ${k}${set.has(k) ? " on" : ""}"><use href="#i-medal"/></svg>`).join("")}</span>`;
};

function show(id) {
  document.body.classList.toggle("tab-home", id === "s-home");
  if (id !== "s-verify") document.body.classList.remove("vf-focus");
  document.body.classList.toggle("res-focus", id === "s-result");
  document.body.classList.toggle("study-focus", id === "s-study" || id === "s-deck");
  if (id === "s-script") setTimeout(loadScripts, 0);
  if (id === "s-notes") setTimeout(refreshReview, 0);
  if (id === "s-home") setTimeout(checkCelebrate, 260);
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


const OB = { i: 0, n: 5, lang: null, tour: false };
const OB_KEY = "lc_onboard_v1";

function obRenderLangs() {
  const box = $("#ob-langs");
  if (!box) return;
  box.innerHTML = LANG_LIST.map((l) => `<button class="ob-lang${l.code === OB.lang ? " on" : ""}" data-obl="${l.code}">${esc(l.name)}</button>`).join("");
  box.querySelectorAll("[data-obl]").forEach((el) => {
    el.onclick = () => {
      OB.lang = el.dataset.obl;
      setLearnLang(OB.lang);
      obRenderLangs();
      obPaint();
    };
  });
}

function obPaint() {
  $$("#ob-body .ob-step").forEach((s) => s.classList.toggle("is-on", +s.dataset.step === OB.i));
  const box = $("#ob-dots");
  if (box) box.innerHTML = Array.from({ length: OB.n }, (_, k) => `<i class="${k === OB.i ? "on" : ""}"></i>`).join("");
  const cta = $("#ob-cta");
  const last = OB.i === OB.n - 1;
  const pick = OB.n === 5;
  if (cta) {
    cta.disabled = last && pick && !OB.lang;
    cta.textContent = !last ? "다음"
      : (pick ? (OB.lang ? "시작하기" : "언어를 선택해 주세요") : "시작하기");
  }
  const body = $("#ob-body");
  if (body) body.scrollTop = 0;
}

function obShow(tour) {
  const box = $("#ob");
  if (!box) return;
  OB.i = 0;
  OB.tour = !!tour;
  OB.lang = tour ? learnLang() : null;
  /* 설정에서 다시 볼 때 이미 언어를 골랐으면 언어 선택 단계는 건너뜀 */
  OB.n = (tour && OB.lang) ? 4 : 5;
  $$("#ob-body .ob-step").forEach((s) => { if (+s.dataset.step === 4) s.hidden = OB.n < 5; });
  box.hidden = false;
  obRenderLangs();
  obPaint();
}

function obClose() {
  const box = $("#ob");
  if (box) box.hidden = true;
  try { localStorage.setItem(OB_KEY, "1"); } catch (e) {}
  renderLangChips();
  renderSettings();
}

function obNext() {
  if (OB.i >= OB.n - 1) {
    if (OB.n === 5 && !OB.lang) return;
    return obClose();
  }
  OB.i += 1;
  obPaint();
}

/* ================= 홈 ================= */
async function loadHome() {
  try { S.progress = await api("/api/progress"); } catch { S.progress = null; }
  try { S.notes = await api("/api/notes"); } catch { S.notes = { sentences: [], words: [] }; }
  renderHome();
}

function checkCelebrate() {
  const f = S.progress && S.progress.focus;
  if (!f) return;
  const st1 = !!(f.stage1 || (f.stage && f.stage.stage1));
  const done = !!f.complete;
  if (!st1 && !done) return;
  const lvl = done ? "gold" : "silver";
  const key = "lc_cele:" + new Date().toISOString().slice(0, 10) + ":" + lvl;
  try { if (localStorage.getItem(key)) return; } catch {}
  const days = (S.progress.streak && S.progress.streak.days) || 1;
  const box = $("#cele");
  if (!box) return;
  $("#cele-n").textContent = days;
  $("#cele-flame").className = "cele-flame " + lvl;
  $("#cele-msg").innerHTML = done
    ? "모든 문장을 완벽하게 익혔어요.<br>내일도 이어가요."
    : "오늘 학습을 완료했어요.<br>백지 테스트로 완벽하게 학습해보세요.";
  $("#cele-cta").textContent = done ? "다시 연습하기" : "테스트 하러가기";
  $("#cele-cta").dataset.kind = done ? "done" : "test";
  box.hidden = false;
  try { localStorage.setItem(key, "1"); } catch {}
}

function renderHome() {
  const p = S.progress || {};
  const f = p.focus;
  const st = p.streak || { days: 0, week: [] };

  setStreak(st.days);
  
  

  const CK = '<svg class="wd-ck" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.6 10 17.4 19 6.8"/></svg>';
  $("#week").innerHTML = (st.week || []).map((d) => `
    <div class="wday${d.done ? " done" : ""}${d.is_today && !d.done ? " today-open" : ""}${d.is_future ? " future" : ""}">
      <span class="wd-lab">${esc(d.label)}</span>
      <span class="wd-dot">${d.done ? CK : ""}</span>
    </div>`).join("");

  const ft = $("#focus-title"), fm = $("#focus-meta");
  if (f) {
    if (ft) ft.textContent = f.title || "오늘의 쇼츠";
    if (fm) fm.textContent = `문장 ${f.segs}개`;
    const done = !!f.complete;
    $("#btn-start").disabled = false;
    $("#btn-start").textContent = done ? "다시 연습하기" : "학습 시작하기";
    const fi = $("#focus-img");
    if (fi) fi.src = `https://i.ytimg.com/vi/${esc(f.yt)}/hqdefault.jpg`;
    const fc = $("#focus-card"); if (fc) fc.classList.remove("empty");
  } else {
    if (ft) ft.textContent = "아직 등록된 영상이 없습니다";
    if (fm) fm.textContent = "추가 탭에서 쇼츠를 등록해주세요";
    $("#btn-start").disabled = true;
    $("#btn-start").textContent = "시작하기";
    const fi0 = $("#focus-img"); if (fi0) fi0.removeAttribute("src");
    const fc0 = $("#focus-card"); if (fc0) fc0.classList.add("empty");
  }

  const ns = S.notes.sentences || [];
  setCount("note-count", ns.length);
  const box = $("#note-preview");
  if (!box) return;
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

/* ================= 복습 덱 (단어 + 문장) ================= */
/* ================= v8.7 · 북마크 (Anki 덱 3단계) ================= */
const DK = { cards: [], due: 0, today: "", vid: "", decks: [] };
const AK = { q: [], i: 0, flip: false, n: 0, good: 0, again: 0, vid: "", hint: false };

function dkVideo(vid) { return (S.videos || []).find((x) => x.id === vid) || null; }
function dkTitle(v) { return (v && (v.title || v.name)) || "영상"; }
function dkThumb(v) {
  if (!v) return "";
  const yid = v.yt || v.youtube_id || v.yid || "";
  return v.thumb || v.thumbnail || v.cover || (yid ? `https://i.ytimg.com/vi/${yid}/mqdefault.jpg` : "");
}
function dkPct(list) {
  if (!list.length) return 0;
  const s = list.reduce((a, c) => a + Math.min(4, Number(c.step || 0)) / 4, 0);
  return Math.round((s / list.length) * 100);
}
function dkCtx(c) {
  const parts = String(c.cloze || "").split("____");
  let out = esc(parts[0] || "");
  for (let i = 1; i < parts.length; i++) out += `<mark>${esc(c.answer || "")}</mark>` + esc(parts[i] || "");
  return out || esc(c.ko || "");
}

async function refreshReview() {
  try {
    const r = await api("/api/review");
    DK.cards = r.cards || [];
    DK.due = r.due || 0;
    DK.today = r.today || "";
    dkBuild();
    renderDecks();
    if ($("#s-deck") && $("#s-deck").classList.contains("is-active")) renderDeck();
  } catch (e) { /* 목록은 비워둔다 */ }
}

function dkBuild() {
  const map = new Map();
  DK.cards.forEach((c) => {
    if (!c.vid) return;
    if (!map.has(c.vid)) map.set(c.vid, []);
    map.get(c.vid).push(c);
  });
  DK.decks = [...map.entries()].map(([vid, cards]) => {
    cards.sort((a, b) => (a.idx - b.idx) || (a.kind === "word" ? -1 : 1));
    return { vid, cards, n: cards.length, due: cards.filter((c) => c.is_due).length, pct: dkPct(cards) };
  }).sort((a, b) => b.n - a.n);
}

function renderDecks() {
  const box = $("#dk-list");
  if (!box) return;
  const nd = $("#dk-n"); if (nd) nd.textContent = DK.decks.length;
  const an = $("#dk-all-n"); if (an) an.textContent = DK.due + "장";
  const as = $("#dk-all-sub");
  if (as) as.textContent = DK.due ? "여러 덱의 카드를 한 번에" : "오늘 복습할 카드가 없어요";
  const ab = $("#dk-all"); if (ab) ab.classList.toggle("off", !DK.cards.length);
  if (!DK.decks.length) {
    box.innerHTML = `<div class="note-empty"><b>아직 담은 카드가 없어요</b><br />학습 화면에서 단어를 탭하거나 문장을 북마크하면 덱이 만들어집니다.</div>`;
    return;
  }
  box.innerHTML = `<div class="dk-g3">` + DK.decks.map((d) => {
    const v = dkVideo(d.vid);
    const th = dkThumb(v);
    return `<button class="dc" data-vid="${esc(d.vid)}">
      <span class="dc-th">${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : `<i>${esc(dkTitle(v).slice(0, 1))}</i>`}</span>
      <span class="dc-t">${esc(dkTitle(v))}</span>
      <span class="dc-m">${d.n}개 · ${d.pct}%${d.due ? " · 복습 대기" : ""}</span>
    </button>`;
  }).join("") + `</div>`;
  $$("#dk-list .dc").forEach((el) => { el.onclick = () => openDeck(el.dataset.vid); });
}

function openDeck(vid) {
  DK.vid = vid;
  renderDeck();
  show("s-deck");
}

function renderDeck() {
  const d = DK.decks.find((x) => x.vid === DK.vid);
  const body = $("#dk-body");
  if (!d || !body) return;
  const v = dkVideo(d.vid);
  const th = dkThumb(v);
  body.innerHTML = `
    <div class="dk-hero">
      <span class="dk-th big">${th ? `<img src="${esc(th)}" alt="">` : `<i>${esc(dkTitle(v).slice(0, 1))}</i>`}</span>
      <div class="dk-hero-tx">
        <b>${esc(dkTitle(v))}</b>
        <em>북마크 ${d.n}개 · 복습 대기 ${d.due}장</em>
      </div>
    </div>
    <button class="dk-start" id="dk-start">${d.due
      ? `이 덱 학습 시작하기<em>복습 대기 ${d.due}장</em>`
      : `이 덱 전체 학습하기<em>${d.n}장</em>`}</button>
    <div class="dk-count">카드 ${d.n}개</div>
    <div class="dk-cards">${d.cards.map((c) => `
      <div class="dk-card">
        <button class="dk-del" data-id="${esc(c.id)}" aria-label="삭제"><svg class="ic xs"><use href="#i-close"/></svg></button>
        ${c.kind === "sent"
          ? `<div class="dk-w sent">${esc(c.answer)}</div>
             ${c.meaning ? `<div class="dk-mean">${esc(c.meaning)}</div>` : ""}`
          : `<div class="dk-w">${esc(c.answer)}${c.meaning ? `<span class="dk-w-m">${esc(c.meaning)}</span>` : ""}</div>
             <div class="dk-ctx">${dkCtx(c)}</div>`}
      </div>`).join("")}</div>`;
  const st = $("#dk-start");
  if (st) st.onclick = () => startStudy(d.due ? d.cards.filter((c) => c.is_due) : d.cards);
  $$("#dk-body .dk-del").forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); delCard(el.dataset.id); };
  });
}

async function delCard(id) {
  const c = DK.cards.find((x) => x.id === id);
  if (!c) return;
  if (!confirm(`"${c.answer}" 카드를 삭제할까요?`)) return;
  try {
    if (c.kind === "word") await jsonPost("/api/notes/word", { word: c.answer, toggle_only: true });
    else await api(`/api/notes/sentence/${c.vid}/${c.idx}`, { method: "DELETE" });
  } catch (e) { return toast("삭제하지 못했습니다: " + e.message); }
  await refreshReview();
  const still = DK.decks.some((d) => d.vid === DK.vid);
  if (!still) {                      // 마지막 카드였다 → 덱이 사라짐
    DK.vid = "";
    show("s-notes");
    return;
  }
  renderDeck();
}

/* ---- Level 3 : Anki 학습 ---- */
function startStudy(cards) {
  AK.q = (cards || []).slice();
  if (!AK.q.length) return toast("학습할 카드가 없습니다");
  const sc0 = $("#s-study"); if (sc0) sc0.classList.remove("is-done");
  AK.i = 0; AK.flip = false; AK.hint = false;
  AK.n = AK.q.length; AK.good = 0; AK.again = 0;
  show("s-study");
  akRender();
}

function akCloze(c, open) {
  const parts = String(c.cloze || "").split("____");
  const cap = open
    ? `<span class="ak-ans">${esc(c.answer || "")}</span>`
    : `<button class="ak-blank" id="ak-blank">?</button>`;
  let out = esc(parts[0] || "");
  for (let i = 1; i < parts.length; i++) out += cap + esc(parts[i] || "");
  return out;
}

function akRender() {
  const c = AK.q[AK.i];
  if (!c) return akFinish();
  AK.flip = false; AK.hint = false;
  const sc1 = $("#s-study"); if (sc1) sc1.classList.remove("is-done");
  const v = dkVideo(c.vid);
  const isSent = c.kind === "sent";
  const done = Math.max(0, AK.i);
  const pct = Math.round((done / Math.max(1, AK.n)) * 100);
  $("#ak-i").textContent = `${Math.min(AK.i + 1, AK.n)} / ${AK.n}`;
  $("#ak-bar").style.width = Math.max(4, pct) + "%";
  $("#ak-flip").hidden = false;
  $("#ak-grades").hidden = true;
  const card = $("#ak-card");
  card.className = "ak-card";
  const meta = "";
  const hintBtn = `<button class="ak-hint" id="ak-hint">힌트 보기</button>
    <div class="ak-hintbox" id="ak-hintbox" hidden></div>`;
  card.innerHTML = isSent
    ? `${meta}
      <div class="ak-ko prompt">${esc(c.ko || c.meaning || "이 문장을 영어로 말해보세요")}</div>
      ${hintBtn}`
    : `${meta}
      <div class="ak-ko">${esc(c.ko || "")}</div>
      <div class="ak-en">${akCloze(c, false)}</div>
      ${hintBtn}`;
  const h = $("#ak-hint");
  if (h) h.onclick = (e) => {
    e.stopPropagation();
    const box = $("#ak-hintbox");
    if (!box) return;
    if (isSent) {
      const words = String(c.answer || "").split(/\s+/).filter(Boolean);
      box.innerHTML = `<b>${esc(words.slice(0, 2).join(" "))} …</b> · ${words.length}단어`;
    } else {
      const a = String(c.answer || "");
      box.innerHTML = `<b>${esc(a.slice(0, 1))}${"_".repeat(Math.max(0, a.length - 1))}</b>`
        + (c.meaning ? ` · ${esc(c.meaning)}` : "");
    }
    box.hidden = false;
    h.hidden = true;
  };
}

function akFlip() {
  const c = AK.q[AK.i];
  if (!c || AK.flip) return;
  AK.flip = true;
  const v = dkVideo(c.vid);
  const isSent = c.kind === "sent";
  const card = $("#ak-card");
  card.className = "ak-card back";
  const meta = "";
  card.innerHTML = isSent
    ? `${meta}
      <div class="ak-en ans">${esc(c.answer || "")}</div>
      <div class="ak-split"></div>
      <div class="ak-ko sub">${esc(c.ko || c.meaning || "")}</div>`
    : `${meta}
      <div class="ak-ko">${esc(c.ko || "")}</div>
      <div class="ak-en">${akCloze(c, true)}</div>
      <div class="ak-split"></div>
      <div class="ak-word">${esc(c.answer || "")}</div>
      <div class="ak-mean" id="ak-mean">${esc(c.meaning || "")}</div>`;
  $("#ak-flip").hidden = true;
  $("#ak-grades").hidden = false;
  if (!isSent && !c.meaning) akMeaning(c);
  akSpeak(c);
}

/* 뜻이 비어 있는 카드는 사전에서 한 번만 보충한다 */
async function akMeaning(c) {
  const el = $("#ak-mean");
  if (!el || !c) return;
  try {
    const r = await api("/api/words/" + encodeURIComponent(c.answer || ""));
    const defs = (r && Array.isArray(r.ko_defs)) ? r.ko_defs : [];
    const m = (r && (r.ko || (defs[0] && defs[0].ko) || r.meaning)) || "";
    if (m && el.isConnected) { el.textContent = m; el.classList.add("fade"); }
  } catch (e) {}
}

function akSpeak(c) {
  if (!c) return;
  const text = c.kind === "sent"
    ? String(c.answer || "").trim()
    : (String(c.cloze || "").replace(/____/g, " " + (c.answer || "") + " ").trim()
       || String(c.answer || ""));
  if (!text) return;
  try {
    const u = window.speechSynthesis;
    if (!u) return;
    u.cancel();
    const sp = new SpeechSynthesisUtterance(text);
    sp.lang = LANG_TTS[(S.cur && S.cur.lang) || "en"] || "en-US";
    sp.rate = 0.92; sp.pitch = 1;
    u.speak(sp);
  } catch (e) {}
}

async function akAudio(c) {
  if (!c) return;
  let v = dkVideo(c.vid);
  if (!v) { try { v = await api("/api/videos/" + c.vid); } catch { return akSpeak(c); } }
  const seg = (v.segs || [])[c.idx];
  if (v.audio && v.audio.url && seg) {
    try {
      const a = new Audio(v.audio.url);
      a.currentTime = Math.max(0, seg.start - Number(v.audio.offset || 0));
      await a.play();
      const stop = setInterval(() => {
        if (a.currentTime >= seg.end - Number(v.audio.offset || 0) || a.paused) {
          a.pause(); clearInterval(stop);
        }
      }, 120);
      return;
    } catch (e) {}
  }
  akSpeak(c);
}

async function akGrade(g) {
  const c = AK.q[AK.i];
  if (!c) return;
  try { await jsonPost("/api/review/grade", { id: c.id, grade: g }); } catch (e) {}
  if (g === 0) {
    AK.again += 1;
    AK.q.push({ ...c, is_due: false });      // 모름 → 세션 맨 뒤로 재삽입
  } else {
    AK.good += 1;
  }
  AK.i += 1;
  if (AK.i >= AK.q.length || AK.again > 40) return akFinish();
  akRender();
}

function akFinish() {
  const box = $("#ak-card");
  if (!box) return;
  $("#ak-flip").hidden = true;
  $("#ak-grades").hidden = true;
  $("#ak-i").textContent = "완료";
  const sc = $("#s-study"); if (sc) sc.classList.add("is-done");
  box.className = "ak-card done";
  box.innerHTML = `
    <div class="ak-fin">
      <div class="ak-fin-t">오늘 복습 완료</div>
      <div class="ak-fin-n">${AK.good + AK.again}<small>장</small></div>
      <div class="ak-fin-rows">
        <div><span>익힘</span><b>${AK.good}</b></div>
        <div><span>다시 본 카드</span><b>${AK.again}</b></div>
      </div>
    </div>
    <div class="ak-fin-bar">
      <button class="ak-fin-cta" id="ak-fin-deck">덱으로 돌아가기</button>
      <button class="ak-fin-x" id="ak-fin-home">홈으로 가기</button>
    </div>`;
  const d = $("#ak-fin-deck");
  if (d) d.onclick = () => { refreshReview(); show(DK.vid ? "s-deck" : "s-notes"); };
  const h = $("#ak-fin-home");
  if (h) h.onclick = () => { refreshReview(); show("s-home"); loadHome().catch(() => {}); };
}

function renderNotesScreen() { /* v8.7: Anki 덱 3단계로 대체 */ }

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
  renderLangChips();
  const list = (S.videos || []).filter((v) => S.langFilter === "all" || (v.lang || "en") === S.langFilter);
  setCount("v-count", list.length);
  if (!list.length) {
    box.innerHTML = `<div class="note-empty"><b>${esc(LANG_NAME(S.langFilter))} 영상이 없습니다</b><br />다른 언어를 고르거나 위 칩에서 <b>전체</b>를 눌러보세요.</div>`;
    return;
  }
  box.innerHTML = "";
  list.forEach((v) => {
    const el = document.createElement("div");
    el.className = "vrow-wrap";
    el.innerHTML = `
      ${S.admin ? `<button class="vdel" title="삭제" data-del="${esc(v.id)}">${ic("i-close", "ic xs")}</button>` : ""}
      <div class="vc-body${S.admin ? "" : " has-med"}">
        <div class="vc-thumb">
          <img src="https://i.ytimg.com/vi/${esc(v.yt)}/mqdefault.jpg" alt="" />
        </div>
        <div class="vc-main">
          <div class="nc-en">${esc(v.title)}</div>
          <div class="nc-meta">
            <span class="m-l">
              ${v.has_audio ? '<span class="tag ok">원본 음성</span>' : ""}
              <span class="m-n">총 ${v.n}문장</span>
              ${S.admin ? medalHTML(v.medals) : ""}
            </span>
            ${S.admin ? `<button class="v-audio" data-au="${esc(v.id)}">${v.has_audio ? "음원 교체" : "음원 추가"}</button><button class="v-audio" data-pick="${esc(v.id)}">${v.pick ? "오늘의 영상 ✓" : "오늘의 영상으로 설정"}</button>` : `<span class="m-sp"></span>`}
          </div>
        </div>
        <div class="vc-pct" hidden></div>
        ${S.admin ? "" : `<span class="med-corner">${medalHTML(v.medals)}</span>`}
      </div>
      <div class="vexp" hidden>
        <button class="vexp-b" data-open="video">영상 보기</button>
        <button class="vexp-b" data-open="script">대본 보기</button>
      </div>`;
    const exp = el.querySelector(".vexp");
    el.querySelector(".vc-body").onclick = () => {
      const open = exp.hidden;
      $$("#vlist .vexp").forEach((x) => { x.hidden = true; });
      $$("#vlist .vrow-wrap").forEach((x) => x.classList.remove("is-open"));
      exp.hidden = !open;
      el.classList.toggle("is-open", open);
    };
    el.querySelector('[data-open="video"]').onclick = (e) => { e.stopPropagation(); openVideo(v, 0); };
    el.querySelector('[data-open="script"]').onclick = (e) => { e.stopPropagation(); openScript(v.id); };
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


/* ================= 숙어 설정 (관리자) ================= */
const PHS = { pick: new Set(), list: [], tok: [] };

function phraseTokens(seg) {
  const text = (seg && (seg.en || seg.text)) || "";
  return text.split(/\s+/).filter(Boolean);
}

function openPhraseSheet() {
  if (!S.admin || !S.cur || !S.seg) return toast("재생 중인 문장에서만 설정할 수 있습니다");
  const seg = S.cur.segs[S.idx];
  PHS.tok = phraseTokens(seg);
  PHS.list = (seg.phr || []).map((p) => {
    const toks = Array.isArray(p.toks) && p.toks.length
      ? p.toks.slice()
      : rangeOf(p.from || 0, p.to || 0);
    return { toks, text: p.text, meaning: p.meaning || "" };
  });
  PHS.pick = new Set();
  $("#ph-sent").textContent = seg.en || seg.text || "";
  $("#ph-meaning").value = "";
  renderPhraseSheet();
  $("#sheet-phrase").hidden = false;
}

function renderPhraseSheet() {
  const box = $("#ph-toks");
  box.innerHTML = PHS.tok.map((t, i) => {
    const core = t.replace(/^[^\w']+|[^\w']+$/g, "") || t;
    const on = PHS.pick.has(i);
    const used = PHS.list.some((p) => p.toks.indexOf(i) >= 0);
    return `<button class="ph-t${on ? " on" : ""}${used && !on ? " used" : ""}" data-i="${i}">${esc(core)}</button>`;
  }).join("");
  $$("#ph-toks .ph-t").forEach((b) => {
    b.onclick = () => {
      const i = +b.dataset.i;
      if (PHS.pick.has(i)) PHS.pick.delete(i);
      else PHS.pick.add(i);
      renderPhraseSheet();
    };
  });
  const idxs = [...PHS.pick].sort((x, y) => x - y);
  $("#ph-pick").textContent = idxs.length
    ? "선택: " + idxs.map((i) => PHS.tok[i].replace(/^[^\w']+|[^\w']+$/g, "")).join(" ")
    : "선택 없음 (띄어쓰기 없이 떨어진 단어도 함께 고를 수 있습니다)";

  const list = $("#ph-list");
  list.innerHTML = PHS.list.length
    ? PHS.list.map((p, k) => `<div class="ph-item">
        <span class="ph-t2">${esc(p.text)}</span>
        <span class="ph-m2">${esc(p.meaning || "뜻 없음")}</span>
        <button class="ph-del" data-k="${k}">삭제</button>
      </div>`).join("")
    : `<div class="ph-none">저장된 숙어가 없습니다</div>`;
  $$("#ph-list .ph-del").forEach((b) => {
    b.onclick = async () => {
      PHS.list.splice(+b.dataset.k, 1);
      await savePhrases(true);
    };
  });
}

async function savePhrases(keepOpen) {
  if (!S.cur) return;
  try {
    const r = await api(`/api/videos/${S.cur.id}/phrases`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seg: S.idx, list: PHS.list.map((p) => ({ toks: p.toks, meaning: p.meaning })) }),
    });
    S.cur.segs[S.idx].phr = r.phrases || [];
    const k = S.videos.findIndex((x) => x.id === S.cur.id);
    if (k >= 0) S.videos[k].segs = S.cur.segs;
    delete SCRC[S.cur.id];
    renderSeg();
    if (keepOpen) {
      PHS.list = (r.phrases || []).map((p) => ({
        toks: (p.toks || rangeOf(p.from || 0, p.to || 0)).slice(),
        text: p.text, meaning: p.meaning || "",
      }));
      renderPhraseSheet();
    } else $("#sheet-phrase").hidden = true;
    toast("숙어를 저장했습니다", 2400);
  } catch (e) { toast("저장 실패: " + e.message, 4000); }
}

function savePhraseNow() {
  if (!PHS.pick.size) return toast("묶을 단어를 선택해주세요");
  const meaning = $("#ph-meaning").value.trim();
  if (!meaning) return toast("숙어의 뜻을 입력해주세요");
  const toks = [...PHS.pick].sort((x, y) => x - y);
  const text = toks.map((i) => PHS.tok[i].replace(/^[^\w']+|[^\w']+$/g, "")).join(" ");
  PHS.list = PHS.list.filter((p) => !p.toks.some((i) => toks.indexOf(i) >= 0));
  PHS.list.push({ toks, text, meaning });
  PHS.list.sort((x, y) => x.toks[0] - y.toks[0]);
  PHS.pick = new Set();
  savePhrases(true);
}

/* ================= 오늘 학습 목표 ================= */
const TM = { acc: 0, secs: 0, act: 0, started: 0 };

function goalState() {
  const st = (S.cur && S.cur.stage) || {};
  return {
    secs: Math.max(TM.secs, st.secs || 0),
    goal: st.goal || 180,
    listen: st.listen || 0,
    n: st.n || ((S.cur && S.cur.n) || 0),
    shadow: st.shadow || 0,
  };
}

function setDonut(el, pct) {
  if (!el) return;
  const fg = el.querySelector(".gk-fg");
  if (!fg) return;
  const r = 19, c = 2 * Math.PI * r;
  fg.style.strokeDasharray = c + " " + c;
  fg.style.strokeDashoffset = String(c * (1 - Math.max(0, Math.min(1, pct))));
}

const GOAL_DESC = {
  time: "학습 시간 링을 완성해보세요!",
  listen: "대본을 끝까지 들어보세요!",
  shadow: "섀도잉 한 문장을 해보세요!"
};

function goalNoteText(k, g) {
  const t = `${Math.floor(g.secs / 60)}:${String(g.secs % 60).padStart(2, "0")}/3:00`;
  const val = { time: t, listen: `${g.listen}/${g.n}`, shadow: `${Math.min(1, g.shadow)}/1` };
  if (!GOAL_DESC[k]) return "";
  return `${GOAL_DESC[k]} ${val[k]}`;
}

function paintGoals() {
  if (!$("#goals")) return;
  const vb0 = $(".vbottom");
  if (vb0 && S.doneShown && !(S.cur && S.cur.stage && S.cur.stage.stage1)) vb0.classList.remove("done");
  const g = goalState();
  const pt = Math.min(1, g.secs / g.goal);
  const pl = g.n ? Math.min(1, g.listen / g.n) : 0;
  const ps = Math.min(1, g.shadow / 1);
  setDonut($("#goal-time"), pt);
  setDonut($("#goal-listen"), pl);
  setDonut($("#goal-shadow"), ps);
  ["time", "listen", "shadow"].forEach((k) => {
    const el = $("#goal-" + k);
    if (!el) return;
    const done = k === "time" ? pt >= 1 : (k === "listen" ? pl >= 1 : ps >= 1);
    el.classList.toggle("done", done);
  });
  const tm = $("#gl-time-v");
  if (tm) tm.textContent = `${Math.floor(g.secs / 60)}:${String(g.secs % 60).padStart(2, "0")} / 3:00`;
  const ln = $("#gl-listen-v");
  if (ln) ln.textContent = `${g.listen} / ${g.n}`;
  const sh = $("#gl-shadow-v");
  if (sh) sh.textContent = `${Math.min(1, g.shadow)} / 1`;
  const note = $("#goal-note"), vb = $(".vbottom");
  if (note) {
    const k = S.goalSel || "";
    note.textContent = goalNoteText(k, g);
    if (vb) vb.classList.toggle("explain", !!k);
  }
  ["time", "listen", "shadow"].forEach((k) => {
    const row = $("#gl-" + k);
    if (!row) return;
    const ok = k === "time" ? pt >= 1 : (k === "listen" ? pl >= 1 : ps >= 1);
    row.classList.toggle("ok", ok);
  });
}

async function postStudyTime(secs) {
  if (!S.cur || secs <= 0) return null;
  try {
    const r = await jsonPost("/api/progress/event", { vid: S.cur.id, kind: "time", secs });
    applyStage(r);
    return r;
  } catch { return null; }
}

function showDone(ms) {
  const box = $("#gdone"), vb = $(".vbottom");
  if (!box || !vb) return;
  const d = ((S.progress && S.progress.streak && S.progress.streak.days) || 1);
  box.innerHTML = `<svg class="gf" viewBox="0 0 24 24" aria-hidden="true">`
    + `<path d="M13.5 0.67s0.74 2.65 0.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l0.03-0.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5 0.67z"/>`
    + `<b>${d}</b>일 연속 학습 달성`;
  S.doneShown = true;
  vb.classList.remove("explain");
  S.goalSel = "";
  paintGoals();
  vb.classList.remove("done");
  void vb.offsetWidth;
  vb.classList.add("done");
  clearTimeout(S.doneTimer);
  S.doneTimer = setTimeout(() => {
    vb.classList.remove("done");
    S.doneShown = false;
  }, ms || 2000);          // 2초 뒤 도넛으로 복귀
}

function applyStage(r) {
  if (!r || !S.cur) return;
  const was = !!(S.cur.stage && S.cur.stage.stage1);
  S.cur.stage = r;
  S.cur.stage1 = !!r.stage1;
  const k = S.videos.findIndex((x) => x.id === S.cur.id);
  if (k >= 0) { S.videos[k].stage = r; S.videos[k].stage1 = !!r.stage1; }
  paintGoals();
  if (r.stage1 && !was) {
    loadHome().catch(() => {});
    renderVideos();
    const onRes = $("#s-result") && $("#s-result").classList.contains("is-active");
    S.pendDone = true;
    if (!onRes) { S.pendDone = false; showDone(); }
  }
}

function studyTick() {
  if (!S.cur) return;
  if (!$("#s-play").classList.contains("is-active")) return;
  if (document.visibilityState !== "visible") return;
  const playing = (() => { try { return S.player.getPlayerState() === 1; } catch { return false; } })();
  const active = playing || (performance.now() - TM.act < 45000);
  if (!active) return;
  TM.secs += 1;
  TM.acc += 1;
  paintGoals();
  if (TM.acc >= 10) { const s = TM.acc; TM.acc = 0; postStudyTime(s); }
}

function bindStudyTimer() {
  setInterval(studyTick, 1000);
  ["pointerdown", "keydown"].forEach((ev) => {
    document.addEventListener(ev, () => { TM.act = performance.now(); }, true);
  });
}

/* ================= 자막 싱크 미세조정 (관리자) ================= */
/* mode: end(끝 조정 → 다음 문장이 따라옴) / start(시작 조정 → 앞 문장이 따라옴) / seg(구간 통째로) */
const NUDGE = { mode: "end", all: false, timer: 0, saving: false, now: 0 };

function nudgeLabel() {
  const el = $("#segadj-hint");
  if (!el || !S.cur || !S.cur.segs) return;
  const s = S.cur.segs[S.idx];
  if (!s) { el.textContent = ""; return; }
  const live = NUDGE.now ? ` · 지금 ${NUDGE.now.toFixed(1)}s` : "";
  el.textContent = `${S.idx + 1}번 ${s.start.toFixed(2)}–${s.end.toFixed(2)}s${live}`;
}

function nudgeMode(m) {
  NUDGE.mode = m;
  if (m !== "seg") NUDGE.all = false;
  $$("#segadj .mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  const all = $("#segadj-all");
  if (all) {
    all.classList.toggle("on", NUDGE.all);
    all.disabled = m !== "seg";
    all.style.opacity = m === "seg" ? "" : ".4";
  }
  nudgeLabel();
}

function nudgeToggle(force) {
  if (!S.admin || !S.cur) return;
  const box = $("#segadj");
  const on = typeof force === "boolean" ? force : (box ? box.hidden : true);
  if (box) box.hidden = !on;
  const rail = $("#btn-nudge");
  if (rail) rail.classList.toggle("on", !!on);
  if (!on) { NUDGE.now = 0; }
  nudgeMode(NUDGE.mode);
}

function nudgeBy(d) {
  if (!S.cur) return;
  const segs = S.cur.segs || [];
  const i = S.idx;
  if (!segs.length || !segs[i]) return;
  const r2 = (x) => Math.round(x * 100) / 100;
  const MIN = 0.2;

  if (NUDGE.all) {
    let minStart = Infinity;
    segs.forEach((s) => { minStart = Math.min(minStart, s.start); });
    const dd = (minStart + d < 0) ? -minStart : d;
    segs.forEach((s) => {
      s.start = r2(Math.max(0, s.start + dd));
      s.end = r2(Math.max(s.start + MIN, s.end + dd));
    });
  } else if (NUDGE.mode === "end") {
    const s = segs[i], nx = segs[i + 1];
    let en = r2(Math.max(s.start + MIN, s.end + d));
    s.end = en;
    if (nx) {
      // 뒤 문장은 앞 문장 끝에 따라온다 (늘어나면 밀리고, 줄어들면 당긴다)
      nx.start = en;
      if (nx.end < nx.start + MIN) nx.end = r2(nx.start + MIN);
      const nn = segs[i + 2];
      if (nn && nn.start < nx.end) nn.start = nx.end;
    }
  } else if (NUDGE.mode === "start") {
    const s = segs[i], pv = segs[i - 1];
    let st = r2(Math.max(0, s.start + d));
    if (st > s.end - MIN) st = r2(s.end - MIN);
    s.start = st;
    if (pv) {
      if (pv.start + MIN > st) st = r2(pv.start + MIN);
      s.start = st;
      pv.end = st;           // 앞 문장의 끝은 뒤 문장 시작에 바짝 붙는다
    }
  } else {
    const s = segs[i], pv = segs[i - 1], nx = segs[i + 1];
    let st = r2(s.start + d);
    let en = r2(s.end + d);
    if (st < 0) { en = r2(en - st); st = 0; }
    if (pv && st < pv.end) st = pv.end;
    if (en < st + MIN) en = r2(st + MIN);
    s.start = st; s.end = en;
    if (nx && nx.start < s.end) nx.start = s.end;
  }

  S.seg = segs[i];
  renderSeg();
  nudgeLabel();
  clearTimeout(NUDGE.timer);
  NUDGE.timer = setTimeout(nudgeSave, 400);
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
    const j = S.cur.segs.findIndex((x) => S.idx < S.cur.segs.length && x === S.cur.segs[S.idx]);
    S.seg = S.cur.segs[S.idx] || S.cur.segs[0];
    nudgeLabel();
  } catch (e) {
    toast("싱크 저장 실패: " + e.message, 4200);
  } finally {
    NUDGE.saving = false;
  }
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
    el.querySelector("i").style.width = Math.max(0, Math.min(100, v * 2)) + "%";
    el.querySelector(".ax-val").textContent = Math.round(v) + "/50";
    el.classList.toggle("low", v < 55);
  });

  const note = $("#mode-note");
  note.classList.remove("show");
  note.innerHTML = "";

  $("#grade").textContent = "";
  $("#verdict").textContent = "";
  const coachEl = $("#coach");
  if (coachEl) {
    try { coachEl.innerHTML = coaching(r, acoustic) || ""; } catch (e) { coachEl.innerHTML = ""; }
    coachEl.hidden = !coachEl.innerHTML.trim();
  }

  MIX.peaks = {};
  $("#mix-hint").textContent = "";
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
const MIX = { playing: "", raf: 0, t0: 0, dur: 1, audios: [], peaks: {}, prog: { ref: 0, me: 0, both: 0 } };

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
  ["ref", "me", "both"].forEach((k) => {
    const p = typeof prog === "number" ? prog : (MIX.prog[k] || 0);
    drawMixRow(k, p);
  });
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
  MIX.prog = { ref: 0, me: 0, both: 0 };
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
    MIX.prog[kind] = p;
    drawMixRow(kind, p);
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

async function openWord(word, ctx, preset) {
  if (!word) return;
  if (!$("#s-play").classList.contains("is-active")) return;
  if (performance.now() < S.lockUntil) return;
  if (SH.phase !== "idle") return;
  const pop = $("#word-pop"); if (!pop) return;
  if (!pop.hidden && WP.word === word) return;
  const seq = ++WP.seq;
  S.word = { word, ctx };
  WP.word = word; WP.ctx = ctx || ""; WP.ko = preset || ""; WP.saved = false;
  $("#wp-word").textContent = word;
  $("#wp-ko").textContent = preset || "…";
  paintWordStar(false);
  pop.hidden = false;
  try {
    const r = await api("/api/words/" + encodeURIComponent(word));
    if (seq !== WP.seq) return;
    const d = (r.definitions || [])[0];
    WP.ko = (r.saved && r.saved.meaning) ? r.saved.meaning
          : (preset || r.ko || (d ? d.def : "") || "항목별 뜻이 없는 숙어입니다");
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

function openScript(vid) {
  SCR.vid = vid || SCR.vid;
  SCR.edit = false;
  show("s-script");
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
  box.innerHTML = `<div class="scr-vt">${segs.length}문장</div>` + segs.map(({ s, i }) => `
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
  box.innerHTML = `<div class="scr-vt">${segs.length}문장 편집</div>` +
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
  refreshReview();
  setCount("note-count", (S.notes.sentences || []).length);
}

/* ================= 추가(+) · 제목 자동 ================= */
let titleTimer = 0;
let titleAuto = "";
function fillLangSelect() {
  const sel = $("#sy-lang");
  if (!sel) return;
  const keep = sel.value;
  sel.innerHTML = LANG_LIST.map((l) => `<option value="${l.code}">${esc(l.name)}</option>`).join("");
  sel.value = keep || learnLang();
}

function openAdd() {
  if (!S.admin) return toast("이 영상은 관리자가 등록합니다", 3000);
  fillLangSelect();
  $("#sheet-add").hidden = false;
  if (!$("#sy-url").value.trim()) setTimeout(() => $("#sy-url").focus(), 80);
}

async function saveBlocks() {
  const url = $("#sy-url").value.trim();
  const title = $("#sy-title").value.trim();
  const native = $("#sy-ko").value;
  const sel = $("#sy-lang");
  const lang = (sel && sel.value) || learnLang();
  const text = ($("#sy-text") && $("#sy-text").value) || "";
  const blocks = text.trim() ? [{ lang, text: text.trim() }] : [];
  if (!url) return toast("쇼츠 주소를 입력해주세요");
  if (!native.trim()) return toast("한국어 스크립트를 입력해주세요");
  if (!blocks.length) return toast("학습 언어 스크립트를 입력해주세요");
  const btn = $("#btn-save-blocks");
  if (btn) btn.disabled = true;
  try {
    const r = await jsonPost("/api/videos", { url, title, native, blocks, lang });
    (r.warnings || []).slice(0, 2).forEach((w) => toast(w, 3200));
    $("#sheet-add").hidden = true;
    $("#sy-ko").value = "";
    if ($("#sy-text")) $("#sy-text").value = "";
    if ($("#sy-url")) $("#sy-url").value = "";
    if ($("#sy-title")) $("#sy-title").value = "";
    await loadVideos();
    toast("영상을 추가했습니다", 1800);
  } catch (e) {
    toast("추가하지 못했습니다: " + e.message, 4000);
  } finally {
    if (btn) btn.disabled = false;
  }
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
  const first = $("#sy-text");
  const text = first ? first.value : "";
  if (!url) return toast("쇼츠 주소를 입력해주세요");
  if (!text.trim()) return toast("학습 언어 스크립트를 입력해주세요");
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
  $("#btn-save-blocks").onclick = saveBlocks;
  const obCta = $("#ob-cta");
  if (obCta) obCta.onclick = obNext;
  const setTab = document.querySelector('.tab[data-tab="s-settings"]');
  if (setTab) setTab.addEventListener("click", () => setTimeout(renderSettings, 0));
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
  const sq = $("#scr-q");
  if (sq) sq.oninput = () => { SCR.q = sq.value; renderScript(); };
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

  if ($("#goals")) {
    $$(".goal").forEach((g) => {
      g.onclick = () => {
        const k = g.dataset.goal || "";
        S.goalSel = S.goalSel === k ? "" : k;
        paintGoals();
      };
    });
    const gn = $("#goal-note");
    if (gn) gn.onclick = () => { S.goalSel = ""; paintGoals(); };
  }
  const bCele = $("#cele-close");
  if (bCele) bCele.onclick = () => { $("#cele").hidden = true; };
  const bCta = $("#cele-cta");
  if (bCta) bCta.onclick = () => {
    $("#cele").hidden = true;
    if (bCta.dataset.kind === "done") {
      const f2 = S.progress && S.progress.focus;
      if (f2 && f2.id) jumpTo(f2.id, 0);
      return;
    }
    const f = S.progress && S.progress.focus;
    if (f && f.id) jumpTo(f.id, 0);
    setTimeout(() => { try { startVerify(); } catch (e) {} }, 460);
  };
  bindStudyTimer();
  bindScrub();
  $$("#sheet-test [data-mode]").forEach((b) => {
    b.onclick = () => beginTest(b.dataset.mode);
  });
  const bNext = $("#vf-next");
  if (bNext) bNext.onclick = () => tqNext();
  const bPh = $("#btn-phrase");
  if (bPh) bPh.onclick = () => { try { openPhraseSheet(); } catch (e) { toast("열지 못했습니다: " + e.message, 3000); } };
  const bPhs = $("#ph-save");
  if (bPhs) bPhs.onclick = savePhraseNow;
  const bAllDk = $("#dk-all");
  if (bAllDk) bAllDk.onclick = () => startStudy(DK.cards.filter((c) => c.is_due));
  const bDkBack = $("#dk-back");
  if (bDkBack) bDkBack.onclick = () => { refreshReview(); show("s-notes"); };
  const bAkX = $("#ak-x");
  if (bAkX) bAkX.onclick = () => { AK.q = []; refreshReview(); show(DK.vid ? "s-deck" : "s-notes"); };
  const bAkFlip = $("#ak-flip");
  if (bAkFlip) bAkFlip.onclick = akFlip;
  const bAkSnd = $("#ak-snd");
  if (bAkSnd) bAkSnd.onclick = () => akAudio(AK.q[AK.i]);
  $$("#ak-grades [data-g]").forEach((b) => { b.onclick = () => akGrade(+b.dataset.g); });
  const akCard = $("#ak-card");
  if (akCard) akCard.onclick = (e) => {
    if (e.target.closest("#ak-hint") || e.target.closest("#ak-hintbox")) return;
    if (!AK.flip && !AK.q[AK.i]) return;
    if (!AK.flip) akFlip();
  };
  const bCd = null;
  const bFl = null;
  const bNudge = $("#btn-nudge");
  if (bNudge) bNudge.onclick = () => { try { nudgeToggle(); } catch (e) { toast("열지 못했습니다: " + e.message, 3200); } };
  $$("#segadj .mode").forEach((b) => {
    b.onclick = () => nudgeMode(b.dataset.mode);
  });
  const bAll = $("#segadj-all");
  if (bAll) bAll.onclick = () => {
    if (NUDGE.mode !== "seg") return;
    NUDGE.all = !NUDGE.all;
    bAll.classList.toggle("on", NUDGE.all);
    nudgeLabel();
  };
  $$("#segadj [data-nudge]").forEach((b) => {
    b.onclick = () => nudgeBy(Number(b.dataset.nudge) || 0);
  });
  $("#btn-back").onclick = () => {
    if (SH.phase !== "idle") {
      closeWave();
      toast("쉐도잉을 취소했습니다");
      return;
    }
    pausePlayer(); stopTick(); show("s-home");
  };
  const vtap = $("#vtap");
  if (vtap) {
    let p0 = null;
    vtap.onclick = null;
    vtap.addEventListener("pointerdown", (e) => {
      if (SH.phase !== "idle") { p0 = null; return; }
      p0 = { x: e.clientX, y: e.clientY, ms: Date.now() };
    });
    vtap.addEventListener("pointerup", (e) => {
      const s0 = p0; p0 = null;
      if (!s0 || SH.phase !== "idle") return;
      const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
      const ms = Date.now() - s0.ms;
      if (Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.4 && ms < 900) {
        slideTo(dx > 0 ? -1 : 1);
        return;
      }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && ms < 500) togglePlay();
    });
    vtap.addEventListener("pointercancel", () => { p0 = null; });
  }
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
  $("#btn-result-close").onclick = () => {
    stopMix(); closeWave(true); show("s-play"); startTick();
    if (S.pendDone) { S.pendDone = false; setTimeout(showDone, 240); }
  };
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


/* ================= v8.4 · 3단계 테스트 ================= */
const TQ = { on: false, mode: "beginner", idx: 0, phase: "q", res: [], item: null, n: 0, revealed: false };
const TQ_NAME = { beginner: "초급 · 어절 블록", inter: "중급 · 빈칸 채우기", recall: "고급 · 백지 테스트" };
const TQ_PASS = 80;

function tqNorm(w) {
  let s = String(w || "").toLowerCase()
    .replace(/[.,!?;:"'\u2019\u201c\u201d\u00bf\u00a1()\[\]]/g, "").trim();
  if (S.cur && (S.cur.lang || "en") !== "en") {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return s;
}
function tqTokens(s) {
  const raw = String((s && (s.en || s.text)) || "").trim();
  return raw ? raw.split(/\s+/).filter(Boolean) : [];
}
function tqShuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = x[i]; x[i] = x[j]; x[j] = t;
  }
  return x;
}
function tqRec() {
  try { return JSON.parse(localStorage.getItem("lc_test_" + ((S.cur && S.cur.id) || "")) || "{}") || {}; }
  catch (e) { return {}; }
}
function tqSave(mode, pct) {
  if (!S.cur) return 0;
  const r = tqRec();
  r[mode] = Math.max(r[mode] || 0, pct);
  try { localStorage.setItem("lc_test_" + S.cur.id, JSON.stringify(r)); } catch (e) {}
  return r[mode];
}

/* 빈칸 개수 : 기본 3개, 길면 최대 5개 */
function tqBlankCount(n) {
  const k = n <= 5 ? 2 : n <= 8 ? 3 : n <= 12 ? 4 : 5;
  return Math.max(1, Math.min(k, n - 1));
}

function tqPickBlanks(toks, k) {
  const cand = [];
  toks.forEach((t, j) => { if (tqNorm(t).length >= 2) cand.push(j); });
  const pool = cand.length >= k ? cand : toks.map((t, j) => j);
  return tqShuffle(pool).slice(0, k).sort((a, b) => a - b);
}

function tqOpenSheet() {
  if (!S.cur) return;
  const rec = tqRec();
  $$("#sheet-test [data-best]").forEach((el) => {
    const v = rec[el.dataset.best];
    el.textContent = v ? v + "점" : "";
    el.classList.toggle("ok", !!v && v >= TQ_PASS);
  });
  const box = $("#sheet-test");
  if (!box) return beginTest("recall");
  box.hidden = false;
}

function tqBuild(mode, i) {
  const seg = S.cur.segs[i] || {};
  const toks = tqTokens(seg);
  const key = tqNorm(toks.join(" "));
  const n = toks.length;
  const k = tqBlankCount(n);
  const blanks = tqPickBlanks(toks, k);
  if (mode === "beginner") {
    const bset = new Set(blanks);
    const used = new Set(blanks.map((j) => tqNorm(toks[j])));
    const pool = [];
    toks.forEach((t, j) => {
      const x = tqNorm(t);
      if (!bset.has(j) && x.length > 1 && !used.has(x)) { used.add(x); pool.push(t); }
    });
    S.cur.segs.forEach((x, kk) => {
      if (kk === i) return;
      tqTokens(x).forEach((t) => {
        const v = tqNorm(t);
        if (v && v.length > 1 && !used.has(v)) { used.add(v); pool.push(t); }
      });
    });
    const nEx = Math.min(2, Math.max(1, 3 - Math.floor(blanks.length / 2)));
    const bank = blanks.map((j) => toks[j])
      .concat(tqShuffle(pool).slice(0, nEx))
      .map((w, idx) => ({ id: "b" + idx, w, used: false }));
    return { toks, key, blanks, bank: tqShuffle(bank), ans: {} };
  }
  return { toks, key, blanks, vals: {}, hinted: {} };
}

function beginTest(mode) {
  if (!S.cur || !S.cur.segs || !S.cur.segs.length) return toast("문장이 없습니다");
  const sh = $("#sheet-test"); if (sh) sh.hidden = true;
  const shs = $("#sheet-script"); if (shs) shs.hidden = true;
  if (SH.phase !== "idle") { try { closeWave(true); } catch (e) {} }
  TQ.on = mode !== "recall";
  TQ.mode = mode; TQ.idx = 0; TQ.phase = "q"; TQ.res = [];
  TQ.n = S.cur.segs.length; TQ.revealed = false;
  TQ.item = TQ.on ? tqBuild(mode, 0) : null;
  const vbD = $(".vbottom"); if (vbD) vbD.classList.remove("done");
  S.doneShown = false;
  VF.on = false; VF.stage = "recall"; VF.typed = {}; VF.n = TQ.n;
  VF.mode = mode;
  document.body.classList.add("vf-focus");
  stopTick(); pausePlayer();
  show("s-verify");
  const feed = $("#vf-feed"); if (feed) feed.hidden = true;
  const tc = $("#tcele"); if (tc) tc.hidden = true;
  $("#vf-title").textContent = TQ_NAME[mode];
  $("#vf-foot").hidden = false;
  const g0 = $("#vfgauge"); if (g0) g0.hidden = false;
  if (!TQ.on) {
    $("#tq-bar").style.width = "0%";
    $("#vf-prog").textContent = "";
    if (g0) g0.hidden = true;
    renderRecall();
  } else {
    renderTq();
  }
}

function tqBeginnerHtml(seg, it) {
  const bset = new Set(it.blanks);
  const parts = it.toks.map((t, j) => {
    if (!bset.has(j)) return `<span>${esc(t)}</span>`;
    const w = it.ans[j];
    const a = tqNorm(t);
    const wid = Math.min(14, Math.max(3, a.length)) * 0.62 + 1.5;
    return `<button class="tq-blnk${w ? " on" : ""}" data-a="${j}" style="width:${wid}em">${w ? esc(w.w) : ""}</button>`;
  }).join(" ");
  const bank = it.bank.map((b) => b.used
    ? `<span class="tq-tile gone">${esc(b.w)}</span>`
    : `<button class="tq-tile" data-t="${b.id}">${esc(b.w)}</button>`).join("");
  const done = Object.keys(it.ans).length;
  return `<div class="tq-ko">${esc(seg.ko || "빈칸에 들어갈 단어를 고르세요")}</div>
    <div class="tq-en" id="tq-en">${parts}</div>
    <div class="tq-bank" id="tq-bank">${bank}</div>`;
}

function tqInterHtml(seg, it) {
  const bset = new Set(it.blanks);
  const parts = it.toks.map((t, j) => {
    if (!bset.has(j)) return `<span>${esc(t)}</span>`;
    const a = tqNorm(t);
    const w = Math.min(14, Math.max(3, a.length)) * 0.62 + 1.7;
    const h = it.hinted[j] ? esc(t.slice(0, 1)) + "___".slice(0, Math.max(0, 3)) : "";
    const ph = it.hinted[j] ? esc(t.slice(0, 1)) + "_".repeat(Math.max(1, Math.min(12, a.length - 1))) : "";
    return `<input class="tq-bl" data-b="${j}" style="width:${w}em" placeholder="${ph}"
      autocapitalize="off" autocomplete="off" spellcheck="false">`;
  }).join(" ");
  return `<div class="tq-ko">${esc(seg.ko || "빈칸을 채우세요")}</div>
    <div class="tq-en" id="tq-en">${parts}</div>
    <div class="tq-tools"><button class="tq-tool" id="tq-hint">힌트 보기</button></div>`;
}

function renderTq() {
  const seg = S.cur.segs[TQ.idx] || {};
  const body = $("#vf-body");
  const feed = $("#vf-feed");
  if (feed) feed.hidden = true;
  const foot = $("#vf-foot"); if (foot) foot.hidden = false;
  const sub = $("#vf-submit");
  if (sub) { sub.disabled = false; sub.textContent = "확인"; sub.onclick = tqCheck; }
  $("#vf-title").textContent = TQ_NAME[TQ.mode];
  $("#vf-prog").textContent = `${TQ.idx + 1}/${TQ.n}`;
  $("#tq-bar").style.width = (TQ.idx / TQ.n) * 100 + "%";
  const gg = $("#vfgauge"); if (gg) gg.hidden = TQ.mode === "recall";
  body.innerHTML = TQ.mode === "beginner" ? tqBeginnerHtml(seg, TQ.item) : tqInterHtml(seg, TQ.item);
  tqBindBody();
  body.scrollTop = 0;
  const f = body.querySelector(".tq-bl");
  if (f) setTimeout(() => { try { f.focus(); } catch (e) {} }, 80);
}

function tqBindBody() {
  const body = $("#vf-body");
  if (!body) return;
  if (TQ.mode === "beginner") {
    body.querySelectorAll("#tq-bank [data-t]").forEach((el) => {
      el.onclick = () => {
        if (TQ.phase !== "q") return;
        const it = TQ.item;
        const tile = it.bank.find((b) => b.id === el.dataset.t);
        if (!tile || tile.used) return;
        const j = it.blanks.find((b) => !it.ans[b]);
        if (j == null) return;
        tile.used = true; it.ans[j] = tile;
        renderTq();
      };
    });
    body.querySelectorAll("#tq-en [data-a]").forEach((el) => {
      el.onclick = () => {
        if (TQ.phase !== "q") return;
        const it = TQ.item;
        const j = +el.dataset.a;
        const t = it.ans[j];
        if (!t) return;
        t.used = false; delete it.ans[j];
        renderTq();
      };
    });
    return;
  }
  body.querySelectorAll(".tq-bl").forEach((el) => {
    el.value = TQ.item.vals[el.dataset.b] || "";
    el.oninput = () => { TQ.item.vals[el.dataset.b] = el.value; };
    el.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); tqCheck(); } };
  });
  const h = $("#tq-hint");
  if (h) h.onclick = () => {
    if (TQ.phase !== "q") return;
    TQ.item.blanks.forEach((j) => { TQ.item.hinted[j] = true; });
    const keep = Object.assign({}, TQ.item.vals);
    renderTq();
    TQ.item.vals = keep;
    $("#vf-body").querySelectorAll(".tq-bl").forEach((el) => {
      el.value = keep[el.dataset.b] || "";
    });
  };
}

function tqCheck() {
  if (!TQ.on || !TQ.item) return;   // 고급 화면에서 남은 핸들러가 불려도 무시
  if (!TQ.on || TQ.phase !== "q") return;
  const seg = S.cur.segs[TQ.idx] || {};
  let ok = true;
  if (TQ.mode === "beginner") {
    TQ.item.blanks.forEach((j) => {
      const a = TQ.item.ans[j];
      if (!a || tqNorm(a.w) !== tqNorm(TQ.item.toks[j])) ok = false;
    });
  } else {
    TQ.item.blanks.forEach((j) => {
      const el = $("#vf-body").querySelector(`.tq-bl[data-b="${j}"]`);
      const v = (el && el.value) || TQ.item.vals[j] || "";
      if (tqNorm(v) !== tqNorm(TQ.item.toks[j])) ok = false;
    });
  }
  TQ.phase = "check";
  TQ.res.push({ i: TQ.idx, ok, ko: seg.ko || "", en: seg.en || seg.text || "" });
  if (TQ.mode === "inter") {
    $("#vf-body").querySelectorAll(".tq-bl").forEach((el) => {
      el.disabled = true;
      const j = +el.dataset.b;
      el.classList.add(tqNorm(el.value) === tqNorm(TQ.item.toks[j]) ? "ok" : "no");
    });
  }
  if (TQ.mode === "beginner") {
    $("#vf-body").querySelectorAll(".tq-blnk").forEach((el) => {
      const j = +el.dataset.a;
      const a = TQ.item.ans[j];
      el.classList.add(a && tqNorm(a.w) === tqNorm(TQ.item.toks[j]) ? "ok" : "no");
    });
  }
  $("#tq-bar").style.width = ((TQ.idx + 1) / TQ.n) * 100 + "%";
  $("#vf-prog").textContent = `${TQ.idx + 1}/${TQ.n}`;
  showTqFeed(ok, seg);
}

function showTqFeed(ok, seg) {
  const feed = $("#vf-feed");
  const foot = $("#vf-foot");
  if (foot) foot.hidden = true;
  if (!feed) return;
  feed.hidden = false;
  feed.classList.toggle("no", !ok);
  const t = $("#vf-feed-t"), sx = $("#vf-feed-s"), next = $("#vf-next");
  if (t) t.textContent = ok ? "정답이에요!" : "아쉬워요";
  if (sx) {
    let en = esc(seg.en || seg.text || "");
    const it = TQ.item;
    if (!ok && it && it.toks && it.blanks) {
      const bset = new Set(it.blanks);
      en = it.toks.map((t, j) => (bset.has(j) ? `<b class="ans">${esc(t)}</b>` : esc(t))).join(" ");
    }
    sx.innerHTML = ok ? esc(seg.ko || "") : `정답 · ${en}`;
  }
  if (next) {
    next.textContent = TQ.idx + 1 >= TQ.n ? "결과 보기" : "다음 문제";
    next.onclick = () => tqNext();
  }
}

function tqNext() {
  const feed = $("#vf-feed"); if (feed) feed.hidden = true;
  if (TQ.idx + 1 >= TQ.n) return tqResult();
  TQ.idx += 1; TQ.phase = "q"; TQ.revealed = false;
  TQ.item = tqBuild(TQ.mode, TQ.idx);
  renderTq();
}

async function tqResult() {
  const okN = TQ.res.filter((r) => r.ok).length;
  const n = TQ.n || 1;
  const pct = Math.round((okN / n) * 100);
  const best = tqSave(TQ.mode, pct);
  const pass = pct >= TQ_PASS;
  TQ.phase = "done";
  $("#vf-foot").hidden = true;
  $("#vf-feed").hidden = true;
  $("#vf-prog").textContent = "";
  const gz = $("#vfgauge"); if (gz) gz.hidden = true;
  $("#vf-title").textContent = TQ_NAME[TQ.mode];
  const upTo = TQ.mode === "beginner" ? "inter" : TQ.mode === "inter" ? "recall" : "beginner";
  const upLab = TQ.mode === "beginner" ? "중급으로 도전" : TQ.mode === "inter" ? "고급으로 도전" : "초급부터 다시";
  $("#vf-body").innerHTML = `
    <div class="tq-hero ${pass ? "ok" : "no"}">
      <div class="tq-score">${pct}<small>점</small></div>
      <div class="tq-hero-tx">
        <b>${pass ? "학습 완료" : "80점이 통과선이에요"}</b>
        <em>${okN} / ${n} 문장 정답${pass && TQ.mode !== "recall" ? " · 다음 난이도로 넘어가 보세요" : ""}</em>
      </div>
    </div>
    <div class="tq-lines">
      ${TQ.res.map((r) => `<div class="tq-line">
        <span class="tq-mark${r.ok ? "" : " no"}">${r.ok ? "\u2713" : "!"}</span>
        <span class="tq-line-b"><span>${esc(r.ko || "")}</span><b>${esc(r.en || "")}</b></span>
      </div>`).join("")}
    </div>
    <div class="tq-acts">
      ${pct >= 100 ? "" : '<button class="btn primary" id="tq-again">다시 풀기</button>'}
      <button class="btn ghost" id="tq-out">닫기</button>
    </div>`;
  const again = $("#tq-again"); if (again) again.onclick = () => beginTest(TQ.mode);
  const out = $("#tq-out"); if (out) out.onclick = () => goHome();
  $("#vf-body").scrollTop = 0;

  // 서버 기록 (초급·중급·고급 모두 암송 판정에 반영)
  try {
    const r = await jsonPost(`/api/videos/${S.cur.id}/test/grade`, {
      mode: TQ.mode, score: pct, ok: okN,
    });
    if (r) {
      if (S.cur) {
        S.cur.complete = !!r.complete;
        S.cur.verify = r.record || S.cur.verify;
        S.cur.medals = r.medals || S.cur.medals;
      }
      loadVideos().catch(() => {});
      loadHome().catch(() => {});
    }
  } catch (e) {}

  if (pass) setTimeout(() => tqCelebrate(pct, okN, n, best), 320);
}

function tqCelebrate(pct, okN, n, best) {
  const box = $("#tcele");
  if (!box || !S.cur) return;
  $("#tcele-num").textContent = pct;
  $("#tcele-t").textContent = "학습 완료";
  $("#tcele-ok").textContent = `${okN} / ${n}`;
  $("#tcele-mode").textContent = TQ_NAME[TQ.mode].split(" · ")[0];
  $("#tcele-best").textContent = best ? best + "점" : pct + "점";
  box.hidden = false;
  $("#tcele-cta").onclick = () => { box.hidden = true; exitVerify(false); };
  const homeBtn = $("#tcele-home");
  if (homeBtn) homeBtn.onclick = () => { box.hidden = true; goHome(); };
  $("#tcele-x").onclick = () => { box.hidden = true; };
}


/* 오늘의 학습 지정 (관리자) — 문서 캡처 단계에서 처리해 카드 열기와 겹치지 않게 한다 */
document.addEventListener("click", async (e) => {
  const b = e.target && e.target.closest ? e.target.closest("[data-pick]") : null;
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const id = b.dataset.pick;
  const cur = (S.videos || []).find((x) => x.id === id) || {};
  const next = !cur.pick;
  b.disabled = true;
  try {
    const r = await fetch("/api/videos/" + encodeURIComponent(id) + "/pick", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pick: next })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    toast(next ? "오늘의 영상으로 설정했습니다" : "오늘의 영상에서 해제했습니다");
    await loadVideos();
    try { await loadHome(); } catch (e2) {}
  } catch (err) {
    LCUtil.logErr("pick", err);
    toast("설정을 저장하지 못했습니다");
  } finally { b.disabled = false; }
}, true);
/* ================= 시작 ================= */
(async function boot() {
  try {
    const h = await api("/api/health");
    S.admin = h.admin === true || (!h.locked && h.mode !== "public");
  } catch { S.admin = true; }
  const railNudge = $("#btn-nudge");
  if (railNudge) railNudge.hidden = !S.admin;
  const railPh = $("#btn-phrase");
  if (railPh) railPh.hidden = !S.admin;
  if (!S.admin) {
    $("#tab-add").hidden = true;
  }
  bind();
  await loadVideos();
  await loadHome();
  refreshReview();
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
  const room = Math.max(160, (st ? st.clientHeight : 720) * 0.90);
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
  if (b) {
    b.textContent = n > 0 ? n + "일째 연속 학습 중" : "오늘의 추천 영상을 확인해보세요!";
    b.classList.toggle("is-zero", n === 0);
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
    const bsb = $("#btn-scr-back");
  if (bsb) bsb.onclick = () => show("s-list");
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

  try {
    if (localStorage.getItem(OB_KEY) !== "1") {
      const wait = document.getElementById("splash") ? 1700 : 500;
      setTimeout(obShow, wait);
    }
  } catch (e) {}
})();
