# -*- coding: utf-8 -*-
import io

def rd(p): return io.open(p, encoding="utf-8").read()
def wr(p, s): io.open(p, "w", encoding="utf-8", newline="\n").write(s)
warn = []

# ---------------------------------------------------------------- progress.py
p = rd("progress.py")
if "def purge_video" not in p:
    add = '''

# ---------------------------------------------------------------- \uc0ad\uc81c \uc815\ub9ac
def _dirs() -> list:
    """\uad00\ub9ac\uc790 \ubcf8\uc778 \ud3f4\ub354 + \ubc29\ubb38\uc790\ubcc4 \ud3f4\ub354 \uc804\ubd80."""
    out = [DATA]
    u = DATA / "users"
    if u.is_dir():
        for d in sorted(u.iterdir()):
            if d.is_dir():
                out.append(d)
    return out


def purge_video(vid: str) -> dict:
    """\uc601\uc0c1\uc744 \uc9c0\uc6b8 \ub54c \uadf8 \uc601\uc0c1\uc5d0 \ubb36\uc778 \ud559\uc2b5\uae30\ub85d\uc744 \ubaa8\ub4e0 \uc0ac\uc6a9\uc790 \ud3f4\ub354\uc5d0\uc11c \uc9c0\uc6b4\ub2e4. (\uc815\ud06c \ubc29\uc9c0)"""
    stat = {"attempts": 0, "sentences": 0, "words": 0, "verify": 0}
    for d in _dirs():
        f = d / "attempts.json"
        if f.exists():
            rows = _load(f, [])
            if isinstance(rows, list):
                keep = [r for r in rows if not (isinstance(r, dict) and r.get("vid") == vid)]
                if len(keep) != len(rows):
                    stat["attempts"] += len(rows) - len(keep)
                    _save(f, keep)
        f = d / "notes.json"
        if f.exists():
            n = _load(f, {})
            if isinstance(n, dict):
                hit = 0
                for k in [k for k, v in (n.get("sentences") or {}).items() if isinstance(v, dict) and v.get("vid") == vid]:
                    n["sentences"].pop(k, None); hit += 1
                stat["sentences"] += hit
                hit = 0
                for k in [k for k, v in (n.get("words") or {}).items() if isinstance(v, dict) and v.get("vid") == vid]:
                    n["words"].pop(k, None); hit += 1
                stat["words"] += hit
                if hit:
                    _save(f, n)
        f = d / "verify.json"
        if f.exists():
            vv = _load(f, {})
            if isinstance(vv, dict) and vid in vv:
                vv.pop(vid, None); stat["verify"] += 1; _save(f, vv)
    return stat
'''
    p = p.rstrip() + add
    wr("progress.py", p)
else:
    warn.append("purge exists")

# ---------------------------------------------------------------- main.py
m = rd("main.py")
old = '''@app.delete("/api/videos/{vid}")
def del_video(vid: str, request: Request):
    require_admin(request)
    d = db()
    d["videos"].pop(vid, None)
    save_db(d)
    return {"ok": True}'''
new = '''@app.delete("/api/videos/{vid}")
def del_video(vid: str, request: Request):
    """\uc601\uc0c1 \uc0ad\uc81c \u2014 \ub300\ubcf8\u00b7\uc74c\uc6d0 \ud30c\uc77c\u00b7\ud559\uc2b5\uae30\ub85d(\uc2dc\ub3c4\u00b7\ubd81\ub9c8\ud06c\u00b7\uac80\uc99d)\uc744 \ud568\uaed8 \uc9c0\uc6cc \uc815\ud06c\ub97c \ub0a8\uae30\uc9c0 \uc54a\ub294\ub2e4."""
    require_admin(request)
    d = db()
    v = d["videos"].pop(vid, None)
    audio_removed = None
    aid = (v or {}).get("audio_id")
    if aid:
        still = any(x.get("audio_id") == aid for x in d["videos"].values())
        if not still:
            a = d.get("audios", {}).pop(aid, None)
            if a:
                try:
                    storage.delete(a.get("key", ""))
                except Exception:
                    pass
                audio_removed = aid
    save_db(d)
    purged = prog.purge_video(vid)
    return {"ok": True, "removed": bool(v), "audio_removed": audio_removed,
            "purged": purged}'''
if old in m:
    m = m.replace(old, new, 1)
else:
    warn.append("del_video not found")
wr("main.py", m)

# ---------------------------------------------------------------- app.js
a = rd("app.js")

# 1) AUD \uc0c1\ud0dc
a = a.replace('const SCR = { q: "", vid: "", edit: false };',
              'const SCR = { q: "", vid: "", edit: false };\nconst AUD = { v: null };   // \uc6d0\ubcf8 \uc74c\uc131 \uc791\uc5c5 \ub300\uc0c1 \uc601\uc0c1', 1)

# 2) \uc0ad\uc81c \uc2dc \uce90\uc2dc \uc815\ub9ac
a = a.replace('''    await api("/api/videos/" + v.id, { method: "DELETE" });
    if (S.cur && S.cur.id === v.id) { S.cur = null; show("s-list"); }''',
'''    await api("/api/videos/" + v.id, { method: "DELETE" });
    delete SCRC[v.id];
    if (SCR.vid === v.id) SCR.vid = "";
    if (AUD.v && AUD.v.id === v.id) AUD.v = null;
    if (S.cur && S.cur.id === v.id) { S.cur = null; show("s-list"); }''', 1)

# 3) loadScripts \u2014 \uc0ad\uc81c\ub41c \uc601\uc0c1 id \ubc30\uc81c
a = a.replace('''  if (!SCR.vid) SCR.vid = S.cur?.id || (S.videos[0] && S.videos[0].id) || "";
  renderPick();''',
'''  const ids = (S.videos || []).map((x) => x.id);
  if (SCR.vid && ids.indexOf(SCR.vid) < 0) { delete SCRC[SCR.vid]; SCR.vid = ""; }
  if (!SCR.vid) SCR.vid = S.cur?.id || (S.videos[0] && S.videos[0].id) || "";
  renderPick();''', 1)

# 4) renderScript \u2014 null \ubc29\uc5b4
a = a.replace('''  const v = await scrVideo(SCR.vid);
  if (!v) return;''', '''  const v = await scrVideo(SCR.vid);
  if (!v) { box.innerHTML = `<div class="scr-empty">\uc601\uc0c1\uc774 \uc5c6\uc2b5\ub2c8\ub2e4</div>`; return; }''', 1)

# 5) openScriptSheet \u2192 \uc74c\uc131 \uc0c1\ud0dc \uac31\uc2e0
a = a.replace('''  $("#sheet-script").hidden = false;
  const cur = $("#sc-list .sc-row.on");''',
'''  AUD.v = S.cur;
  renderAudioState();
  $("#sheet-script").hidden = false;
  const cur = $("#sc-list .sc-row.on");''', 1)
wr("app.js", a)
print("WARN:", warn if warn else "none")
