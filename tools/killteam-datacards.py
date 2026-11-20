#!/usr/bin/env python3
"""Turns the operative text in a Kill Team Collection workbook into datacards.

Each operative's Text cell (one block: name, flavour, APL/MOVE/SAVE/WOUNDS line, weapon rows,
ability rules, keywords, base) becomes one "[datacard: <url-encoded JSON>]" line, the same line
PDF Studio's tagged datacards produce (js/text.js cardLine), so the app draws it with killTeamCard.

  python3 tools/killteam-datacards.py packs/kill-team-3rd-edition/nemesis-claw.xlsx

Edits the workbook's sheet "Entries" in place. Cells that are not operatives (the header, the
images block) are left alone. Re-running is safe: a card line is read back and skipped.
"""
import json, re, sys, zipfile, shutil, html, urllib.parse, os

STATS = re.compile(r'APL\s+(\d+)\s+MOVE\s+(\S+)\s+SAVE\s*\+\s*(\d+)\s+WOUNDS\s+(\d+)')
WEAPON = re.compile(r'^(.+?)\s+(\d+)\s+(\d\+)\s+(\d+/\d+)(?:\s+(.*))?$')
ABILITY = re.compile(r"^:?\s*([A-Z][A-Za-z'’ \-]{1,40}?):\s*(.*)$")
KEYWORDS = re.compile(r"^[A-Z][A-Z'’\- ]*(?:, [A-Z][A-Z'’\- ]*)*$")
NAME = re.compile(r"^((?:[A-Z][A-Z'’\-]*(?![a-z])\s?)+)")

def encode(card):
    # encodeURIComponent-equivalent: the same characters stay bare, "*" is written as %2A
    raw = json.dumps(card, ensure_ascii=False, separators=(",", ":"))
    return urllib.parse.quote(raw, safe="-_.!~*'()").replace("*", "%2A")

def parse(text):
    """Operative text -> card dict, or None when the text is not an operative."""
    text = re.sub(r"^DATACARDS\n", "", text.strip())
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    stat_i = next((i for i, l in enumerate(lines) if STATS.search(l)), None)
    if not lines or stat_i is None or stat_i == 0:
        return None
    m = NAME.match(lines[0])
    name = m.group(1).strip() if m else lines[0]
    flavour = lines[0][len(m.group(0)):].strip() if m else ""
    flav_lines = lines[1:stat_i]
    if flav_lines:
        flavour = " ".join([flavour] + flav_lines).strip()
    s = STATS.search(lines[stat_i])
    stats = [["APL", s.group(1)], ["MOVE", s.group(2)], ["SAVE", s.group(3) + "+"], ["WOUNDS", s.group(4)]]
    weapons, abilities, keywords, base = [], [], "", ""
    for l in lines[stat_i + 1:]:
        if l.startswith("⌀"):
            base = l
        elif KEYWORDS.match(l) and "," in l:
            keywords = l
        elif not abilities and WEAPON.match(l):
            w = WEAPON.match(l)
            weapons.append({"n": w.group(1), "a": w.group(2), "h": w.group(3), "d": w.group(4), "w": (w.group(5) or "").strip()})
        elif ABILITY.match(l):
            a = ABILITY.match(l)
            abilities.append({"n": a.group(1).strip(), "t": a.group(2).strip()})
        elif abilities:
            abilities[-1]["t"] += " " + l   # a rule that wraps onto the next line
        else:
            return None
    # the role is the last keyword (VISIONARY, FEARMONGER...), as the card's type
    role = keywords.split(",")[-1].strip() if keywords else ""
    card_type = " ".join(w.capitalize() for w in role.split()) if role else ""
    return {"tpl": "killteam", "name": name.title() if name.isupper() else name, "type": card_type, "flavour": flavour,
            "stats": stats, "weapons": weapons, "abilities": abilities, "keywords": keywords, "hot": "", "base": base}

def main(path):
    tmp = path + ".tmp"
    zin = zipfile.ZipFile(path)
    sheet_name = next(n for n in zin.namelist() if n.endswith("worksheets/sheet1.xml"))
    xml = zin.read(sheet_name).decode("utf-8")
    count = 0

    def fix_cell(m):
        nonlocal count
        ref, attrs, body = m.group(1), m.group(2), m.group(3)
        # the cell as it was, unless it is an operative
        text = html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S)))
        if ref.startswith("E") and text.startswith("[datacard: "):
            return m.group(0)
        card = parse(text) if ref.startswith("E") and "APL" in text else None
        if not card:
            return m.group(0)
        count += 1
        line = f"[datacard: {encode(card)}]"
        return f'<c r="{ref}"{attrs}><is><t xml:space="preserve">{html.escape(line, quote=False)}</t></is></c>'

    xml = re.sub(r'<c r="([A-Z]+\d+)"( t="inlineStr"[^>]*)><is>(.*?)</is></c>', fix_cell, xml, flags=re.S)
    # the Visionary's row is named "Datacards" in the workbook; give it the operative's name
    xml = re.sub(r'(<c r="B3"[^>]*><is><t xml:space="preserve">)Datacards(</t>)', r"\1Night Lord Visionary\2", xml)

    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = xml.encode("utf-8") if item.filename == sheet_name else zin.read(item.filename)
            zout.writestr(item, data)
    zin.close()
    shutil.move(tmp, path)
    print(f"{count} datacards written to {os.path.basename(path)}")

if __name__ == "__main__":
    main(sys.argv[1])
