/* Langclip · 브라우저 채점 엔진 (v8.14.23)
   서버 /api/videos/{vid}/feats 가 내려주는 int8 로그멜과 로컬 녹음을 DTW 로 비교한다.
   파라미터(SR/WIN/HOP/NFFT/NMEL)는 feats.py 와 반드시 같아야 한다. 한쪽만 바꾸면 점수가 어긋난다. */
(function (global) {
  "use strict";

  var SR = 16000, WIN = 400, HOP = 320, NFFT = 512, NMEL = 24;
  var ALPHAS = [0.88, 0.90, 0.92, 0.95, 0.98, 1.0, 1.02, 1.05, 1.08, 1.10, 1.12];
  var VERSION = "8.14.28";

  /* ---------------- 기반 유틸 ---------------- */
  var hz2mel = function (f) { return 2595 * Math.log10(1 + f / 700); };
  var mel2hz = function (m) { return 700 * (Math.pow(10, m / 2595) - 1); };

  var BANK_CACHE = {};
  function melBank(alpha) {
    var key = alpha.toFixed(2);
    if (BANK_CACHE[key]) return BANK_CACHE[key];
    var lo = hz2mel(80), hi = hz2mel(7600), pts = [];
    for (var i = 0; i < NMEL + 2; i++) pts.push(mel2hz(lo + (hi - lo) * i / (NMEL + 1)));
    var binHz = SR / NFFT, out = [];
    for (var m = 1; m <= NMEL; m++) {
      // VTLN: 목표 주파수를 alpha 배로 늘려 필터를 이동 (화자 음색 차이 흡수)
      var c = pts[m] * alpha;
      var f0 = c - (c - pts[m - 1]) / alpha;
      var f1 = c;
      var f2 = c + (pts[m + 1] - c) / alpha;
      var w = new Float32Array(NFFT / 2 + 1);
      for (var k = 0; k <= NFFT / 2; k++) {
        var f = k * binHz;
        if (f >= f0 && f <= f1) w[k] = (f - f0) / (f1 - f0);
        else if (f > f1 && f <= f2) w[k] = (f2 - f) / (f2 - f1);
      }
      out.push(w);
    }
    BANK_CACHE[key] = out;
    return out;
  }

  function fft(re, im) {
    var n = re.length, i, j, bit, t, len, ang, wr, wi, half, cr, ci, k, ur, ui, vr, vi, ncr;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len; wr = Math.cos(ang); wi = Math.sin(ang); half = len >> 1;
      for (i = 0; i < n; i += len) {
        cr = 1; ci = 0;
        for (k = 0; k < half; k++) {
          ur = re[i + k]; ui = im[i + k];
          vr = re[i + k + half] * cr - im[i + k + half] * ci;
          vi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
          ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  /* 무음 트리밍: 양 끝 조용한 구간 제거 (서버 feats.py 와 같은 규칙) */
  function trim(pcm) {
    var fr = Math.floor((pcm.length - WIN) / HOP) + 1;
    if (fr < 3) return pcm;
    var e = new Float32Array(fr), i, k, s, v;
    for (i = 0; i < fr; i++) {
      s = 0;
      for (k = 0; k < WIN; k++) { v = pcm[i * HOP + k]; s += v * v; }
      e[i] = Math.sqrt(s / WIN);
    }
    var mx = 0;
    for (i = 0; i < fr; i++) if (e[i] > mx) mx = e[i];
    if (mx < 1e-4) return pcm;
    var th = mx * 0.12, a = 0, b = fr - 1;
    while (a < fr && e[a] < th) a++;
    while (b > a && e[b] < th) b--;
    a = Math.max(0, a - 2);
    b = Math.min(fr - 1, b + 2);
    return pcm.slice(a * HOP, Math.min(pcm.length, b * HOP + WIN));
  }

  function analyze(pcm) {
    var y = trim(pcm);
    var fr = Math.floor((y.length - WIN) / HOP) + 1;
    var win = new Float32Array(WIN);
    for (var i = 0; i < WIN; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (WIN - 1));
    var re = new Float32Array(NFFT), im = new Float32Array(NFFT);
    var spec = [], rms = new Float32Array(fr), f, k, base, en, v;
    for (f = 0; f < fr; f++) {
      base = f * HOP;
      for (k = 0; k < NFFT; k++) { re[k] = 0; im[k] = 0; }
      en = 0;
      for (k = 0; k < WIN; k++) { v = y[base + k]; en += v * v; re[k] = v * win[k]; }
      rms[f] = Math.sqrt(en / WIN);
      fft(re, im);
      var p = new Float32Array(NFFT / 2 + 1);
      for (k = 0; k <= NFFT / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
      spec.push(p);
    }
    return { y: y, spec: spec, rms: rms, frames: fr, dur: y.length / SR };
  }

  /* 스펙트럼 → 로그멜 (CMN + 프레임 단위벡터) */
  function melFeats(spec, alpha) {
    var bank = melBank(alpha), fr = spec.length, out = [], i, m, k, s, p, w, row;
    for (i = 0; i < fr; i++) {
      p = spec[i]; row = new Float32Array(NMEL);
      for (m = 0; m < NMEL; m++) {
        s = 0; w = bank[m];
        for (k = 0; k <= NFFT / 2; k++) s += p[k] * w[k];
        row[m] = Math.log(s + 1e-10);
      }
      out.push(row);
    }
    var mu = new Float32Array(NMEL);
    for (i = 0; i < fr; i++) for (m = 0; m < NMEL; m++) mu[m] += out[i][m] / fr;
    for (i = 0; i < fr; i++) {
      var s2 = 0;
      for (m = 0; m < NMEL; m++) { out[i][m] -= mu[m]; s2 += out[i][m] * out[i][m]; }
      var inv = 1 / Math.sqrt(s2 + 1e-12);
      for (m = 0; m < NMEL; m++) out[i][m] *= inv;
    }
    return out;
  }

  /* ---------------- DTW ---------------- */
  function dtw(A, B, costFn, bandRatio) {
    bandRatio = bandRatio || 0.3;
    var n = A.length, m = B.length;
    var band = Math.max(8, Math.floor(Math.max(n, m) * bandRatio));
    var prev = new Float64Array(m + 1), cur, i, j, lo, hi, mn;
    for (j = 0; j <= m; j++) prev[j] = Infinity;
    prev[0] = 0;
    for (i = 1; i <= n; i++) {
      cur = new Float64Array(m + 1);
      for (j = 0; j <= m; j++) cur[j] = Infinity;
      lo = Math.max(1, i - band); hi = Math.min(m, i + band);
      for (j = lo; j <= hi; j++) {
        mn = prev[j] < prev[j - 1] ? prev[j] : prev[j - 1];
        if (cur[j - 1] < mn) mn = cur[j - 1];
        cur[j] = costFn(i - 1, j - 1) + mn;
      }
      prev = cur;
    }
    return prev[m] / Math.max(n, m);
  }

  /* 코사인 거리 (프레임은 이미 단위벡터) */
  function dSpec(A, B) {
    return dtw(A, B, function (i, j) {
      var a = A[i], b = B[j], d = 1, k;
      for (k = 0; k < NMEL; k++) d -= a[k] * b[k];
      return d < 0 ? 0 : d;
    });
  }

  /* ---------------- 점수: 단일 축(원본과의 파형 유사도) = 100점 ---------------- */
  /* D0·K 는 실측 두 점에서 다시 잡았다: 같은 문장 d≈0.135, 다른 문장 d≈0.510.
     D0 를 올리면 관대해지고, K 를 올리면 곡선이 급해진다. */
  var PT_SIM = 100, D0_SPEC = 0.40, K_SPEC = 9.0;

  function logistic(d, d0, k) { return 100 / (1 + Math.exp(k * (d - d0))); }

  /* 유일한 축 — 원본과의 파형 유사도 (0~100): 스펙트럼 DTW 거리 → 로지스틱 */
  function simScore(d) { return logistic(d, D0_SPEC, K_SPEC); }

  /* 축2 유창성 (0~50): 끊김(0.1초 이상 공백) 개수 + 총 무음 시간으로 감점 */
  function fluencyScore(rms) {
    var n = rms.length;
    if (n < 8) return 0;
    var mx = 0, i;
    for (i = 0; i < n; i++) if (rms[i] > mx) mx = rms[i];
    if (mx < 1e-4) return 0;
    var th = mx * 0.14, first = -1, last = -1;
    for (i = 0; i < n; i++) if (rms[i] > th) { if (first < 0) first = i; last = i; }
    if (first < 0 || last - first < 4) return 0;
    var gaps = 0, silent = 0, run = 0, k;
    for (k = first; k <= last; k++) {
      if (rms[k] <= th) run++;
      else { if (run >= 5) { gaps++; silent += run; } run = 0; }
    }
    if (run >= 5) { gaps++; silent += run; }
    var penalty = gaps * 9 + (silent / 50) * 18;
    return Math.max(0, PT_FLUENT - penalty);
  }

  function scoreFrames(refFrames, takeSpec, takeRms) {
    var best = { d: Infinity, alpha: 1 }, i, B, d;
    for (i = 0; i < ALPHAS.length; i++) {
      B = melFeats(takeSpec, ALPHAS[i]);
      d = dSpec(refFrames, B);
      if (d < best.d) { best.d = d; best.alpha = ALPHAS[i]; }
    }
    var sSim = simScore(best.d);
    var sFlu = fluencyScore(takeRms);          // 진단용 — 점수에는 반영하지 않는다
    return { score: sSim, sim: sSim, flu: sFlu, d: best.d, alpha: best.alpha };
  }

  /* ---------------- PCM 준비 ---------------- */
  var AC = null;
  function ac() {
    if (!AC) AC = new (global.AudioContext || global.webkitAudioContext)();
    return AC;
  }

  function pcmOf(blob) {
    return blob.arrayBuffer().then(function (buf) {
      return ac().decodeAudioData(buf);
    }).then(function (dec) {
      var mono = ac().createBuffer(1, dec.length, dec.sampleRate);
      var ch0 = dec.getChannelData(0);
      var ch1 = dec.numberOfChannels > 1 ? dec.getChannelData(1) : null;
      var dst = mono.getChannelData(0), i;
      for (i = 0; i < dec.length; i++) dst[i] = ch1 ? (ch0[i] + ch1[i]) / 2 : ch0[i];
      var Offline = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      var off = new Offline(1, Math.max(1, Math.ceil(dec.duration * SR)), SR);
      var src = off.createBufferSource();
      src.buffer = mono;
      src.connect(off.destination);
      src.start();
      return off.startRendering();
    }).then(function (out) {
      return out.getChannelData(0);
    });
  }

  /* ---------------- 서버 참조 특징 ---------------- */
  var REF_CACHE = {};
  function b64ToFrames(b64, n) {
    var bin = global.atob(b64), u = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var out = [], m = 0, k, f;
    for (i = 0; i < n; i++) {
      f = new Float32Array(NMEL);
      for (k = 0; k < NMEL; k++) {
        var v = u[m++];
        f[k] = (v > 127 ? v - 256 : v) / 127;
      }
      out.push(f);
    }
    return out;
  }

  function refOf(vid) {
    if (REF_CACHE[vid]) return REF_CACHE[vid];
    var pr = fetch("/api/feats/" + encodeURIComponent(vid), { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("feats " + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j.segs || []).map(function (s) {
          return { frames: b64ToFrames(s.b64, s.n), dur: s.n * HOP / SR };
        });
      })
      .catch(function (e) {
        delete REF_CACHE[vid];          // 실패는 캐시하지 않는다
        throw e;
      });
    REF_CACHE[vid] = pr;
    return pr;
  }

  /* ---------------- 공개 API ---------------- */
  function score(vid, idx, blob) {
    return refOf(vid).then(function (segs) {
      var ref = segs[idx];
      if (!ref || ref.frames.length < 6) return null;   // 참조가 없으면 서버 채점 단독
      return pcmOf(blob).then(function (pcm) {
        var a = analyze(pcm);
        if (a.frames < 4) return null;
        var r = scoreFrames(ref.frames, a.spec, a.rms);
        r.vid = vid; r.idx = idx;
        return r;
      });
    });
  }

  /* 로컬 vs 서버 점수 대조 기록 (최근 200건, localStorage) */
  var KEY = "lc.score.diff";
  var Diff = {
    list: function () {
      try { return JSON.parse(global.localStorage.getItem(KEY) || "[]"); } catch (e) { return []; }
    },
    push: function (rec) {
      try {
        var a = Diff.list();
        a.push(rec);
        if (a.length > 200) a = a.slice(a.length - 200);
        global.localStorage.setItem(KEY, JSON.stringify(a));
      } catch (e) {}
    },
    server: function (total) {
      try {
        var a = Diff.list();
        if (!a.length) return;
        var last = a[a.length - 1];
        if (last.server === undefined) {
          last.server = Math.round(total);
          last.gap = last.local - last.server;
          global.localStorage.setItem(KEY, JSON.stringify(a));
        }
      } catch (e) {}
    },
    summary: function () {
      var a = Diff.list().filter(function (x) { return typeof x.gap === "number"; });
      if (!a.length) return { n: 0 };
      var sum = 0, abs = 0, ms = 0, i;
      for (i = 0; i < a.length; i++) { sum += a[i].gap; abs += Math.abs(a[i].gap); ms += a[i].ms || 0; }
      return { n: a.length, meanGap: +(sum / a.length).toFixed(1), meanAbsGap: +(abs / a.length).toFixed(1), meanMs: Math.round(ms / a.length) };
    },
    clear: function () { try { global.localStorage.removeItem(KEY); } catch (e) {} }
  };

  global.LCLight = { score: score, refOf: refOf, clearCache: function () { REF_CACHE = {}; }, version: VERSION };
  global.LCScoreDiff = Diff;
})(window);
