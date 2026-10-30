/* =========================================================
   Echo · 암기 테스트  v3.4
   드릴 4종(순서/빈칸/듣기/이어말하기) + 최종 암송(음성·짝꿍)
   통과 판정은 서버가 다시 계산한다. 여기서는 화면과 입력만 담당.
   ========================================================= */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = () => window.EchoApp || {};
  const S = () => (window.EchoApp ? window.EchoApp.S : {});
  const esc = (s) => (window.EchoApp ? window.EchoApp.esc(s) : String(s || ""));
  const toast = (m, ms) => window.EchoApp && window.EchoApp.toast(m, ms);

  const META = {
    order: { emoji: "🧩", label: "문장 순서 맞추기", desc: "흩어진 문장을 원래 순서로 배열" },
    cloze: { emoji: "🕳️", label: "빈칸 채우기", desc: "핵심 단어를 직접 입력" },
    listen: { emoji: "👂", label: "듣고 고르기", desc: "구간을 듣고 어떤 문장인지 선택" },
    chain: { emoji: "🔗", label: "이어 말하기", desc: "앞부분만 보고 나머지 말하기" },
    recite: { emoji: "🏆", label: "최종 암기 테스트", desc: "아무것도 안 보고 전체 암송" },
  };
  const ORDER = ["order", "cloze", "listen", "chain", "recite"];

  const ST = {
    kind: null, data: null, order: [], byI: {}, answers: {},
    stopT: 0, stopT2: 0,
    rec: null, listening: false, finalTxt: "", transcript: "",
    mode: "voice", marks: {},
  };

  /* ---------------- 공통 ---------------- */
  function backToPlay() {
    const box = $("#celebrate");
    if (box) box.hidden = true;
    try { S().player && S().player.pauseVideo(); } catch {}
    if (S().cur) { app().show("s-play"); app().startTick(); }
    else app().show("s-home");
  }

  function refresh() {
    try { app().loadHome(); } catch {}
    try { app().loadVideos(); } catch {}
  }

  function applyRecord(r) {
    const cur = S().cur;
    if (!cur) return;
    if (r && r.tests) cur.tests = r.tests;
    if (r && typeof r.complete === "boolean") cur.complete = r.complete;
  }

  function celebrate(o) {
    $("#cel-emoji").textContent = o.emoji || "🏆";
    $("#cel-title").textContent = o.title || "암기 완료!";
    $("#cel-sub").textContent = o.sub || "";
    $("#cel-xp").textContent = o.xp ? `+${o.xp} XP` : "";
    $("#celebrate").hidden = false;
  }

  function testHead(title, prog) {
    $("#test-title").textContent = title;
    $("#test-prog").textContent = prog || "";
  }

  function xpNote(r) {
    const g = r && r.record && r.record.xp_gain;
    return g ? `<div class="tr-xp">+${g} XP · Lv.${r.record.level}</div>` : "";
  }

  function resultBlock(o) {
    return `
      <div class="tr-top ${o.passed ? "ok" : ""}">
        <div class="tr-ring"><b>${Math.round(o.score || 0)}</b><small>점</small></div>
        <div class="tr-info">
          <div class="tr-verdict">${o.passed ? "통과" : "조금 더"}</div>
          <div class="tr-sub">${esc(o.sub || "")}</div>
        </div>
      </div>
      ${o.extra || ""}
      ${o.rows || ""}
      <div class="test-actions">
        <button class="btn primary" data-act="again">다시 하기</button>
        <button class="btn ghost" data-act="close">학습으로 돌아가기</button>
      </div>`;
  }

  function bindResult() {
    $$("#test-body [data-act]").forEach((b) => {
      b.onclick = () => {
        if (b.dataset.act === "again") openKind(ST.kind);
        else backToPlay();
      };
    });
  }

  /* ---------------- 메뉴 ---------------- */
  async function openMenu() {
    const cur = S().cur;
    if (!cur) return toast("먼저 학습할 영상을 열어주세요");
    $("#more-list").innerHTML = `<div class="test-loading">불러오는 중…</div>`;
    $("#sheet-more").hidden = false;
    try {
      const v = await app().api("/api/videos/" + cur.id);
      if (v && v.id === cur.id) { cur.tests = v.tests || {}; cur.complete = !!v.complete; }
    } catch {}
    const t = cur.tests || {};
    const rows = ORDER.map((k) => {
      const m = META[k], r = t[k];
      const ok = !!(r && r.ok);
      const sc = r && r.score ? Math.round(r.score) : null;
      const state = ok ? `<span class="mr-chip ok">통과</span>`
        : sc !== null ? `<span class="mr-chip">${sc}점</span>` : `<span class="mr-chip dim">미시도</span>`;
      return `<button class="mrow ${ok ? "ok" : ""} ${k === "recite" ? "final" : ""}" data-kind="${k}">
          <span class="mr-e">${m.emoji}</span>
          <span class="mr-b"><b>${m.label}</b><em>${k === "recite" ? "문장 모두 80점 이상이면 암기 완료" : m.desc}</em></span>
          ${state}
        </button>`;
    }).join("");

    $("#more-list").innerHTML = rows + `
      <div class="mr-sep"></div>
      <button class="mrow" data-act="script">
        <span class="mr-e">✏️</span>
        <span class="mr-b"><b>대본 · 구간 편집</b><em>문장과 타이밍을 직접 고칩니다</em></span>
        <span class="mr-chip dim">›</span>
      </button>
      <button class="mrow" data-act="reset">
        <span class="mr-e">↺</span>
        <span class="mr-b"><b>테스트 기록 초기화</b><em>이 쇼츠의 드릴·암송 통과를 지웁니다</em></span>
        <span class="mr-chip dim">›</span>
      </button>`;

    $$("#more-list .mrow[data-kind]").forEach((b) => {
      b.onclick = () => openKind(b.dataset.kind);
    });
    $("#more-list [data-act='script']").onclick = openScript;
    $("#more-list [data-act='reset']").onclick = resetTests;
  }

  /* ---------------- 화면 열기 ---------------- */
  async function openKind(kind) {
    const cur = S().cur;
    if (!cur) return;
    const box = $("#celebrate");
    if (box) box.hidden = true;
    $("#sheet-more").hidden = true;

    ST.kind = kind;
    ST.data = null;
    ST.order = [];
    ST.answers = {};
    ST.transcript = "";
    ST.finalTxt = "";
    ST.listening = false;
    ST.marks = {};
    ST.mode = "voice";

    testHead(META[kind] ? META[kind].label : "암기 테스트", "");
    $("#test-body").innerHTML = `<div class="test-loading">문제를 만드는 중…</div>`;
    app().show("s-test");
    app().stopTick();
    try { S().player && S().player.pauseVideo(); } catch {}

    if (kind === "recite") return renderRecite();

    let d;
    try { d = await app().api(`/api/videos/${cur.id}/drills?kind=${kind}`); }
    catch (e) {
      $("#test-body").innerHTML = `<div class="test-empty">문제를 불러오지 못했습니다<br /><em>${esc(e.message)}</em></div>`;
      return;
    }
    ST.data = d;
    if (!d.usable) {
      $("#test-body").innerHTML = `<div class="test-empty">${esc(d.note || "이 테스트를 만들 수 없습니다")}</div>`;
      return;
    }
    if (kind === "order") renderOrder(d);
    if (kind === "cloze") renderCloze(d);
    if (kind === "listen") renderListen(d);
    if (kind === "chain") renderChain(d);
  }

  /* ---------------- 1. 순서 ---------------- */
  function renderOrder(d) {
    ST.order = [];
    ST.byI = {};
    d.items.forEach((it) => { ST.byI[it.i] = it.text; });
    testHead(META.order.label, `문장 ${d.items.length}개`);

    $("#test-body").innerHTML = `
      <p class="test-desc">문장을 <b>말이 되는 순서</b>대로 눌러 쌓으세요. 아래 칸의 문장을 다시 누르면 빠집니다.</p>
      <div class="ord-ans" id="ord-ans"></div>
      <div class="ord-pool" id="ord-pool">
        ${d.shuffled.map((i) => `<button class="ord-item" data-i="${i}">${esc(ST.byI[i])}</button>`).join("")}
      </div>
      <button class="btn primary" id="ord-submit">채점하기</button>`;

    $$("#ord-pool .ord-item").forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        if (ST.order.includes(i)) return;
        ST.order.push(i);
        paintOrder();
      };
    });
    $("#ord-submit").onclick = () => {
      if (ST.order.length !== d.items.length) return toast("문장을 모두 배치해주세요");
      postCheck(ST.order.slice());
    };
    paintOrder();
  }

  function paintOrder() {
    const ans = $("#ord-ans");
    if (!ans) return;
    const total = (ST.data && ST.data.items.length) || 0;
    ans.innerHTML = ST.order.length
      ? ST.order.map((i, n) => `<button class="ord-pick" data-i="${i}"><b>${n + 1}</b>${esc(ST.byI[i])}</button>`).join("")
      : `<div class="ord-ph">여기에 순서대로 쌓입니다 (0 / ${total})</div>`;
    $$("#ord-pool .ord-item").forEach((b) => {
      b.classList.toggle("used", ST.order.includes(+b.dataset.i));
    });
    $$("#ord-ans .ord-pick").forEach((b) => {
      b.onclick = () => {
        ST.order = ST.order.filter((x) => x !== +b.dataset.i);
        paintOrder();
      };
    });
  }

  /* ---------------- 2. 빈칸 ---------------- */
  function renderCloze(d) {
    testHead(META.cloze.label, `빈칸 ${d.total_blanks}개`);
    const body = d.items.map((it) => {
      let k = 0;
      const line = it.parts.map((p) => {
        if (p.blank) {
          const n = k++;
          return `<span class="cz-b"><input class="cz-in" data-i="${it.i}" data-k="${n}" placeholder="${esc(p.hint || "")}" autocomplete="off" autocapitalize="off" spellcheck="false" />${esc(p.tail || "")}</span>`;
        }
        return `<span class="cz-w">${esc(p.text || "")}</span>`;
      }).join(" ");
      return `<div class="cz-row"><div class="cz-n">${it.i + 1}</div><div class="cz-line">${line}</div></div>`;
    }).join("");

    $("#test-body").innerHTML = `
      <p class="test-desc">문장을 읽고 빈칸에 <b>영어 단어</b>를 넣으세요. 힌트는 첫 글자입니다.</p>
      ${body}
      <button class="btn primary" id="cz-submit">채점하기</button>`;
    $$("#test-body .cz-in").forEach((inp, n, all) => {
      inp.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const nx = all[n + 1];
        if (nx) nx.focus(); else $("#cz-submit").click();
      };
    });
    const first = $("#test-body .cz-in");
    if (first) first.focus();
    $("#cz-submit").onclick = () => {
      const map = {};
      $$("#test-body .cz-in").forEach((inp) => {
        const i = +inp.dataset.i;
        (map[i] = map[i] || []).push(inp.value.trim());
      });
      postCheck(Object.keys(map).map((i) => ({ i: +i, answers: map[i] })));
    };
  }

  /* ---------------- 3. 듣기 ---------------- */
  function renderListen(d) {
    testHead(META.listen.label, `${d.items.length}문제`);
    $("#test-body").innerHTML = `
      <p class="test-desc">▶ 를 눌러 구간을 듣고, 들린 문장을 고르세요. 영상은 화면 뒤에서 재생됩니다.</p>
      ${d.items.map((it, n) => `
        <div class="ls-row" data-i="${it.i}">
          <div class="ls-top">
            <button class="ls-play" data-start="${it.start}" data-end="${it.end}">▶ <span>${n + 1}번 듣기</span></button>
            <span class="ls-state" data-st="${it.i}">—</span>
          </div>
          <div class="ls-opts">
            ${it.options.map((o) => `<button class="ls-opt" data-i="${it.i}" data-t="${esc(o)}">${esc(o)}</button>`).join("")}
          </div>
        </div>`).join("")}
      <button class="btn primary" id="ls-submit">채점하기</button>`;

    $$("#test-body .ls-play").forEach((b) => {
      b.onclick = () => playClip(+b.dataset.start, +b.dataset.end);
    });
    $$("#test-body .ls-opt").forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        ST.answers[i] = b.dataset.t;
        $$(`#test-body .ls-opt[data-i="${i}"]`).forEach((x) => x.classList.toggle("on", x === b));
        const st = $(`#test-body .ls-state[data-st="${i}"]`);
        if (st) st.textContent = "선택됨";
      };
    });
    $("#ls-submit").onclick = () => {
      const items = ST.data.items;
      if (Object.keys(ST.answers).length < items.length) return toast("아직 고르지 않은 문제가 있습니다");
      postCheck(items.map((it) => ({ i: it.i, ok: ST.answers[it.i] === it.answer })));
    };
  }

  function playClip(start, end, onDone) {
    const p = S().player;
    if (!p || !S().ready) return toast("플레이어를 준비하는 중입니다");
    clearTimeout(ST.stopT);
    clearTimeout(ST.stopT2);
    try { p.seekTo(Math.max(0, start - 0.12), true); p.playVideo(); } catch {}
    const ms = Math.max(700, (end - start + 0.4) * 1000);
    ST.stopT = setTimeout(() => { try { p.pauseVideo(); } catch {} ; if (onDone) onDone(); }, ms);
    // 일부 브라우저는 seek 직후 재생이 무시된다 — 0.25초 뒤 한 번 더
    ST.stopT2 = setTimeout(() => { try { if (p.getPlayerState() !== 1) p.playVideo(); } catch {} }, 250);
  }

  /* ---------------- 4. 이어 말하기 ---------------- */
  function renderChain(d) {
    testHead(META.chain.label, `${d.items.length}문장`);
    $("#test-body").innerHTML = `
      <p class="test-desc">앞부분만 보고 <b>나머지 문장</b>을 입력하거나 말하세요. 80점 이상이면 통과입니다.</p>
      ${d.items.map((it, n) => `
        <div class="ch-row" data-i="${it.i}">
          <div class="ch-top"><b>${n + 1}</b><span class="ch-head">${esc(it.head)}</span>
            <button class="ch-mic" data-i="${it.i}" title="말해서 채우기">🎤</button></div>
          <textarea class="ch-in" data-i="${it.i}" rows="2" placeholder="나머지 문장을 이어서…" spellcheck="false"></textarea>
        </div>`).join("")}
      <button class="btn primary" id="ch-submit">채점하기</button>`;

    $$("#test-body .ch-in").forEach((ta) => {
      ta.oninput = () => { ta.dataset.touched = "1"; };
    });
    $$("#test-body .ch-mic").forEach((b) => {
      b.onclick = () => voiceInto($(`#test-body .ch-in[data-i="${b.dataset.i}"]`), b);
    });
    $("#ch-submit").onclick = () => {
      const rows = $$("#test-body .ch-in").map((ta) => ({ i: +ta.dataset.i, said: ta.value.trim() }));
      if (!rows.some((r) => r.said)) return toast("한 문장 이상 입력해주세요");
      postCheck(rows);
    };
  }

  /* ---------------- 채점 ---------------- */
  async function postCheck(answers) {
    const cur = S().cur;
    if (!cur) return;
    const btn = $("#test-body .btn.primary");
    if (btn) { btn.disabled = true; btn.textContent = "채점 중…"; }
    try {
      const r = await app().jsonPost(`/api/videos/${cur.id}/drills/${ST.kind}/check`, { answers });
      applyRecord(r);
      renderDrillResult(r);
      refresh();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "채점하기"; }
      toast("채점 실패: " + e.message, 4200);
    }
  }

  function renderDrillResult(r) {
    const kind = ST.kind;
    let rows = "";
    if (kind === "order") {
      rows = `<div class="tr-list">${(ST.data.items || []).map((it, n) =>
        `<div class="tr-li"><b>${n + 1}</b><span>${esc(it.text)}</span></div>`).join("")}</div>`;
    } else if (kind === "listen") {
      const byI = {};
      (r.rows || []).forEach((x) => { byI[x.i] = x.ok; });
      rows = `<div class="tr-list">${ST.data.items.map((it) => {
        const ok = !!byI[it.i];
        return `<div class="tr-li ${ok ? "ok" : "no"}">
          <span class="tr-mk">${ok ? "✓" : "✕"}</span>
          <span>${esc(it.answer)}</span></div>`;
      }).join("")}</div>`;
    } else if (kind === "cloze") {
      rows = `<div class="tr-list">${(r.rows || []).map((x) =>
        `<div class="tr-li ${x.ok === x.need ? "ok" : "no"}">
           <span class="tr-mk">${x.ok}/${x.need}</span><span>${x.i + 1}번 문장</span></div>`).join("")}</div>`;
    } else if (kind === "chain") {
      rows = `<div class="tr-list">${(r.rows || []).map((x) =>
        `<div class="tr-li ${x.pass ? "ok" : "no"}">
           <span class="tr-mk">${Math.round(x.score)}</span><span>${x.i + 1}번 문장</span></div>`).join("")}</div>`;
    }

    const sub = kind === "order" || kind === "listen"
      ? (r.passed ? "완벽합니다" : `${r.hit || 0} / ${r.total || 0} 통과`)
      : (r.passed ? "모든 문장 통과!" : `문장 ${r.hit || 0} / ${r.total || 0} 통과`);

    $("#test-body").innerHTML = resultBlock({ score: r.score, passed: r.passed, sub, extra: xpNote(r), rows });
    bindResult();

    if (r.record && r.record.first_clear && !r.passed) toast(`+${r.record.xp_gain} XP`);
    if (r.record && r.record.xp_gain && r.passed) {
      toast(`통과! +${r.record.xp_gain} XP`);
    }
    if (!r.passed) {
      const wrong = (r.rows || []).filter((x) => (x.pass === false) || (x.ok === false) || (x.ok === 0));
      if (wrong.length) toast("통과하지 못한 문장은 다시 들어보세요", 3200);
    }
  }

  /* ---------------- 5. 최종 암송 ---------------- */
  function renderRecite() {
    const cur = S().cur;
    const n = cur.n || (cur.segs || []).length;
    const best = (cur.tests && cur.tests.recite) || null;
    testHead(META.recite.label, `문장 ${n}개`);

    $("#test-body").innerHTML = `
      <p class="test-desc">아무것도 보지 않고 <b>처음부터 끝까지</b> 말해보세요. 문장 ${n}개가 모두 80점 이상이면 이 쇼츠는 <b>암기 완료</b>가 됩니다.</p>
      ${best && best.ok ? `<div class="tr-badge">🏅 이미 통과 · 최고 ${Math.round(best.score)}점</div>` : ""}
      <div class="rc-modes">
        <button class="rc-mode on" data-m="voice">🎤 말해서 채점</button>
        <button class="rc-mode" data-m="self">🤝 짝꿍 채점</button>
      </div>
      <div id="rc-pane"></div>`;

    $$("#test-body .rc-mode").forEach((b) => {
      b.onclick = () => {
        if (ST.listening) stopSR();
        ST.mode = b.dataset.m;
        $$("#test-body .rc-mode").forEach((x) => x.classList.toggle("on", x === b));
        renderRecitePane();
      };
    });
    renderRecitePane();
  }

  function renderRecitePane() {
    const pane = $("#rc-pane");
    if (!pane) return;
    if (ST.mode === "self") {
      const segs = S().cur.segs || [];
      ST.marks = {};
      pane.innerHTML = `
        <p class="test-desc sm">옆 사람이 들으면서 문장마다 통과/실패를 눌러주세요.</p>
        <div class="rc-self">${segs.map((s, i) => `
          <div class="rs-row" data-i="${i}">
            <span class="rs-n">${i + 1}</span>
            <span class="rs-en">${esc(s.en || s.text || "")}</span>
            <button class="rs-btn" data-i="${i}" data-ok="1">통과</button>
          </div>`).join("")}</div>
        <button class="btn primary" id="rs-submit">채점 완료</button>`;
      $$("#rc-pane .rs-btn").forEach((b) => {
        b.onclick = () => {
          const i = +b.dataset.i;
          ST.marks[i] = !ST.marks[i];
          const row = $(`.rs-row[data-i="${i}"]`);
          row.classList.toggle("ok", !!ST.marks[i]);
          b.textContent = ST.marks[i] ? "통과 ✓" : "통과";
        };
      });
      $("#rs-submit").onclick = submitSelf;
      return;
    }

    const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    pane.innerHTML = `
      <div class="rc-micbox">
        <button class="rc-mic" id="rc-mic">${ST.listening ? "■ 중지" : "🎤 시작"}</button>
        <div class="rc-hint" id="rc-hint">${supported
          ? "마이크를 누르고 전체 대본을 이어서 말하세요. 문장부호가 없어도 단어로 맞춰 채점합니다."
          : "이 브라우저는 음성인식을 지원하지 않습니다. 아래 칸에 직접 입력해 채점하세요."}</div>
      </div>
      <textarea class="rc-text" id="rc-text" rows="6" spellcheck="false" placeholder="인식된 문장이 여기에 쌓입니다. 직접 입력해도 됩니다.">${esc(ST.transcript)}</textarea>
      <button class="btn primary" id="rc-submit">암송 채점</button>
      <button class="btn ghost" id="rc-clear">지우고 다시</button>`;

    $("#rc-mic").onclick = () => { if (ST.listening) stopSR(); else startSR(); };
    $("#rc-clear").onclick = () => {
      stopSR();
      ST.transcript = ""; ST.finalTxt = "";
      const ta = $("#rc-text"); if (ta) { ta.value = ""; ta.focus(); }
    };
    $("#rc-text").oninput = (e) => { ST.transcript = e.target.value; };
    $("#rc-submit").onclick = submitRecite;
    if (ST.listening) startSRUI();
  }

  function srCtor() { return window.SpeechRecognition || window.webkitSpeechRecognition; }

  function startSRUI() {
    const b = $("#rc-mic");
    if (!b) return;
    b.textContent = "■ 중지";
    b.classList.add("on");
    const h = $("#rc-hint");
    if (h) h.textContent = "듣는 중… 말이 끝나면 잠시 뒤 다시 켜집니다. 끝났으면 ■ 를 누르세요.";
  }

  function startSR() {
    const SR = srCtor();
    if (!SR) return toast("이 브라우저는 음성인식을 지원하지 않습니다");
    try { ST.rec = new SR(); } catch { return toast("음성인식을 시작할 수 없습니다"); }
    const r = ST.rec;
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    const ta = $("#rc-text");
    ST.finalTxt = (ta ? ta.value : ST.transcript) || "";
    if (ST.finalTxt && !/\s$/.test(ST.finalTxt)) ST.finalTxt += " ";
    ST.listening = true;

    r.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) ST.finalTxt += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      ST.transcript = (ST.finalTxt + interim).replace(/\s+/g, " ").trim();
      if (ta) { ta.value = ST.transcript; ta.scrollTop = ta.scrollHeight; }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        ST.listening = false;
        toast("마이크 권한을 허용해주세요", 3600);
        setMicOff();
      } else if (e.error === "no-speech") {
        /* 무음은 무시 — onend 에서 다시 시작 */
      }
    };
    r.onend = () => {
      if (!ST.listening) return setMicOff();
      try { r.start(); } catch { setMicOff(); }
    };
    try { r.start(); } catch {}
    startSRUI();
  }

  function stopSR() {
    ST.listening = false;
    try { ST.rec && ST.rec.stop(); } catch {}
    ST.rec = null;
    const b = $("#rc-mic");
    if (b) { b.textContent = "🎤 시작"; b.classList.remove("on"); }
    const h = $("#rc-hint");
    if (h) h.textContent = "녹음이 끝났습니다. 내용을 확인하고 암송 채점을 누르세요.";
    const ta = $("#rc-text");
    if (ta) ST.transcript = ta.value;
  }

  function setMicOff() {
    const b = $("#rc-mic");
    if (b) { b.textContent = "🎤 시작"; b.classList.remove("on"); }
    const h = $("#rc-hint");
    if (h) h.textContent = "다시 말하려면 마이크를 누르세요.";
  }

  async function submitRecite() {
    const cur = S().cur;
    if (!cur) return;
    const ta = $("#rc-text");
    const said = (ta ? ta.value : ST.transcript || "").trim();
    if (!said) return toast("말한 내용이 없습니다. 마이크를 누르고 말해보세요");
    stopSR();
    const btn = $("#rc-submit");
    if (btn) { btn.disabled = true; btn.textContent = "채점 중…"; }
    try {
      const r = await app().jsonPost(`/api/videos/${cur.id}/recite/check`, { said });
      applyRecord(r);
      renderReciteResult(r);
      refresh();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "암송 채점"; }
      toast("채점 실패: " + e.message, 4200);
    }
  }

  async function submitSelf() {
    const cur = S().cur;
    if (!cur) return;
    const n = (cur.segs || []).length;
    const marks = [];
    for (let i = 0; i < n; i++) marks.push(!!ST.marks[i]);
    const okN = marks.filter(Boolean).length;
    if (okN < n && !confirm(`통과 ${okN} / ${n} 입니다.\n\n아직 통과하지 않은 문장이 있습니다. 이대로 채점할까요?`)) return;
    try {
      const r = await app().jsonPost(`/api/videos/${cur.id}/recite/self`, { marks });
      applyRecord(r);
      renderReciteResult({ score: r.score, passed: r.passed, rows: [],
        passed_count: okN, total: n, record: r.record, complete: r.complete });
      refresh();
    } catch (e) { toast("채점 실패: " + e.message, 4200); }
  }

  function renderReciteResult(r) {
    const rows = (r.rows || []).map((x) => `
      <div class="tr-li ${x.pass ? "ok" : "no"}">
        <span class="tr-mk">${x.pass ? "✓" : Math.round(x.score)}</span>
        <span class="tr-said"><b>${esc(x.expected)}</b>${x.said ? `<em>${esc(x.said)}</em>` : `<em>인식되지 않음</em>`}</span>
      </div>`).join("");

    const sub = r.passed
      ? `${r.passed_count || 0} / ${r.total || 0} 문장 통과`
      : `${r.passed_count || 0} / ${r.total || 0} 문장 통과 · 실패한 문장을 다시 확인하세요`;

    $("#test-body").innerHTML = resultBlock({
      score: r.score, passed: r.passed, sub,
      extra: xpNote(r) + (r.passed ? `<div class="tr-badge">🏆 이 쇼츠 암기 완료</div>` : ""),
      rows: rows ? `<div class="tr-list">${rows}</div>` : "",
    });
    bindResult();

    if (r.passed) {
      const g = (r.record && r.record.xp_gain) || 0;
      celebrate({
        emoji: "🏆",
        title: "암기 완료!",
        sub: `「${S().cur ? S().cur.title : ""}」 ${r.total || 0}문장을 통째로 외웠습니다`,
        xp: g,
      });
    } else {
      toast("아직 통과하지 못한 문장이 있습니다", 3200);
    }
  }

  /* ---------------- 대본 편집 ---------------- */
  async function openScript() {
    const cur = S().cur;
    if (!cur) return;
    $("#sheet-more").hidden = true;
    testHead("대본 · 구간 편집", "");
    $("#test-body").innerHTML = `<div class="test-loading">대본을 불러오는 중…</div>`;
    app().show("s-test");
    app().stopTick();
    try { S().player && S().player.pauseVideo(); } catch {}
    let d;
    try { d = await app().api(`/api/videos/${cur.id}/script`); }
    catch (e) { $("#test-body").innerHTML = `<div class="test-empty">대본을 불러오지 못했습니다<br /><em>${esc(e.message)}</em></div>`; return; }

    $("#test-body").innerHTML = `
      <p class="test-desc">문장과 구간을 마크다운으로 고칩니다. <code>## 0:04-0:07.5</code> 형식을 지켜주세요.</p>
      <textarea class="md-edit" id="md-edit" spellcheck="false"></textarea>
      <div class="md-help" id="md-warn" hidden></div>
      <button class="btn primary" id="md-save">저장</button>
      <button class="btn ghost" id="md-cancel">닫기</button>`;
    $("#md-edit").value = d.markdown || "";

    $("#md-save").onclick = async () => {
      const md = $("#md-edit").value.trim();
      if (!md) return toast("대본이 비어 있습니다");
      const b = $("#md-save");
      b.disabled = true; b.textContent = "저장 중…";
      try {
        const r = await app().api(`/api/videos/${cur.id}/script`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: md }),
        });
        cur.segs = r.segs; cur.n = r.segs.length; cur.title = r.title || cur.title;
        $("#p-title").textContent = cur.title;
        toast(`저장했습니다 · 문장 ${r.segs.length}개`);
        refresh();
        backToPlay();
      } catch (e) {
        b.disabled = false; b.textContent = "저장";
        const w = $("#md-warn");
        w.hidden = false; w.textContent = e.message;
      }
    };
    $("#md-cancel").onclick = backToPlay;
  }

  async function resetTests() {
    const cur = S().cur;
    if (!cur) return;
    if (!confirm("이 쇼츠의 드릴·암송 통과 기록을 지울까요?\n\n문장 채점 기록은 남습니다.")) return;
    try {
      await app().api("/api/videos/" + cur.id + "/tests", { method: "DELETE" });
      cur.tests = {}; cur.complete = false;
      toast("테스트 기록을 초기화했습니다");
      refresh();
      openMenu();
    } catch (e) { toast("초기화 실패: " + e.message, 4000); }
  }

  /* ---------------- 붙이기 ---------------- */
  function bindGlobal() {
    const x = $("#btn-test-close");
    if (x) x.onclick = backToPlay;
    const ok = $("#cel-ok");
    if (ok) ok.onclick = () => { $("#celebrate").hidden = true; };
    const cel = $("#celebrate");
    if (cel) cel.onclick = (e) => { if (e.target === cel) cel.hidden = true; };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#s-test").classList.contains("is-active")) backToPlay();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindGlobal);
  else bindGlobal();

  window.EchoTests = { openMenu, openKind, backToPlay, openScript };
})();
