"""Echo v3.4 — 암기 테스트/암송/게이미피케이션 검증"""
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import drills
import progress

N = 0


def ok(name, cond, extra=""):
    global N
    if not cond:
        print("FAIL:", name, extra)
        raise SystemExit(1)
    N += 1
    print("  ok", name)


SEGS = [
    {"en": "Hi, can I get a latte please?", "ko": "라떼 한 잔 주세요.", "start": 0.0, "end": 3.4},
    {"en": "Sure. What size would you like?", "ko": "어떤 사이즈로 드릴까요?", "start": 3.8, "end": 6.4},
    {"en": "Medium please, for here.", "ko": "중간 사이즈요, 매장에서요.", "start": 6.8, "end": 9.2},
    {"en": "That will be four dollars.", "ko": "4달러입니다.", "start": 9.6, "end": 12.0},
]

print("[1] 정규화·유사도")
ok("norm", drills.norm("  Hi,  CAN'T  go!! ") == "hi can't go")
ok("tokens", drills.tokens("a b, c.") == ["a", "b", "c"])
ok("ratio same", drills.ratio("Hello there", "hello, there!") == 1.0)
ok("ratio empty", drills.ratio("", "") == 1.0)
ok("ratio half", 0.3 < drills.ratio("hello world", "hello") < 1.0)
ok("score exact", drills.score_sentence("Hi can I get a latte", "hi can i get a latte") == 100)
ok("score wrong", drills.score_sentence("Hi can I get a latte", "completely different") < 40)
shuffled_words = drills.score_sentence("I would like a coffee now", "now coffee a like would I")
ok("score reorder < exact", shuffled_words < 100)

print("[2] 최종 암송 매칭")
exp = [s["en"] for s in SEGS]
r = drills.match_recitation(exp, " ".join(exp))
ok("punctuated pass", r["passed"] and r["score"] >= 95 and r["passed_count"] == 4, r["score"])
r2 = drills.match_recitation(exp, " ".join(exp).replace(".", "").replace(",", "").lower())
ok("no punctuation pass", r2["passed"], r2["rows"])
r3 = drills.match_recitation(exp, "Hi can I get a latte please. Sure what size would you like. Medium please for here.")
ok("missing last sentence fails", not r3["passed"] and 3 in r3["missed"], r3["missed"])
r4 = drills.match_recitation([], "anything")
ok("empty expected", not r4["ok"] and r4["score"] == 0)
r5 = drills.match_recitation(exp, "hi can i get a latte please sure what size would you like medium please for here that will be four dollars")
ok("flat stream pass", r5["passed"] and r5["total"] == 4, r5["rows"])

print("[3] 순서 드릴")
bo = drills.build_order(SEGS, "v1")
ok("order usable", bo["usable"] and len(bo["items"]) == 4)
ok("order shuffled", bo["shuffled"] != sorted(bo["shuffled"]))
ok("order same set", sorted(bo["shuffled"]) == [0, 1, 2, 3])
ok("order deterministic", drills.build_order(SEGS, "v1")["shuffled"] == bo["shuffled"])
ok("order check ok", drills.check_order([0, 1, 2, 3])["passed"])
ok("order check bad", not drills.check_order([0, 2, 1, 3])["passed"])
ok("order check dup", not drills.check_order([0, 0, 1, 2])["passed"])
ok("order needs 2", not drills.build_order(SEGS[:1], "v1")["usable"])

print("[4] 빈칸 드릴")
bc = drills.build_cloze(SEGS, "v1")
ok("cloze usable", bc["usable"] and bc["total_blanks"] >= 4)
ok("cloze parts have blanks", all(any(p.get("blank") for p in it["parts"]) for it in bc["items"]))
ok("cloze hint", all(p["hint"].endswith("…") for it in bc["items"] for p in it["parts"] if p.get("blank")))
answers = []
for it in bc["items"]:
    answers.append({"i": it["i"], "answers": [b["answer"] for b in it["blanks"]]})
cc = drills.check_cloze(answers, SEGS)
ok("cloze all right", cc["passed"] and cc["score"] == 100, cc)
wrong = [{"i": a["i"], "answers": ["zzz"] * len(a["answers"])} for a in answers]
cc2 = drills.check_cloze(wrong, SEGS)
ok("cloze all wrong", not cc2["passed"] and cc2["score"] == 0, cc2)

print("[5] 듣기 드릴")
bl = drills.build_listen(SEGS, "v1")
ok("listen usable", bl["usable"] and len(bl["items"]) == 4)
ok("listen options contain answer", all(it["answer"] in it["options"] for it in bl["items"]))
ok("listen 4 options", all(len(it["options"]) == 4 for it in bl["items"]))
ok("listen times", bl["items"][0]["start"] == 0.0 and bl["items"][0]["end"] == 3.4)
cl = drills.check_listen([{"i": it["i"], "ok": True} for it in bl["items"]])
ok("listen all right", cl["passed"] and cl["score"] == 100)
cl2 = drills.check_listen([{"i": 0, "ok": True}, {"i": 1, "ok": False}])
ok("listen partial", not cl2["passed"] and cl2["score"] == 50, cl2)

print("[6] 이어말하기 드릴")
bch = drills.build_chain(SEGS, "v1")
ok("chain usable", bch["usable"] and len(bch["items"]) == 4)
ok("chain head+rest", all((it["head"] + " " + it["rest"]).strip() == it["en"] for it in bch["items"]))
ok("chain head shorter", all(len(it["head"]) < len(it["en"]) for it in bch["items"]))
cch = drills.check_chain([{"i": it["i"], "said": it["rest"]} for it in bch["items"]], SEGS)
ok("chain all right", cch["passed"] and cch["score"] == 100, cch)
cch2 = drills.check_chain([{"i": 0, "said": "wrong"}], SEGS)
ok("chain partial", not cch2["passed"] and cch2["hit"] == 0)

print("[7] 통합 build/check")
ok("build order", drills.build("order", SEGS, "v1")["kind"] == "order")
ok("build cloze", drills.build("cloze", SEGS, "v1")["kind"] == "cloze")
ok("build listen", drills.build("listen", SEGS, "v1")["kind"] == "listen")
ok("build chain", drills.build("chain", SEGS, "v1")["kind"] == "chain")
try:
    drills.build("nope", SEGS, "v1")
    ok("unknown kind raises", False)
except ValueError:
    ok("unknown kind raises", True)
try:
    drills.check("nope", [], SEGS)
    ok("unknown check raises", False)
except ValueError:
    ok("unknown check raises", True)

print("[8] 진행 기록 / XP / 배지")
tmp = Path(tempfile.mkdtemp())
progress.DATA = tmp
progress.ATTEMPTS = tmp / "attempts.json"
progress.NOTES = tmp / "notes.json"
progress.TESTS = tmp / "tests.json"
progress.WCACHE = tmp / "wordcache.json"

vid = "vtest0001"
r = progress.record_test(vid, "order", True, 100, {"hit": 4, "total": 4})
ok("first clear xp", r["first_clear"] and r["xp_gain"] == progress.XP_DRILL, r)
r2 = progress.record_test(vid, "order", True, 100)
ok("repeat no xp", not r2["first_clear"] and r2["xp_gain"] == 0, r2)
ok("not complete yet", not progress.is_complete(vid))
rr = progress.record_test(vid, "recite", True, 96)
ok("recite xp", rr["xp_gain"] == progress.XP_RECITE, rr)
ok("complete", progress.is_complete(vid) and progress.completed_count() == 1)
ok("badges recite", any(b["id"] == "recite_clear" and b["got"] for b in progress.badges()))
ok("badges count", len(progress.badges()) == 12)
li = progress.level_info()
ok("level", li["level"] >= 2 and li["xp"] == 125 and li["pct"] == round(100 * 5 / 120, 1), li)
ok("level_of", progress.level_of(240) == 3 and progress.level_of(0) == 1)
progress.reset_tests(vid)
ok("reset", not progress.is_complete(vid) and progress.test_best(vid) == {})
try:
    progress.record_test(vid, "hack", True, 100)
    ok("unknown test kind", False)
except ValueError:
    ok("unknown test kind", True)

print("[9] 파일 저장 형식")
progress.record_test(vid, "cloze", False, 55)
t = json.loads((tmp / "tests.json").read_text("utf-8"))
ok("tests.json shape", t[vid]["cloze"]["ok"] is False and t[vid]["cloze"]["tries"] == 1, t)
ok("score kept", t[vid]["cloze"]["score"] == 55.0)

print(f"\nALL PASS — {N} checks")
