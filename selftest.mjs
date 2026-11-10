/**
 * Langclip 프런트 셀프테스트 (헤드리스 Node)
 *   node selftest.mjs
 *
 * 브라우저 없이 util→player→scoring→app→sync 를 최소 DOM 스텁 위에서 로드하고,
 *  - 로드 시 예외가 없는지
 *  - 테스트 모드 전이(초급/중급/고급)에서 제출 버튼 핸들러가 올바른지
 *    (v8.14.7 에서 실제로 깨졌던 지점)
 *  - logErr 이 동작하는지
 * 를 검사한다. 외부 의존성 없음.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(HERE, "static");

function mkEl(tag = "div") {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeName: String(tag).toUpperCase(),
    children: [],
    childNodes: [],
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    attributes: {},
    textContent: "",
    innerText: "",
    innerHTML: "",
    value: "",
    hidden: false,
    checked: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    clientWidth: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    offsetTop: 0,
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    paused: true,
    src: "",
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() {},
    insertBefore(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
    focus() {},
    blur() {},
    click() { if (typeof this.onclick === "function") this.onclick({}); },
    closest() { return null; },
    contains() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementsByTagName() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    getContext() { return null; },
    play() { return Promise.resolve(); },
    pause() {},
    load() {},
    scrollIntoView() {},
    animate() { return { cancel() {}, finished: Promise.resolve() }; },
  };
  return el;
}

const body = mkEl("body");
const doc = {
  readyState: "loading",          // 자동 wire() 를 막는다 (테스트가 직접 호출)
  body,
  head: mkEl("head"),
  documentElement: mkEl("html"),
  scrollingElement: body,
  hidden: false,
  visibilityState: "visible",
  title: "",
  cookie: "",
  createElement: mkEl,
  createTextNode: (t) => ({ textContent: t }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  getElementsByClassName: () => [],
  addEventListener() {},
  removeEventListener() {},
};

const __calls = [];
const store = new Map();
const sandbox = {
  console: {
    log: (...a) => console.log(...a),
    warn: (...a) => console.warn(...a),
    error: (...a) => console.error(...a),
    info: () => {},
    debug: () => {},
  },
  document: doc,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  },
  sessionStorage: {
    getItem: () => null, setItem() {}, removeItem() {}, clear() {},
  },
  location: { href: "http://localhost/", origin: "http://localhost", pathname: "/", search: "", hash: "", reload() {}, assign() {} },
  navigator: {
    userAgent: "node-selftest",
    language: "ko-KR",
    languages: ["ko-KR"],
    maxTouchPoints: 0,
    serviceWorker: { register: () => Promise.resolve() },
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("no mic in selftest")), enumerateDevices: () => Promise.resolve([]) },
    clipboard: { writeText: () => Promise.resolve() },
  },
  screen: { width: 390, height: 844, orientation: { type: "portrait-primary", addEventListener() {} } },
  performance: { now: () => Date.now(), mark() {}, measure() {}, getEntriesByName: () => [] },
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: (url, opt) => {
    __calls.push({ url: String(url), opt });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve("") });
  },
  Audio: function Audio() { return mkEl("audio"); },
  Image: function Image() { return mkEl("img"); },
  MediaRecorder: function MediaRecorder() {
    return { state: "inactive", start() { this.state = "recording"; }, stop() {}, addEventListener() {}, ondataavailable: null, onstop: null };
  },
  Blob: class Blob { constructor(parts, o) { this.parts = parts; this.type = (o && o.type) || ""; this.size = 0; } },
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
  matchMedia: () => ({ matches: false, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  getComputedStyle: () => ({ getPropertyValue: () => "" }),
  alert: () => {},
  confirm: () => true,
  prompt: () => null,
  scrollTo: () => {},
  innerWidth: 390,
  innerHeight: 844,
  devicePixelRatio: 2,
  isSecureContext: false,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
sandbox.top = sandbox;
sandbox.parent = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.dispatchEvent = () => true;


sandbox.__calls = __calls;
const ctx = vm.createContext(sandbox);
const results = [];
const ok = (cond, msg, extra) => results.push({ ok: !!cond, msg, extra });

const FILES = ["util.js", "player.js", "scoring.js", "app.js", "sync.js"];
for (const f of FILES) {
  const code = fs.readFileSync(path.join(STATIC, f), "utf8");
  try {
    new vm.Script(code, { filename: f }).runInContext(ctx);
    results.push({ ok: true, msg: `load ${f}` });
  } catch (e) {
    results.push({ ok: false, msg: `load ${f}`, extra: e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e) });
  }
}

const asym = () => {
  try {
    return new vm.Script(`
      (function () {
        const out = [];
        const ok = (c, m, x) => out.push({ ok: !!c, msg: m, extra: x || "" });

        // --- util
        ok(typeof LCUtil === "object", "LCUtil 존재");
        ok(LCUtil.esc("<a&b>") === "&lt;a&amp;b&gt;", "esc 이스케이프");
        ok(typeof LCUtil.logErr === "function", "logErr 존재");

        // --- 필수 함수가 로드되었는지 (분할 경계 확인)
        ["renderSeg", "onTick", "selectSeg", "playFrom", "togglePlay", "step"].forEach((n) => {
          ok(typeof globalThis[n] === "function" || typeof eval("typeof " + n) !== "undefined", "player: " + n);
        });
        ["drawWave", "onShadowBtn", "submitRecall", "renderVerifyResult"].forEach((n) => {
          ok(eval("typeof " + n) === "function", "scoring: " + n);
        });
        ["show", "beginTest"].forEach((n) => {
          ok(eval("typeof " + n) === "function", "app: " + n);
        });

        // --- 테스트 모드 전이 (v8.14.7 회귀 지점)
        S.cur = { id: "selftest", segs: [{ en: "one two", ko: "하나 둘" }, { en: "three four", ko: "셋 넷" }] };

        beginTest("beginner");
        const h1 = $("#vf-submit").onclick;
        ok(TQ.on === true, "beginner: TQ.on=true");
        ok(TQ.mode === "beginner", "beginner: mode");
        ok(String($("#vf-body").innerHTML).length > 0, "beginner: 화면 렌더");
        ok(typeof h1 === "function", "beginner: 제출 핸들러 바인딩");
        ok(h1 && h1.name !== "submitRecall", "beginner: 백지 핸들러가 아님", h1 && h1.name);

        beginTest("inter");
        const h2 = $("#vf-submit").onclick;
        ok(TQ.mode === "inter", "inter: mode");
        ok(h2 && h2.name !== "submitRecall", "inter: 백지 핸들러가 아님", h2 && h2.name);

        beginTest("recall");
        const h3 = $("#vf-submit").onclick;
        ok(TQ.on === false, "recall: TQ.on=false");
        ok(TQ.mode === "recall", "recall: mode");
        ok(h3 && h3.name === "submitRecall", "recall: submitRecall 바인딩", h3 && h3.name);

        beginTest("beginner");
        const h4 = $("#vf-submit").onclick;
        ok(h4 && h4.name !== "submitRecall", "recall 뒤 beginner: 백지 핸들러 복원", h4 && h4.name);
        ok(h4 === h1, "beginner: 사이클 간 핸들러 동일");

        // --- logErr
        const before = __calls.length;
        LCUtil.logErr("selftest", new Error("boom"));
        ok(LCUtil.errors.length === 1, "logErr: 로컬 링버퍼 기록");
        ok(__calls.length === before + 1, "logErr: 서버 전송 시도", __calls.length - before);
        ok(__calls[__calls.length - 1].url.indexOf("/api/client_log") >= 0, "logErr: 엔드포인트");
        const e2 = new Error("dup");
        LCUtil.logErr("dupchk", e2);
        const c1 = __calls.length;
        LCUtil.logErr("dupchk", e2);
        ok(__calls.length === c1, "logErr: 같은 오류 중복은 스로틀");

        return out;
      })()
    `, { filename: "selftest.js" }).runInContext(ctx);
  } catch (e) {
    return [{ ok: false, msg: "assertions crashed", extra: e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e) }];
  }
};

let asserts = [];
try {
  asserts = asym() || [];
} catch (e) {
  asserts = [{ ok: false, msg: "harness crashed", extra: String(e) }];
}

const all = results.concat(asserts);
const fail = all.filter((r) => !r.ok);
const pad = (s, n) => s + " ".repeat(Math.max(0, n - s.length));
for (const r of all) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${pad(r.msg, 46)}${r.ok || !r.extra ? "" : "  <- " + r.extra}`);
}
console.log(`\n${all.length - fail.length}/${all.length} passed`);
if (fail.length) process.exit(1);
