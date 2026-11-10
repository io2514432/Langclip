/* Langclip 공용 유틸 - app.js / sync.js 보다 먼저 로드된다. */
(function () {
  "use strict";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => (isFinite(n) ? Number(n).toFixed(1) : "0.0");
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // --- 오류 수집: 콘솔 + 로컬 링버퍼 + 서버(/api/client_log, 스로틀)
  const ERRS = [];
  const seen = Object.create(null);
  function logErr(where, e) {
    let msg = "";
    try {
      msg = e && e.stack ? String(e.stack) : String(e && e.message ? e.message : e);
    } catch (_) {
      msg = "unknown";
    }
    msg = msg.slice(0, 400);
    const rec = { t: Date.now(), where: String(where || "?"), msg };
    ERRS.push(rec);
    if (ERRS.length > 50) ERRS.shift();
    try { console.error("[LC]", rec.where, e); } catch (_) {}
    const key = rec.where + "|" + msg.slice(0, 120);
    const now = Date.now();
    if (seen[key] && now - seen[key] < 5000) return rec;  // 중복 폭주 방지
    seen[key] = now;
    try {
      fetch("/api/client_log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where: rec.where, msg }),
        keepalive: true,
      }).catch(function () {});
    } catch (_) {}
    return rec;
  }

  window.LCUtil = { esc, fmt, mmss, logErr, errors: ERRS };
  window.logErr = logErr;
})();
