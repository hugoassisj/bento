# Applies copy-review/changes.json to the code (labels, ROW_TIPS, messages) and
# writes the catalog table for i18n-add.mjs. Model values and 'Zoom' are left
# for hand edits. Usage: python3 apply-copy.py <repo> <changes.json> <out-table.json>
import json, re, sys

repo, changes_file, out = sys.argv[1:]
d = json.load(open(changes_file))
VALUES = {'focus-group', 'reveal', 'fade-up', 'fade-down', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'kenburns', 'dash-march', 'motion-path'}
MANUAL = {'Zoom'}
P = f'{repo}/slides/src/editor/panels.ts'
OTHER = [f'{repo}/slides/src/editor/editor.ts', f'{repo}/slides/src/editor/notespane.ts']
panels = open(P).read()
others = {f: open(f).read() for f in OTHER}

def q(s):  # a single-quoted TS string literal
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

tips_start = panels.index('const ROW_TIPS')
tips_end = panels.index('\n}\n', tips_start)
table, log = {}, []

def add(key, loc_vals):
    if key in table: return
    table[key] = loc_vals

for k, v in d.items():
    if k in VALUES or k in MANUAL: continue
    new = v.get('en', k)
    tr = v['tr']
    is_label = ('this.row(' + q(k) + ',') in panels or ('\n  ' + q(k) + ': ') in panels[tips_start:tips_end]
    if is_label:
        n = panels.count('this.row(' + q(k) + ',')
        panels = panels.replace('this.row(' + q(k) + ',', 'this.row(' + q(new) + ',')
        block = panels[tips_start:tips_end]
        m = re.search(r"\n  " + re.escape(q(k)) + r": ('(?:[^'\\]|\\.)*'),", block)
        tip = v.get('tip')
        if m:
            line = "\n  " + q(new) + ": " + (q(tip) if tip else m.group(1)) + ","
            block = block[:m.start()] + line + block[m.end():]
        elif tip:
            block = block.rstrip() + "\n  " + q(new) + ": " + q(tip) + ","
        panels = panels[:tips_start] + block + panels[tips_end:]
        tips_end = tips_start + len(block)
        log.append(f'label  {k!r} -> {new!r}  rows={n} tip={"new" if tip else ("kept" if m else "none")}')
        if new != k: add(new, {loc: t['en'] for loc, t in tr.items()})
        if tip: add(tip, {loc: t['tip'] for loc, t in tr.items()})
    else:
        hits = panels.count(q(k)) + sum(s.count(q(k)) for s in others.values())
        if hits != 1:
            log.append(f'SKIP   {k!r}: {hits} quoted occurrences'); continue
        panels = panels.replace(q(k), q(new))
        for f in others: others[f] = others[f].replace(q(k), q(new))
        log.append(f'text   {k[:40]!r} -> {new[:40]!r}')
        add(new, {loc: t['en'] for loc, t in tr.items()})

open(P, 'w').write(panels)
for f, s in others.items(): open(f, 'w').write(s)
json.dump(table, open(out, 'w'), ensure_ascii=False, indent=1)
print('\n'.join(log)); print(len(table), 'catalog keys')
