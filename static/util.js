/* Langclip 공용 유틸 - app.js / sync.js 보다 먼저 로드된다. */
(function () {
  "use strict";
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => (isFinite(n) ? Number(n).toFixed(1) : "0.0");
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  window.LCUtil = { esc, fmt, mmss };
})();
