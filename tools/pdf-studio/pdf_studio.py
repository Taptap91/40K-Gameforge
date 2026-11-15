#!/usr/bin/env python3
"""RulesForge PDF Studio: merge PDFs, capture web pages as PDFs, name and tag the result for a Game Pack.

Run:  python pdf_studio.py     (needs:  pip install pypdf)
It opens a page in your browser on this computer only (127.0.0.1); nothing is uploaded anywhere.
Web capture uses Chrome, Edge or Chromium already installed on your computer.
The merged PDF is saved to packs/incoming/<Game>/<Edition>/<Type>/<Title>.pdf with a <Title>.json beside it
holding the title, faction, version and description, which is exactly what RulesForge's pack converter reads.
"""
import base64, json, os, re, shutil, subprocess, sys, tempfile, threading, urllib.request, urllib.error, uuid, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, NameObject, TextStringObject, FloatObject
    from pypdf.generic import ContentStream
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
CONFIG = Path.home() / ".rulesforge-pdfstudio.json"   # remembers the GitHub details (and token, if you tick "remember")
GITHUB_API = os.environ.get("GITHUB_API", "https://api.github.com")


def load_config():
    try:
        return json.loads(CONFIG.read_text("utf-8"))
    except Exception:
        return {}



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


def _mul(a, b):
    """Multiply two PDF matrices given as (a, b, c, d, e, f)."""
    return (a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3], a[4]*b[0]+a[5]*b[2]+b[4], a[4]*b[1]+a[5]*b[3]+b[5])


def text_runs(page):
    """Every text-showing step on the page as (operation index, y position in page units, plain text)."""
    cs = page.get_contents()
    ops = list(cs.operations) if cs is not None else []
    I = (1, 0, 0, 1, 0, 0)
    ctm, stack, tm, tlm, lead, runs = I, [], I, I, 0.0, []
    for n, (operands, op) in enumerate(ops):
        o = op.decode() if isinstance(op, bytes) else op
        if o == "q": stack.append(ctm)
        elif o == "Q": ctm = stack.pop() if stack else I
        elif o == "cm": ctm = _mul(tuple(float(x) for x in operands), ctm)
        elif o == "BT": tm = tlm = I
        elif o == "Tm": tm = tlm = tuple(float(x) for x in operands)
        elif o in ("Td", "TD"):
            tlm = _mul((1, 0, 0, 1, float(operands[0]), float(operands[1])), tlm); tm = tlm
            if o == "TD": lead = -float(operands[1])
        elif o == "TL": lead = float(operands[0])
        elif o in ("T*", "'", '"'):
            tlm = _mul((1, 0, 0, 1, 0, -lead), tlm); tm = tlm
        if o in ("Tj", "TJ", "'", '"'):
            val = operands[-1]
            txt = "".join(str(x) for x in val if not isinstance(x, (int, float, FloatObject))) if o == "TJ" else str(val)
            runs.append((n, _mul(tm, ctm)[5], txt))
    return ops, runs


def clear_bands(page, top_pct, bottom_pct):
    """Really removes the text in the top/bottom share of the page (not just covers it)."""
    if not (top_pct or bottom_pct):
        return
    h = float(page.mediabox.height); base = float(page.mediabox.bottom)
    lo, hi = base + h * bottom_pct / 100, base + h * (1 - top_pct / 100)
    ops, runs = text_runs(page)
    kill = {n for n, y, _ in runs if (bottom_pct and y < lo) or (top_pct and y > hi)}
    if not kill:
        return
    for n in kill:
        operands, op = ops[n]
        o = op.decode() if isinstance(op, bytes) else op
        ops[n] = ([ArrayObject()] if o == "TJ" else [TextStringObject("")] if o == "Tj" else [*operands[:-1], TextStringObject("")], op)
    cs = ContentStream(None, page.pdf); cs.operations = ops
    page.replace_contents(cs)


def detect_bands(paths_pages):
    """Finds lines that repeat at the top or bottom of many pages (site name, date, address, page numbers) and
    returns the suggested band sizes in percent plus the repeated text found."""
    seen = {}; total = 0; heights = []
    for path, idxs in paths_pages:
        r = PdfReader(path)
        for i in idxs:
            pg = r.pages[i]; total += 1
            h = float(pg.mediabox.height); base = float(pg.mediabox.bottom); heights.append(h)
            lines = {}
            def visit(text, cm, tm, fd, fs):
                if text.strip():
                    m = _mul(tuple(tm), tuple(cm)); lines.setdefault(round(m[5]), []).append(text)
            pg.extract_text(visitor_text=visit)
            for y, parts in lines.items():
                txt = " ".join("".join(parts).split()); rel = (y - base) / h; key = re.sub(r"\d+", "#", txt)
                if key and (rel > 0.93 or rel < 0.07):
                    seen.setdefault(("top" if rel > 0.5 else "bottom", key), []).append((rel, txt))
    need = max(2, int(total * 0.4)); top = bot = 0.0; found = []
    for (where, key), hits in seen.items():
        if len(hits) >= need:
            found.append(f"{where}: {hits[0][1][:60]}")
            if where == "top": top = max(top, (1 - min(r for r, _ in hits)) * 100 + 1.5)
            else: bot = max(bot, max(r for r, _ in hits) * 100 + 1.5)
    return {"top": round(top, 1), "bottom": round(bot, 1), "found": sorted(set(found)), "pages": total}


def build(items, title, top=0.0, bottom=0.0):
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
            clear_bands(w.pages[-1], top, bottom)
        if len(items) > 1 and idx:
            w.add_outline_item(Path(f["name"]).stem, first)
    if not len(w.pages):
        raise ValueError("Nothing to merge: add at least one PDF.")
    w.add_metadata({"/Title": title})
    return w


def bands(d):
    return (max(0.0, min(40.0, float(d.get("top") or 0))), max(0.0, min(40.0, float(d.get("bottom") or 0))))


def detect(d):
    pp = []
    for it in d["items"]:
        f = FILES[it["id"]]
        pp.append((f["path"], parse_range(it.get("range", ""), f["pages"])))
    return detect_bands(pp)


def github_put(cfg, repo_path, data, message):
    """Create or replace one file in the repository through GitHub's contents API."""
    url = f"{GITHUB_API}/repos/{cfg['repo']}/contents/" + "/".join(urllib.request.quote(p) for p in repo_path.split("/"))
    head = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/vnd.github+json", "User-Agent": "rulesforge-pdfstudio"}
    sha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{url}?ref={cfg['branch']}", headers=head)) as r:
            sha = json.load(r).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404: raise RuntimeError(gh_error(e))
    body = {"message": message, "content": base64.b64encode(data).decode(), "branch": cfg["branch"]}
    if sha: body["sha"] = sha
    try:
        with urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {**head, "Content-Type": "application/json"}, method="PUT")) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(gh_error(e))


def gh_error(e):
    try: msg = json.load(e).get("message", "")
    except Exception: msg = ""
    hint = {401: "GitHub didn't accept the token (wrong, expired, or revoked).", 403: "The token isn't allowed to write to this repository (it needs Contents: Read and write).",
            404: "GitHub can't find that repository or branch with this token."}.get(e.code, "")
    return f"GitHub said {e.code}: {msg} {hint}".strip()


def save(d):
    title, game, edition, typ = (d.get(k, "").strip() for k in ("title", "game", "edition", "type"))
    if not title:
        raise ValueError("Give the file a title: it's what the app will call it.")
    if d.get("mode") == "download":
        dest = WORK / f"{safe(title)}.pdf"
        build(d["items"], title, *bands(d)).write(str(dest))
        return {"download": f"/api/pdf?path={dest.name}", "name": dest.name}
    if not game or not edition or typ not in TYPES:
        raise ValueError("Pick the Game, Edition and Type so it lands in the right Game Pack.")
    folder = OUT / safe(game) / safe(edition) / typ
    writer = build(d["items"], title, *bands(d))   # build first, so a bad page range leaves no empty folders behind
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
    out = {"saved": str(dest), "pages": len(PdfReader(str(dest)).pages)}
    gh = d.get("github")
    if gh:
        cfg = {"repo": gh["repo"].strip(), "branch": gh["branch"].strip() or "game-packs", "token": gh["token"].strip() or load_config().get("token", "")}
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", cfg["repo"]) or not cfg["token"]:
            raise ValueError("To upload, fill in the repository (owner/name) and a GitHub token.")
        if gh.get("remember"):
            CONFIG.write_text(json.dumps(cfg), "utf-8")
            try: CONFIG.chmod(0o600)
            except OSError: pass
        rel = dest.relative_to(OUT.parent.parent).as_posix() if OUT.name == "incoming" else f"packs/incoming/{dest.relative_to(OUT).as_posix()}"
        msg = f"Add {title} ({typ})"
        # The details file first, so it is already there when the PDF triggers the converter.
        github_put(cfg, rel[:-4] + ".json", dest.with_suffix(".json").read_bytes(), msg)
        github_put(cfg, rel, dest.read_bytes(), msg)
        out["uploaded"] = f"{cfg['repo']}@{cfg['branch']}:{rel}"
    return out


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
            c = load_config()
            return self.send(200, {"out": str(OUT), "games": existing(), "browser": bool(find_browser()), "repo": c.get("repo", "Taptap91/40k-gameforge"), "branch": c.get("branch", "game-packs"), "hasToken": bool(c.get("token"))})
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
            if u.path == "/api/detect": return self.send(200, detect(d))
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
<label>Remove headers and footers (website address, date, page numbers…)</label>
<div class="two"><div><input id="top" type="number" min="0" max="40" step="0.5" placeholder="Top % of page"></div><div><input id="bot" type="number" min="0" max="40" step="0.5" placeholder="Bottom % of page"></div></div>
<div style="margin-top:6px"><button id="det">Find them automatically</button> <span class="hint" id="detout"></span></div>
<div class="hint">The text inside these bands is deleted from the saved PDF, not just covered. Detect looks in the outer 7% of each page for lines repeated on most pages and fills the sizes in. Check the result, then adjust the numbers if real text is too close to the edge.</div>
<div class="two"><div><label>Version (optional)</label><input id="ver" placeholder="2026-11"></div><div><label>Note (optional)</label><input id="desc"></div></div>
<details style="margin-top:14px"><summary>Upload to GitHub</summary>
<label><input type="checkbox" id="up" style="width:auto"> Also upload the saved files to GitHub</label>
<div class="two"><div><label>Repository</label><input id="repo" value="Taptap91/40k-gameforge"></div><div><label>Branch</label><input id="br" value="game-packs"></div></div>
<label>Token <span id="tkn"></span></label><input id="tok" type="password" autocomplete="off" placeholder="GitHub token with Contents: read and write">
<label><input type="checkbox" id="rem" style="width:auto"> Remember on this computer</label>
<div class="hint">Needs a fine-grained token limited to this one repository (GitHub › Settings › Developer settings › Fine-grained tokens › Contents: Read and write). The token only ever goes to github.com.</div></details>
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
const form=m=>({top:$("top").value,bottom:$("bot").value,github:$("up").checked&&m==="folder"?{repo:$("repo").value,branch:$("br").value,token:$("tok").value,remember:$("rem").checked}:null,mode:m,items:items.map(i=>({id:i.id,range:i.range||""})),game:$("game").value,edition:$("ed").value,type:$("type").value,title:$("title").value,faction:$("fac").value,rulesKind:$("rk").value,version:$("ver").value,description:$("desc").value});
$("save").onclick=async()=>{try{const r=await api("/api/save",JSON.stringify(form("folder")));msg(r.uploaded?`Saved ${r.pages} pages and uploaded to ${r.uploaded}. The converter will pick it up in a minute or two.`:`Saved ${r.pages} pages to ${r.saved}. Commit and push it to GitHub; the pack converter does the rest.`,"ok")}catch(e){msg(e.message,"err")}};
$("det").onclick=async()=>{if(!items.length)return msg("Add a PDF first.","err");msg("Looking for repeated lines…");try{const r=await api("/api/detect",JSON.stringify(form("download")));$("top").value=r.top||"";$("bot").value=r.bottom||"";$("detout").textContent=r.found.length?"Found: "+r.found.join(" · "):"Nothing repeated found.";msg("")}catch(e){msg(e.message,"err")}};
$("dl").onclick=async()=>{try{const r=await api("/api/save",JSON.stringify(form("download")));const a=document.createElement("a");a.href=r.download;a.download=r.name;a.click();msg("Downloaded.","ok")}catch(e){msg(e.message,"err")}};
fetch("/api/info").then(r=>r.json()).then(j=>{info=j;$("repo").value=j.repo;$("br").value=j.branch;if(j.hasToken)$("tkn").textContent="(saved: leave blank to use it)";$("games").innerHTML=Object.keys(j.games).map(g=>`<option value="${g}">`).join("");$("out").textContent="Saves into: "+j.out;if(!j.browser)$("nb").textContent="Web capture needs Chrome or Edge installed; none was found.";sync()});sync();
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
