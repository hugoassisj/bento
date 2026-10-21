# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The Bento authors
#
# Asserts the H2 rig reports (rig/run.sh). Every check is a verdict, never a
# printout: a missing report or an unexpected value FAILS the run.
import json, sys, pathlib, re

out = pathlib.Path(sys.argv[1])
fails, oks = [], []


def ok(cond, what):
    (oks if cond else fails).append(what)


def report(name):
    p = out / f"{name}.json"
    if not p.exists():
        fails.append(f"{name}: NO REPORT (a timeout is a failure)")
        return None
    return json.loads(p.read_text())


def log(name):
    p = out / f"{name}.log"
    return p.read_text(errors="replace") if p.exists() else ""


def window(name, genuine, expect_heard, peer_cap_expected=True):
    r = report(name)
    if not r:
        return
    p = r["page"]
    ok(not p.get("error"), f"{name}: no error in the probe ({p.get('error')})")
    ok(p.get("armed_in_time"), f"{name}: armed after the nonce echo")
    # rig 6
    ok(p.get("cap_rotated") is True, f"{name}: rig 6 the reload rotated the capability")
    ok(p.get("rig6_old_cap") == "capability refused", f"{name}: rig 6 the previous load's capability is refused ({p.get('rig6_old_cap')})")
    ok(p.get("rig6_no_cap") == "no capability", f"{name}: rig 6 no capability is refused ({p.get('rig6_no_cap')})")
    ok(p.get("rig6_current_cap") == "only the open document is readable", f"{name}: rig 6 the current capability reaches the op ({p.get('rig6_current_cap')})")
    # the page
    ok(p.get("secure_context") is True and p.get("webcrypto") is True, f"{name}: secure context with WebCrypto")
    ok(p.get("bridge_installed") is True, f"{name}: bridge.js installed")
    ok(re.fullmatch(r"bento://[0-9a-f]{24}\.localhost", p.get("origin") or "") is not None, f"{name}: a 96-bit per-document origin ({p.get('origin')})")
    ok(str(p.get("core_cmd", "")).startswith("refused"), f"{name}: Tauri core/plugin commands refused to page script ({p.get('core_cmd')})")
    # CSP: pinned for genuine, none for unknown (the control)
    if genuine:
        ok(p.get("dom_inline_ran") is False, f"{name}: under the pinned CSP an added inline script does NOT run")
        ok(any(v.get("dir", "").startswith("script-src") for v in p.get("violations", [])), f"{name}: and the CSP reports the violation")
    else:
        ok(p.get("dom_inline_ran") is True, f"{name}: control: with no CSP an added inline script runs")
    # rig 8
    ok(sorted(p.get("rig8_heard") or []) == sorted(expect_heard), f"{name}: rig 8 BroadcastChannel heard exactly {expect_heard} (got {p.get('rig8_heard')})")
    # rigs 1, 2 and the control, by the host's log for this webview
    emb = p.get("embeds") or {}
    for tag in ["rig1-key-only", "control-own-cap"] + (["rig2-peer-cap"] if peer_cap_expected else []):
        ok(isinstance(emb.get(tag), dict), f"{name}: embed {tag} reported ({emb.get(tag)})")
    # rigs 1, 2 and the control, decided by the HOST for this webview
    scn, lbl = name.split("-")
    L = log(scn)
    def outcome(tag):
        m = re.search(r'IPC bento_file op="read" id="%s:%s" webview=%s(?:~\d+)? (OK|REFUSED: [^\n]*)' % (lbl, tag, lbl), L)
        return m.group(1) if m else "not seen"
    ok(outcome("rig1-key-only") == "REFUSED: no capability", f"{name}: rig 1 an embed with Tauri's key only is refused ({outcome('rig1-key-only')})")
    if peer_cap_expected:
        ok(outcome("rig2-peer-cap") == "REFUSED: capability refused", f"{name}: rig 2 an embed with the PEER's capability is refused ({outcome('rig2-peer-cap')})")
    ok(outcome("control-own-cap") == "OK", f"{name}: control: an embed handed THIS window's capability reaches the IPC, so the refusals are the capability's doing ({outcome('control-own-cap')})")
    # rig 3
    ok(p.get("rig3_peer_cap_seen_here") is False, f"{name}: rig 3 the peer's capability never passed through this realm")
    # save in place, re-verified
    ok(p.get("saved") is True and p.get("save_changed") is True, f"{name}: saved in place through the bridge")
    ok(r.get("on_disk_has_marker") is True, f"{name}: the marker is on disk")
    ok(r.get("verdict_on_disk_after", "").startswith("genuine") == genuine, f"{name}: the saved file is still {'genuine' if genuine else 'unknown'} ({r.get('verdict_on_disk_after')})")
    return r


def embeds_in_log(scn, label):
    lines = [l for l in log(scn).splitlines() if l.startswith("IPC bento_file") and f"webview={label}" in l]
    return lines


for scn, wins in [
    ("pair", [("pair-doc0", True, [], True), ("pair-doc1", False, [], True)]),
    # doc0 and doc2 are the SAME file: the same-document control hears each other
    # (a window also hears its OWN post on its document's sync channel: another
    # BroadcastChannel object in the same window)
    ("tri", [("tri-doc0", True, ["rig8<-doc2", "sync<-doc0", "sync<-doc2"], True), ("tri-doc1", False, [], True), ("tri-doc2", True, ["rig8<-doc0", "sync<-doc0", "sync<-doc2"], True)]),
]:
    reps = {n: window(n, g, h, pc) for n, g, h, pc in wins}
    L = log(scn)
    ex = (out / f"{scn}.exit").read_text().strip() if (out / f"{scn}.exit").exists() else "missing"
    ok(ex == "0", f"{scn}: the host exited cleanly after every window reported (exit {ex}; 124 = timeout)")
    m = re.search(r"RIG BOUNCED-BACK (.*)", L)
    back = dict(x.split("=", 1) for x in (m.group(1).split() if m else []))
    ok(len(back) == len(wins) and all(v == "armed" for v in back.values()), f"{scn}: rig 5 every window came back to its document and re-armed ({back})")
    # rigs 1/2: the host refused the key-only and peer-capability embeds; the
    # control was let through to the op (proving the embed reaches the IPC)
    refused_nocap = len(re.findall(r"IPC bento_file .*REFUSED: no capability", L))
    refused_wrong = len(re.findall(r"IPC bento_file .*REFUSED: capability refused", L))
    ok(refused_nocap >= len(wins), f"{scn}: rig 1 key-only embeds refused in the host ({refused_nocap})")
    ok(refused_wrong >= len(wins), f"{scn}: rig 2 peer-capability embeds (and rig 6's old capability) refused ({refused_wrong})")
    # rig 5: the main frame sent away was bounced back, and only the document was ever armed
    ok("BOUNCE" in L, f"{scn}: rig 5 a main frame sent to a foreign page was bounced back")
    ok(not re.search(r"PENDING .*\n.*example\.com", L), f"{scn}: rig 5 the foreign page was never armed")
    # §19h: one web process per document
    procs = int((out / f"{scn}.procs").read_text().strip() or 0) if (out / f"{scn}.procs").exists() else 0
    distinct = 2
    ok(procs >= distinct, f"{scn}: §19h at least one web process per document ({procs} seen for {distinct} documents)")
    # rig 8 storage: distinct documents never share IndexedDB; the same document does
    if scn == "pair":
        a, b = reps.get("pair-doc0"), reps.get("pair-doc1")
        if a and b:
            ok(a["page"]["rig8_idb_owner"].endswith("(claimed)") and b["page"]["rig8_idb_owner"].endswith("(claimed)"), f"pair: rig 8 each document claims its own IndexedDB ({a['page']['rig8_idb_owner']}, {b['page']['rig8_idb_owner']})")
            ok(a["origin_host"] != b["origin_host"], "pair: distinct origins")
    if scn == "tri":
        b0, u, b2 = reps.get("tri-doc0"), reps.get("tri-doc1"), reps.get("tri-doc2")
        if b0 and b2 and u:
            owners = {b0["page"]["rig8_idb_owner"], b2["page"]["rig8_idb_owner"]}
            ok(any(o.endswith("(claimed)") for o in owners) and any(not o.endswith("(claimed)") for o in owners), f"tri: rig 8 control: the same document opened twice shares IndexedDB ({owners})")
            ok(u["page"]["rig8_idb_owner"].endswith("(claimed)"), "tri: the unknown document has its own IndexedDB")
            ok(b0["origin_host"] == b2["origin_host"] != u["origin_host"], "tri: same file, same origin; other file, other origin")

for o in oks:
    print("ok  ", o)
for f in fails:
    print("FAIL", f)
print(f"\n{len(oks)} ok, {len(fails)} failed")
sys.exit(1 if fails else 0)
