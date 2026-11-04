# -*- coding: utf-8 -*-
from pathlib import Path
C, V = Path("static/style.css"), Path("verify.py")
c, v = C.read_text(encoding="utf-8"), V.read_text(encoding="utf-8")
assert c.count(":root{") == 1

if "단어 단위" not in v:
    v = v.replace('''    if norm(a) == norm(b):
        return 100
    return int(round(100 * ratio(a, b)))''', '''    A, B = norm(a), norm(b)
    if A == B:
        return 100
    if not A:
        return 0
    base = 100.0 * ratio(a, b)
    wa, wb = A.split(), B.split()
    pool = list(wb)
    hit = 0
    for w in wa:
        if w in pool:
            pool.remove(w)
            hit += 1
    wordpct = 100.0 * hit / max(1, len(wa))
    return int(round(0.45 * base + 0.55 * wordpct))''', 1)

c += '''

/* ================= v4.4 디자인 정리 ================= */
html{--brand:#0095F6;--mute:#9CA3AF;--flame:#FF6B00}

body,button,input,textarea,select{font-family:"Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Segoe UI",Roboto,sans-serif}
body{font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}

.stage{background:#FFFFFF;padding:24px 16px}
.phone{box-shadow:0 1px 3px rgba(15,23,42,.06),0 12px 32px -18px rgba(15,23,42,.22);
  border:1px solid #E5E9EF;border-radius:28px}
.desk-note{display:none}

.brand{gap:8px}
.brand .mark{width:26px;height:26px;flex:0 0 auto;display:block}
.brand .wm{font-size:16.5px;font-weight:800;letter-spacing:-.035em;color:#0F172A}

.streak{background:none;border:0;padding:0;gap:5px;color:var(--mute);
  font-size:12.5px;font-weight:800;letter-spacing:-.01em}
.streak .ic{width:14px;height:14px;stroke-width:1.9;fill:none;stroke:var(--mute);transition:stroke .18s}
.streak.on{color:var(--flame)}
.streak.on .ic{stroke:var(--flame);fill:rgba(255,107,0,.16)}
.streak-h b{font-size:19px;font-weight:800;letter-spacing:-.035em;color:#0F172A}
.streak-h span{font-size:11.5px;font-weight:650;color:var(--mute)}

.cta{background:var(--brand);border:0;border-radius:12px;box-shadow:none;
  color:#fff;font-size:13.5px;font-weight:800;letter-spacing:-.01em;
  height:46px;display:flex;align-items:center;justify-content:center;gap:5px}
.cta:active{background:#0082D9;transform:none}
.cta .ic{width:14px;height:14px;stroke-width:2.2}
.btn.primary{background:var(--brand);border:0;border-radius:12px;box-shadow:none;color:#fff}
.btn.primary:active{background:#0082D9}
.btn,.btn.ghost,.btn.sm,.btn.text{border-radius:12px}
button{box-shadow:none}

.focus{border-radius:16px;box-shadow:none;border:1px solid #EEF2F6}
.focus-t{font-size:15px;font-weight:800;letter-spacing:-.03em}
.focus-s{font-size:12px;color:#64748B;margin:6px 0 12px}
.focus-pill,.today-state{display:none!important}

.sec-title{font-size:13px;font-weight:800;letter-spacing:-.02em;color:#0F172A}
.sec-title .pill{background:none;border:0;padding:0;color:var(--brand);
  font-size:12.5px;font-weight:800;border-radius:0}
.sec-title .pill.zero{display:none}
.sec-title .more{color:var(--mute);font-weight:700}

.note-empty{border:0!important;background:none!important;box-shadow:none!important;
  padding:34px 10px;text-align:center;color:var(--mute);font-size:12px;line-height:1.7}
.note-empty b{display:block;font-size:12.5px;font-weight:800;color:#64748B;margin-bottom:3px}
.tip{border:0!important;background:#F8FAFC!important;border-radius:12px!important;box-shadow:none!important}
.tip b{font-size:12px;color:#334155}
.tip p{font-size:11.5px;color:#64748B;line-height:1.6}

.vrowcard{border:0;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05);
  padding:10px;margin-bottom:8px}
.vrowcard .nc-meta .tag{display:none!important}
.vrowcard .nc-meta span:not(.tag){font-size:11px;font-weight:650;color:var(--mute)}
.vrowcard .nc-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.vrowcard .okchip{display:none!important}
.vrowcard .nc-en{font-size:13px;font-weight:750;letter-spacing:-.02em;color:#0F172A}

.vcount{background:none!important;border:0!important;padding:0!important;
  color:rgba(255,255,255,.62)!important;font-size:11px!important;font-weight:700!important}

.axis-wrap{background:#fff;border-radius:14px;padding:6px 14px;box-shadow:0 1px 2px rgba(15,23,42,.05)}
.axis{margin:0;padding:11px 0;border-bottom:1px solid #F1F5F9;gap:12px}
.axis:last-of-type{border-bottom:0}
.ax-label{flex:0 0 84px;font-size:11.5px;font-weight:700;color:#475569}
.ax-bar{height:5px;background:#F1F5F9}
.ax-bar i{background:var(--brand);border-radius:99px}
.axis.low .ax-bar i{background:#F59E0B}
.ax-val{flex:0 0 26px;text-align:right;font-size:11.5px;font-weight:800;color:#0F172A}
#dl-hint{display:none}

.sc-list{max-height:58vh;overflow-y:auto;margin:2px 0 4px}
.sc-row{display:flex;gap:10px;align-items:flex-start;text-align:left;border:0;
  border-bottom:1px solid #F1F5F9;background:none;border-radius:0;padding:10px 6px;margin:0}
.sc-row:active{transform:none;background:#F8FAFC}
.sc-row b{flex:0 0 14px;height:auto;background:none!important;color:var(--mute);
  font-size:11px;font-weight:800;line-height:1.5;border-radius:0}
.sc-row em{font-size:12.5px;font-weight:700;color:#0F172A;line-height:1.5}
.sc-row i{font-size:10.5px;color:var(--mute);line-height:1.45;margin-top:2px}
.sc-row .sc-time{display:none}
.sc-row.on{background:#F0F9FF!important;border-radius:10px;box-shadow:none}
.sc-row.on b{color:var(--brand)}
.sc-vf{width:100%;margin:10px 0 4px;height:38px;border:1px solid #E5E9EF;border-radius:12px;
  background:#fff;color:#475569;font-size:12px;font-weight:750;font-family:inherit;cursor:pointer}

.tabbar .tab .ic{stroke-width:1.9}
.star{background:rgba(15,23,42,.55);border:0;border-radius:10px;color:#fff}
.star .ic{fill:none;stroke:#fff;stroke-width:1.9}
.star.on .ic{fill:#FFB800;stroke:#FFB800}
.wp-book .ic{fill:none;stroke:currentColor;stroke-width:1.9}
.wp-book.on .ic{fill:#FFB800;stroke:#FFB800}

.sync-lab{font-size:11.5px;font-weight:750;color:#7BD8FF}
.sync-clock b{font-size:22px;font-weight:800;letter-spacing:-.04em}
.sync-tap{border-radius:14px;box-shadow:none}
.sync-tap span{font-size:12px;font-weight:800}
.sync-opts .vbtn.sm{border-radius:10px}
#sync-hint{display:none!important}

.field input,.field textarea,.field select{background:#F2F4F6;border:1px solid transparent;
  border-radius:12px;font-size:13px}
.field input:focus,.field textarea:focus,.field select:focus{background:#fff;border-color:var(--brand)}
.sheet-desc{font-size:11.5px;color:#64748B;line-height:1.6}

.sc-audio{background:none;border:0;border-top:1px solid #F1F5F9;border-radius:0;padding:12px 0 0}
.sc-audio p{font-size:11px;color:var(--mute);line-height:1.5;margin:4px 0 8px}

.scoring{position:absolute;inset:0;z-index:95;display:grid;place-items:center;
  background:rgba(5,11,18,.55);backdrop-filter:blur(3px)}
.scoring[hidden]{display:none}
.scoring-box{display:flex;flex-direction:column;align-items:center;gap:8px;
  background:#0F172A;border-radius:16px;padding:22px 26px;box-shadow:0 18px 40px -20px rgba(0,0,0,.8)}
.scoring-sp{width:26px;height:26px;border-radius:50%;border:2.5px solid rgba(255,255,255,.18);
  border-top-color:var(--brand);animation:spin .7s linear infinite}
.scoring-box b{color:#fff;font-size:13px;font-weight:800}
.scoring-box em{font-style:normal;color:rgba(255,255,255,.55);font-size:10.5px}
@keyframes spin{to{transform:rotate(360deg)}}

.scr-seg.on{background:#F0F9FF!important;border-color:#BAE6FD!important}
.scr-seg.on .en{color:#0369A1}
.abar-play{background:var(--brand);color:#fff}
.abar-play.playing{background:#0F172A;color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.28)}
.abar-loop.on{background:#F0F9FF;color:var(--brand);box-shadow:inset 0 0 0 1.5px var(--brand)}
.abar{border-radius:16px}

.vf-step{border-radius:10px}
.vf-step b{background:none;color:var(--mute);font-weight:800}
.vf-step.on b{color:var(--brand)}
'''
assert c.count(":root{") == 1
C.write_text(c, encoding="utf-8")
V.write_text(v, encoding="utf-8")
print
