#!/usr/bin/env python3
"""RulesForge PDF Studio: merge PDFs, capture web pages as PDFs, name and tag the result for a Game Pack.

Run:  python pdf_studio.py     (needs:  pip install pypdf)
It opens a page in your browser on this computer only (127.0.0.1); nothing is uploaded anywhere.
Web capture uses Chrome, Edge or Chromium already installed on your computer.
The merged PDF is saved to packs/incoming/<Game>/<Edition>/<Type>/<Title>.pdf with a <Title>.json beside it
holding the title, faction, version and description, which is exactly what RulesForge's pack converter reads.
"""
import json, os, re, shutil, subprocess, sys, tempfile, threading, uuid, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:
    sys.exit("PDF Studio needs the pypdf package. Run:  pip install pypdf   then start it again.")

HERE = Path(__file__).resolve().parent
WORK = Path(tempfile.mkdtemp(prefix="rf-pdfstudio-"))
TYPES = {"Rules": "Core Rules, rules updates, FAQs", "Factions": "An army or faction", "Companions": "Event Companions (Doubles, Teams…)", "Collections": "Reference PDFs (monsters, spells…)"}
FILES = {}   # id -> {"name", "path", "pages"}


def default_out():
    for p in [HERE, *HERE.parents]:
        if (p / "packs").is_dir():
            return p / "packs" / "incoming"
    return Path.home() / "RulesForge-PDFs"


OUT = Path(os.environ.get("RF_OUT") or default_out())


def safe(name):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "", name).strip(" .") or "untitled"


def parse_range(text, total):
    """'1-3, 5, 9-' -> zero-based page indexes. Blank means every page."""
    if not text.strip():
        return list(range(total))
    out = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d*)\s*-\s*(\d*)", part)
        if m:
            a, b = int(m.group(1) or 1), int(m.group(2) or total)
        elif part.isdigit():
            a = b = int(part)
        else:
            raise ValueError(f"Can't read the page range '{part}'")
        if a < 1 or b > total or a > b:
            raise ValueError(f"Page range '{part}' is outside 1–{total}")
        out.extend(range(a - 1, b))
    return out


def find_browser():
    cands = [os.environ.get("CHROME_PATH")]
    for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge", "microsoft-edge"):
        cands.append(shutil.which(n))
    cands += [r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
              "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    return next((c for c in cands if c and Path(c).exists()), None)


def register(path, name):
    n = len(PdfReader(str(path)).pages)
    fid = uuid.uuid4().hex[:10]
    FILES[fid] = {"name": name, "path": str(path), "pages": n}
    return {"id": fid, "name": name, "pages": n}


def capture(url):
    browser = find_browser()
    if not browser:
        raise RuntimeError("Couldn't find Chrome or Edge on this computer. Install one, or set CHROME_PATH to its program.")
    if not re.match(r"https?://", url):
        url = "https://" + url
    dest = WORK / f"{uuid.uuid4().hex[:8]}.pdf"
    prof = WORK / f"profile-{uuid.uuid4().hex[:6]}"
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-data-dir={prof}", "--no-pdf-header-footer",
           "--hide-scrollbars", "--virtual-time-budget=10000", f"--print-to-pdf={dest}", url]
    subprocess.run(cmd, capture_output=True, timeout=120)
    shutil.rmtree(prof, ignore_errors=True)
    if not dest.exists() or dest.stat().st_size < 500:
        raise RuntimeError("The page couldn't be captured (is the address right, and are you online?).")
    host = urlparse(url).netloc or "web page"
    return register(dest, f"{host} (web page)")


def build(items, title):
    w = PdfWriter()
    for it in items:
        f = FILES.get(it["id"])
        if not f:
            raise ValueError("A file in the list is no longer available; add it again.")
        r = PdfReader(f["path"])
        idx = parse_range(it.get("range", ""), len(r.pages))
        first = len(w.pages)
        for i in idx:
            w.add_page(r.pages[i])
        if len(items) > 1 and idx:
            w.add_outline_item(Path(f["name"]).stem, first)
    if not len(w.pages):
        raise ValueError("Nothing to merge: add at least one PDF.")
    w.add_metadata({"/Title": title})
    return w


def save(d):
    title, game, edition, typ = (d.get(k, "").strip() for k in ("title", "game", "edition", "type"))
    if not title:
        raise ValueError("Give the file a title: it's what the app will call it.")
    if d.get("mode") == "download":
        dest = WORK / f"{safe(title)}.pdf"
        build(d["items"], title).write(str(dest))
        return {"download": f"/api/pdf?path={dest.name}", "name": dest.name}
    if not game or not edition or typ not in TYPES:
        raise ValueError("Pick the Game, Edition and Type so it lands in the right Game Pack.")
    folder = OUT / safe(game) / safe(edition) / typ
    writer = build(d["items"], title)   # build first, so a bad page range leaves no empty folders behind
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{safe(title)}.pdf"
    writer.write(str(dest))
    meta = {"title": title}
    if typ == "Factions" and d.get("faction", "").strip():
        meta["faction"] = d["faction"].strip()
    if typ == "Rules" and d.get("rulesKind") == "updates":
        meta["kind"] = "updates"
    for k in ("version", "description"):
        if d.get(k, "").strip():
            meta[k] = d[k].strip()
    dest.with_suffix(".json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"saved": str(dest), "pages": len(PdfReader(str(dest)).pages)}


def existing():
    games = {}
    if OUT.is_dir():
        for g in sorted(p for p in OUT.iterdir() if p.is_dir()):
            games[g.name] = sorted(e.name for e in g.iterdir() if e.is_dir())
    return games


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def local(self):
        return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def do_GET(self):
        u = urlparse(self.path)
        if not self.local(): return self.send(403, {"error": "local only"})
        if u.path == "/":
            return self.send(200, PAGE.replace("__TYPES__", json.dumps(TYPES)).encode(), "text/html; charset=utf-8")
        if u.path == "/api/info":
            return self.send(200, {"out": str(OUT), "games": existing(), "browser": bool(find_browser())})
        if u.path == "/api/pdf":
            p = WORK / Path(parse_qs(u.query).get("path", [""])[0]).name
            if p.exists(): return self.send(200, p.read_bytes(), "application/pdf")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self.local(): return self.send(403, {"error": "local only"})
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n)
        try:
            if u.path == "/api/upload":
                name = safe(parse_qs(u.query).get("name", ["file.pdf"])[0])
                p = WORK / f"{uuid.uuid4().hex[:8]}.pdf"; p.write_bytes(raw)
                return self.send(200, register(p, name))
            d = json.loads(raw or b"{}")
            if u.path == "/api/capture": return self.send(200, capture(d.get("url", "").strip()))
            if u.path == "/api/save": return self.send(200, save(d))
        except Exception as e:
            return self.send(400, {"error": str(e) or e.__class__.__name__})
        self.send(404, {"error": "not found"})


PAGE = r"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RulesForge PDF Studio</title><style>
:root{color-scheme:dark;--bg:#1c1c1e;--c:#2a2a2d;--b:#3a3a3e;--t:#f2f2f4;--m:#9a9aa2;--a:#0a84ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.4 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:20px;display:grid;gap:18px;grid-template-columns:1fr 1fr}@media(max-width:800px){main{grid-template-columns:1fr}}
h1{grid-column:1/-1;margin:0;font-size:22px}h1 small{color:var(--m);font-weight:400;font-size:13px;margin-left:8px}
section{background:var(--c);border:1px solid var(--b);border-radius:12px;padding:16px}h2{margin:0 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--m)}
.drop{border:2px dashed var(--b);border-radius:10px;padding:22px;text-align:center;color:var(--m);cursor:pointer}.drop.on{border-color:var(--a);color:var(--t)}
.row{display:flex;gap:6px;align-items:center;background:var(--bg);border:1px solid var(--b);border-radius:8px;padding:6px 8px;margin-top:8px}
.row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row small{color:var(--m)}
input,select,textarea,button{font:inherit;color:var(--t);background:var(--bg);border:1px solid var(--b);border-radius:8px;padding:8px}input,select,textarea{width:100%}
.row input{width:90px;padding:4px 6px}button{cursor:pointer}button.p{background:var(--a);border-color:var(--a);font-weight:600}button:disabled{opacity:.5}
label{display:block;margin:10px 0 3px;color:var(--m);font-size:13px}.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.hint{color:var(--m);font-size:12px;margin-top:3px}
#msg{grid-column:1/-1;min-height:24px}.err{color:#ff6b6b}.ok{color:#5ddc8b}.cap{display:flex;gap:6px;margin-top:10px}.cap input{flex:1}
</style><main><h1>PDF Studio<small>merge PDFs, capture web pages, name them for a Game Pack</small></h1>
<section><h2>1 · Pieces</h2>
<div class="drop" id="drop">Drop PDFs here, or click to choose<input id="pick" type="file" accept="application/pdf" multiple hidden></div>
<div class="cap"><input id="url" placeholder="Capture a web page: paste its address"><button id="grab">Capture</button></div>
<div class="hint" id="nb"></div><div id="list"></div>
<div class="hint">Merged top to bottom. Use ↑ ↓ to reorder. Pages is optional: <b>1-5, 8, 12-</b> keeps just those pages.</div></section>
<section><h2>2 · Name it</h2>
<div class="two"><div><label>Game</label><input id="game" list="games" placeholder="Warhammer 40K"><datalist id="games"></datalist></div>
<div><label>Edition</label><input id="ed" list="eds" placeholder="11th Edition"><datalist id="eds"></datalist></div></div>
<label>Type: where it shows in the Game Pack</label><select id="type"></select>
<label>Title: what the app calls it</label><input id="title" placeholder="Codex: Space Marines">
<div id="facw"><label>Faction (for an army)</label><input id="fac" placeholder="Space Marines"></div>
<div id="kw" hidden><label>Rules kind</label><select id="rk"><option value="core">Core Rules</option><option value="updates">Update / FAQ / errata</option></select></div>
<div class="two"><div><label>Version (optional)</label><input id="ver" placeholder="2026-11"></div><div><label>Note (optional)</label><input id="desc"></div></div>
<div style="display:flex;gap:8px;margin-top:16px"><button class="p" id="save" style="flex:1">Save to Game Pack folder</button><button id="dl">Download PDF</button></div>
<div class="hint" id="out"></div></section><div id="msg"></div></main>
<script>
const TYPES=__TYPES__,$=id=>document.getElementById(id);let items=[],info={games:{}};
$("type").innerHTML=Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${k} · ${v}</option>`).join("");
const msg=(t,c)=>{$("msg").innerHTML=`<span class="${c||""}">${t}</span>`};
const api=async(p,b)=>{const r=await fetch(p,{method:"POST",body:b});const j=await r.json();if(!r.ok)throw Error(j.error);return j};
function draw(){$("list").innerHTML=items.map((f,i)=>`<div class="row"><span class="n">${f.name} <small>${f.pages}p</small></span><input data-r="${i}" value="${f.range||""}" placeholder="all pages"><button data-u="${i}">↑</button><button data-d="${i}">↓</button><button data-x="${i}">✕</button></div>`).join("")}
$("list").onclick=e=>{const g=k=>e.target.dataset[k];if(g("x")!=null)items.splice(+g("x"),1);else if(g("u")>0)[items[g("u")-1],items[g("u")]]=[items[g("u")],items[g("u")-1]];else if(g("d")!=null&&g("d")<items.length-1)[items[+g("d")+1],items[+g("d")]]=[items[+g("d")],items[+g("d")+1]];else return;draw()};
$("list").oninput=e=>{if(e.target.dataset.r!=null)items[e.target.dataset.r].range=e.target.value};
async function add(files){for(const f of files){if(!/pdf$/i.test(f.name)){msg(`${f.name} isn't a PDF`,"err");continue}msg(`Reading ${f.name}…`);try{items.push(await api("/api/upload?name="+encodeURIComponent(f.name),f))}catch(e){msg(e.message,"err")}}draw();msg("")}
$("drop").onclick=()=>$("pick").click();$("pick").onchange=e=>add(e.target.files);
$("drop").ondragover=e=>{e.preventDefault();$("drop").classList.add("on")};$("drop").ondragleave=()=>$("drop").classList.remove("on");
$("drop").ondrop=e=>{e.preventDefault();$("drop").classList.remove("on");add(e.dataTransfer.files)};
$("grab").onclick=async()=>{const u=$("url").value.trim();if(!u)return;$("grab").disabled=true;msg("Capturing the page… this can take up to a minute.");try{items.push(await api("/api/capture",JSON.stringify({url:u})));$("url").value="";draw();msg("Captured.","ok")}catch(e){msg(e.message,"err")}$("grab").disabled=false};
function sync(){const t=$("type").value;$("facw").hidden=t!=="Factions";$("kw").hidden=t!=="Rules";$("eds").innerHTML=(info.games[$("game").value]||[]).map(e=>`<option value="${e}">`).join("")}
$("type").onchange=$("game").oninput=sync;
const form=m=>({mode:m,items:items.map(i=>({id:i.id,range:i.range||""})),game:$("game").value,edition:$("ed").value,type:$("type").value,title:$("title").value,faction:$("fac").value,rulesKind:$("rk").value,version:$("ver").value,description:$("desc").value});
$("save").onclick=async()=>{try{const r=await api("/api/save",JSON.stringify(form("folder")));msg(`Saved ${r.pages} pages to ${r.saved}. Commit and push it to GitHub; the pack converter does the rest.`,"ok")}catch(e){msg(e.message,"err")}};
$("dl").onclick=async()=>{try{const r=await api("/api/save",JSON.stringify(form("download")));const a=document.createElement("a");a.href=r.download;a.download=r.name;a.click();msg("Downloaded.","ok")}catch(e){msg(e.message,"err")}};
fetch("/api/info").then(r=>r.json()).then(j=>{info=j;$("games").innerHTML=Object.keys(j.games).map(g=>`<option value="${g}">`).join("");$("out").textContent="Saves into: "+j.out;if(!j.browser)$("nb").textContent="Web capture needs Chrome or Edge installed; none was found.";sync()});sync();
</script></html>"""

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8940))
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"PDF Studio is running at http://127.0.0.1:{port}  (Ctrl+C to quit)\nSaving to: {OUT}")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
