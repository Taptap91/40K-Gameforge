#!/usr/bin/env python3
"""RulesForge PDF Studio: merge PDFs, capture web pages as PDFs, name and tag the result for a Game Pack.

Run:  python pdf_studio.py     (needs:  pip install pypdf)
It opens a page in your browser on this computer only (127.0.0.1); nothing is uploaded anywhere.
Web capture uses Chrome, Edge or Chromium already installed on your computer.
The merged PDF is saved to packs/incoming/<Game>/<Edition>/<Type>/<Title>.pdf with a <Title>.json beside it
holding the title, faction, version and description, which is exactly what RulesForge's pack converter reads.
"""
import base64, json, os, re, shutil, socket, struct, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error, uuid, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, NameObject, TextStringObject, FloatObject
    from pypdf.generic import ContentStream
except ImportError:
    _m = "PDF Studio needs the pypdf package.\nOpen a Command Prompt and run:  pip install pypdf\nthen start PDF Studio again."
    try:
        import tkinter, tkinter.messagebox
        _r = tkinter.Tk(); _r.withdraw(); _r.attributes("-topmost", True); tkinter.messagebox.showerror("RulesForge PDF Studio", _m); _r.destroy()
    except Exception:
        try:
            import ctypes; ctypes.windll.user32.MessageBoxW(0, _m, "RulesForge PDF Studio", 0x10)
        except Exception: pass
    sys.exit(_m)

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


# ---------- live web page capture: open the page, let the user tick boxes and open sections, then print it ----------
class WS:
    """A tiny WebSocket client (standard library only) for Chrome's DevTools protocol."""
    def __init__(self, url):
        u = urlparse(url); self.s = socket.create_connection((u.hostname, u.port), 10); self.id = 0; self.events = []
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(f"GET {u.path} HTTP/1.1\r\nHost: {u.hostname}:{u.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            c = self.s.recv(4096)
            if not c: raise RuntimeError("The browser closed the connection.")
            buf += c
        head, self.buf = buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]: raise RuntimeError("The browser refused the connection.")

    def _read(self, n):
        while len(self.buf) < n:
            c = self.s.recv(1 << 20)
            if not c: raise EOFError("The browser closed.")
            self.buf += c
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, text):
        data = text.encode(); n = len(data); mask = os.urandom(4); h = bytearray([0x81])
        if n < 126: h.append(0x80 | n)
        elif n < 65536: h.append(0x80 | 126); h += struct.pack(">H", n)
        else: h.append(0x80 | 127); h += struct.pack(">Q", n)
        self.s.sendall(bytes(h) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _recv(self):
        msg = b""
        while True:
            b1, b2 = self._read(2); n = b2 & 0x7F
            if n == 126: n = struct.unpack(">H", self._read(2))[0]
            elif n == 127: n = struct.unpack(">Q", self._read(8))[0]
            data = self._read(n); op = b1 & 0x0F
            if op == 8: raise EOFError("The browser closed.")
            if op in (0, 1, 2): msg += data
            if b1 & 0x80 and op in (0, 1, 2): return msg.decode()

    def call(self, method, params=None, timeout=60):
        self.id += 1; mid = self.id; self.s.settimeout(timeout)
        self._send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self._recv())
            if m.get("id") == mid:
                if "error" in m: raise RuntimeError(m["error"].get("message", "browser error"))
                return m.get("result", {})
            if "method" in m: self.events.append(m["method"])

    def wait_event(self, name, timeout):
        end = time.time() + timeout
        while name not in self.events and time.time() < end:
            self.s.settimeout(max(0.1, end - time.time()))
            try: m = json.loads(self._recv())
            except socket.timeout: break
            if "method" in m: self.events.append(m["method"])
        return name in self.events


SESSIONS = {}
SCAN_JS = r"""(()=>{const txt=t=>(t||'').replace(/\s+/g,' ').trim().slice(0,80);
document.querySelectorAll('[data-rf-c]').forEach(e=>e.removeAttribute('data-rf-c'));
const label=e=>{if(e.id){const l=document.querySelector('label[for="'+CSS.escape(e.id)+'"]');if(l&&txt(l.textContent))return txt(l.textContent)}
const p=e.closest('label');if(p&&txt(p.textContent))return txt(p.textContent);if(e.getAttribute('aria-label'))return txt(e.getAttribute('aria-label'));
const nx=e.nextSibling&&e.nextSibling.textContent;if(txt(nx))return txt(nx);const pv=e.previousSibling&&e.previousSibling.textContent;if(txt(pv))return txt(pv);
return txt(e.parentElement&&e.parentElement.textContent)||'(unlabelled)'};
const out=[];const add=(e,type,l,st)=>{if(out.length>=200)return;e.setAttribute('data-rf-c',out.length);out.push({i:out.length,type,label:l,state:st})};
document.querySelectorAll('input[type=checkbox]').forEach(e=>add(e,'checkbox',label(e),e.checked));
document.querySelectorAll('details').forEach(e=>{const s=e.querySelector('summary');add(e,'details',txt(s&&s.textContent)||'(section)',e.open)});
document.querySelectorAll('[aria-expanded]').forEach(e=>{if(!e.closest('details'))add(e,'aria',txt(e.textContent)||'(section)',e.getAttribute('aria-expanded')==='true')});
document.querySelectorAll('button,a,span,div,label,[role=button]').forEach(e=>{if(e.children.length||e.hasAttribute('data-rf-c')||e.hasAttribute('aria-expanded'))return;const t=txt(e.textContent);
if(t&&t.length<40&&/^(show|hide|expand|collapse)\b/i.test(t)&&!e.closest('summary'))add(e,'button',t,null)});
return out})()"""
STATE_JS = r"""(()=>[...document.querySelectorAll('[data-rf-c]')].map(e=>({i:+e.getAttribute('data-rf-c'),state:e.matches('input')?e.checked:e.matches('details')?e.open:e.hasAttribute('aria-expanded')?e.getAttribute('aria-expanded')==='true':null})))()"""


def _set_js(ops):
    return "(()=>{const o=" + json.dumps(ops) + r""";for(const x of o){const e=document.querySelector('[data-rf-c="'+x.i+'"]');if(!e)continue;
if(x.kind==='checkbox'){if(e.checked!==x.v)e.click()}else if(x.kind==='details'){e.open=x.v}
else if(x.kind==='aria'){if((e.getAttribute('aria-expanded')==='true')!==x.v)e.click()}
else if(x.kind==='button'){const t=(e.textContent||'').trim().toLowerCase(),open=/^(show|expand)/.test(t);if(open===x.v)e.click()}}return 1})()"""


def close_session(sid):
    s = SESSIONS.pop(sid, None)
    if not s: return
    try: s["ws"].s.close()
    except Exception: pass
    try: s["proc"].kill()
    except Exception: pass
    shutil.rmtree(s["prof"], ignore_errors=True)


def open_page(d, progress):
    for k in list(SESSIONS): close_session(k)
    browser = find_browser()
    if not browser:
        raise RuntimeError("Couldn't find Chrome or Edge on this computer. Install one, or set CHROME_PATH to its program.")
    url = d.get("url", "").strip()
    if not re.match(r"https?://|file://", url): url = "https://" + url
    progress(5, 100, "Starting the browser…")
    prof = WORK / f"profile-{uuid.uuid4().hex[:6]}"; prof.mkdir(parents=True, exist_ok=True)
    flags = {"creationflags": 0x08000000} if os.name == "nt" else {}
    proc = subprocess.Popen([browser, "--headless=new", "--disable-gpu", "--no-sandbox", f"--user-data-dir={prof}", "--remote-debugging-port=0", "--hide-scrollbars", "--window-size=1280,1600", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **flags)
    sid = uuid.uuid4().hex[:8]; SESSIONS[sid] = {"proc": proc, "prof": prof, "ws": None, "t": time.time(), "url": url, "lock": threading.Lock(), "n": 0}
    try:
        port = None
        for _ in range(100):
            f = prof / "DevToolsActivePort"
            if f.exists() and f.read_text().strip():
                port = int(f.read_text().split()[0]); break
            time.sleep(0.15)
        if not port: raise RuntimeError("The browser didn't start.")
        progress(20, 100, "Connecting…")
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=10))
        ws = WS(next(t for t in tabs if t.get("type") == "page")["webSocketDebuggerUrl"]); SESSIONS[sid]["ws"] = ws
        ws.call("Page.enable"); ws.call("Emulation.setDeviceMetricsOverride", {"width": 1280, "height": 1600, "deviceScaleFactor": 1, "mobile": False})
        progress(30, 100, "Loading the page…")
        ws.call("Page.navigate", {"url": url}, timeout=60)
        end = time.time() + 45
        while not ws.wait_event("Page.loadEventFired", 1) and time.time() < end:
            progress(30 + int(45 * (1 - (end - time.time()) / 45)), 100, "Loading the page…")
        progress(80, 100, "Letting the page settle…"); time.sleep(1.5)
        ws.call("Runtime.evaluate", {"expression": "document.addEventListener('click',e=>{const a=e.target.closest&&e.target.closest('a[href]');if(a){const h=a.getAttribute('href')||'';if(!/^(#|javascript:)/i.test(h))e.preventDefault()}},true)"})
        progress(90, 100, "Finding checkboxes and sections…")
        controls = ws.call("Runtime.evaluate", {"expression": SCAN_JS, "returnByValue": True})["result"].get("value", [])
        SESSIONS[sid]["t"] = time.time()
        progress(94, 100, "Creating the preview…")
        pv = live_preview({"sid": sid})
        return {"sid": sid, "preview": pv["url"], "controls": controls, "title": ws.call("Runtime.evaluate", {"expression": "document.title", "returnByValue": True})["result"].get("value", "")}
    except Exception:
        close_session(sid); raise


def _pdf_bytes(ws, lazy=False):
    if lazy:   # scroll to the bottom and back so lazy-loaded images and sections appear
        ws.call("Runtime.evaluate", {"expression": "window.scrollTo(0,document.body.scrollHeight)"}); time.sleep(0.8)
        ws.call("Runtime.evaluate", {"expression": "window.scrollTo(0,0)"})
    r = ws.call("Page.printToPDF", {"printBackground": True, "displayHeaderFooter": False, "preferCSSPageSize": True}, timeout=300)
    return base64.b64decode(r["data"])


def live_preview(d):
    s = SESSIONS.get(d.get("sid", ""))
    if not s: raise RuntimeError("That page session ended. Open the page again.")
    with s["lock"]:
        s["n"] += 1; dest = WORK / f"live-{d['sid']}-{s['n']}.pdf"; dest.write_bytes(_pdf_bytes(s["ws"], s["n"] == 1))
        if s["n"] > 3: (WORK / f"live-{d['sid']}-{s['n'] - 3}.pdf").unlink(missing_ok=True)
    return {"url": f"/api/pdf?path={dest.name}"}


def page_shot(d):
    """The live page as stacked pictures, so it can be shown in the viewer and clicked."""
    s = SESSIONS.get(d.get("sid", ""))
    if not s: raise RuntimeError("That page session ended. Open the page again.")
    with s["lock"]:
        ws = s["ws"]
        h = int(ws.call("Runtime.evaluate", {"expression": "Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0)", "returnByValue": True})["result"].get("value", 1600))
        h = max(400, min(h, 48000)); chunks = []; y = 0
        while y < h:
            ch = min(4000, h - y)
            r = ws.call("Page.captureScreenshot", {"format": "jpeg", "quality": 72, "captureBeyondViewport": True, "clip": {"x": 0, "y": y, "width": 1280, "height": ch, "scale": 1}}, timeout=120)
            chunks.append({"y": y, "h": ch, "src": "data:image/jpeg;base64," + r["data"]}); y += ch
    return {"width": 1280, "height": h, "chunks": chunks}


def page_click(d):
    s = SESSIONS.get(d.get("sid", ""))
    if not s: raise RuntimeError("That page session ended. Open the page again.")
    x, y = float(d.get("x", 0)), float(d.get("y", 0))
    with s["lock"]:
        ws = s["ws"]
        ws.call("Runtime.evaluate", {"expression": f"window.scrollTo(0,{max(0, y - 300)})"}); time.sleep(0.15)
        sy = float(ws.call("Runtime.evaluate", {"expression": "window.scrollY", "returnByValue": True})["result"].get("value", 0))
        vy = y - sy
        for t, extra in (("mouseMoved", {}), ("mousePressed", {"button": "left", "clickCount": 1}), ("mouseReleased", {"button": "left", "clickCount": 1})):
            ws.call("Input.dispatchMouseEvent", {"type": t, "x": x, "y": vy, **extra})
        time.sleep(0.5)
        controls = ws.call("Runtime.evaluate", {"expression": SCAN_JS, "returnByValue": True})["result"].get("value", [])
    return {"controls": controls}


def page_set(d):
    s = SESSIONS.get(d.get("sid", ""))
    if not s: raise RuntimeError("That page session ended. Open the page again.")
    with s["lock"]:
        s["ws"].call("Runtime.evaluate", {"expression": _set_js(d.get("ops", [])), "returnByValue": True}); time.sleep(0.3)
        return {"states": s["ws"].call("Runtime.evaluate", {"expression": STATE_JS, "returnByValue": True})["result"].get("value", [])}


def print_page(d, progress):
    s = SESSIONS.get(d.get("sid", ""))
    if not s: raise RuntimeError("That page session ended. Open the page again.")
    try:
        progress(15, 100, "Preparing the page…")
        with s["lock"]:
            progress(35, 100, "Creating the PDF…")
            data = _pdf_bytes(s["ws"], True)
        progress(90, 100, "Saving…")
        dest = WORK / f"{uuid.uuid4().hex[:8]}.pdf"; dest.write_bytes(data)
        host = urlparse(s["url"]).netloc or "web page"
        return register(dest, f"{host} (web page)")
    finally:
        close_session(d.get("sid", ""))


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


def detect_bands(paths_pages, progress=None):
    """Finds lines that repeat at the top or bottom of many pages (site name, date, address, page numbers) and
    returns the suggested band sizes in percent plus the repeated text found."""
    # Repeated headers and footers show up on nearly every page, so reading up to 30 evenly spread pages finds
    # exactly the same lines as reading all of them, in a fraction of the time on long books.
    flat = [(p, i) for p, idxs in paths_pages for i in idxs]
    if len(flat) > 30:
        flat = [flat[round(k * (len(flat) - 1) / 29)] for k in range(30)]
    grouped = {}
    for p, i in flat: grouped.setdefault(p, []).append(i)
    paths_pages = list(grouped.items())
    seen = {}; total = 0; heights = []; every = len(flat); done = 0
    for path, idxs in paths_pages:
        r = PdfReader(path)
        for i in idxs:
            pg = r.pages[i]; total += 1; done += 1
            if progress: progress(done - 1, every, f"Reading page {done} of {every}")
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


def band(v, default=0.0):
    try: x = float(v) if v not in (None, "") else float(default)
    except (TypeError, ValueError): x = float(default)
    return max(0.0, min(40.0, x))


def build(items, title, top=0.0, bottom=0.0, progress=None):
    w = PdfWriter(); every = 0; done = 0
    for it in items:
        f = FILES.get(it["id"])
        if f: every += len(parse_range(it.get("range", ""), f["pages"]))
    for it in items:
        f = FILES.get(it["id"])
        if not f:
            raise ValueError("A file in the list is no longer available; add it again.")
        r = PdfReader(f["path"])
        idx = parse_range(it.get("range", ""), len(r.pages))
        first = len(w.pages)
        for i in idx:
            w.add_page(r.pages[i])
            clear_bands(w.pages[-1], band(it.get("top"), top), band(it.get("bottom"), bottom))
            done += 1
            if progress: progress(done, every, f"Merging page {done} of {every}")
        if len(items) > 1 and idx:
            w.add_outline_item(Path(f["name"]).stem, first)
    if not len(w.pages):
        raise ValueError("Nothing to merge: add at least one PDF.")
    w.add_metadata({"/Title": title})
    return w


def bands(d):
    return (max(0.0, min(40.0, float(d.get("top") or 0))), max(0.0, min(40.0, float(d.get("bottom") or 0))))


def detect(d, progress=None):
    pp = []
    for it in d["items"]:
        f = FILES[it["id"]]
        pp.append((f["path"], parse_range(it.get("range", ""), f["pages"])))
    return detect_bands(pp, progress)


JOBS = {}
MERGED = {}


def start_job(fn):
    """Runs fn(progress) on a thread; the page polls /api/job for the percentage."""
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {"pct": 0, "label": "Starting…", "done": False}
    def prog(n, total, label):
        JOBS[jid].update(pct=int(100 * n / max(total, 1)), label=label)
    def run():
        try:
            JOBS[jid]["result"] = fn(prog)
            JOBS[jid].update(pct=100, label="Done")
        except Exception as e:
            JOBS[jid]["error"] = str(e) or e.__class__.__name__
        JOBS[jid]["done"] = True
    threading.Thread(target=run, daemon=True).start()
    return {"job": jid}


PREV = []


def preview(d, progress):
    """The selected file as it will be merged (page range and header/footer removal applied), for the viewer."""
    w = build([d["item"]], "Preview", progress=progress)
    dest = WORK / f"pv-{uuid.uuid4().hex[:8]}.pdf"; w.write(str(dest)); PREV.append(dest)
    while len(PREV) > 4: PREV.pop(0).unlink(missing_ok=True)
    return {"url": f"/api/pdf?path={dest.name}", "pages": len(w.pages)}


def merge(d, progress):
    title = d.get("title", "").strip()
    if not title:
        raise ValueError("Give the file a title first: it's what the app will call it.")
    w = build(d["items"], title, *bands(d), progress=progress)
    progress(99, 100, "Saving the merged file…")
    mid = uuid.uuid4().hex[:8]; dest = WORK / f"merged-{mid}.pdf"
    w.write(str(dest)); MERGED[mid] = dest
    return {"merged": mid, "name": f"{safe(title)}.pdf", "pages": len(w.pages), "mb": (f"{dest.stat().st_size // 1024} KB" if dest.stat().st_size < 1048576 else f"{dest.stat().st_size / 1048576:.1f} MB")}


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


def gh_get(cfg, path):
    head = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/vnd.github+json", "User-Agent": "rulesforge-pdfstudio"}
    url = f"{GITHUB_API}/repos/{cfg['repo']}/contents/{path}?ref={cfg['branch']}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=head)) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404: return None
        raise RuntimeError(gh_error(e))


def remote_games(d):
    """The Game / Edition folders that already exist under packs/incoming in the repository."""
    cfg = {"repo": d.get("repo", "").strip(), "branch": d.get("branch", "").strip() or "game-packs", "token": d.get("token", "").strip() or load_config().get("token", "")}
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", cfg["repo"]) or not cfg["token"]:
        raise ValueError("Fill in the repository (owner/name) and a GitHub token first.")
    games = {}
    for g in gh_get(cfg, "packs/incoming") or []:
        if g.get("type") == "dir":
            games[g["name"]] = sorted(e["name"] for e in (gh_get(cfg, f"packs/incoming/{urllib.request.quote(g['name'])}") or []) if e.get("type") == "dir")
    return {"games": games}


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
    pre = MERGED.get(d.get("merged", ""))
    if d.get("mode") == "download":
        if pre and pre.exists(): return {"download": f"/api/pdf?path={pre.name}", "name": f"{safe(title)}.pdf"}
        dest = WORK / f"{safe(title)}.pdf"
        build(d["items"], title, *bands(d)).write(str(dest))
        return {"download": f"/api/pdf?path={dest.name}", "name": dest.name}
    if not game or not edition or typ not in TYPES:
        raise ValueError("Pick the Game, Edition and Type so it lands in the right Game Pack.")
    folder = OUT / safe(game) / safe(edition) / typ
    writer = None if pre and pre.exists() else build(d["items"], title, *bands(d))   # build first, so a bad page range leaves no empty folders behind
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / f"{safe(title)}.pdf"
    if writer is None: shutil.copyfile(pre, dest)
    else: writer.write(str(dest))
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


# ---- auto-quit: the page pings while it is open; when the tab is closed the program stops itself ----
if sys.stdout is None: sys.stdout = open(os.devnull, "w")   # pythonw has no console
if sys.stderr is None: sys.stderr = open(os.devnull, "w")
SEEN = {"last": None, "bye": None, "start": __import__("time").time()}


def watch(srv):
    import time
    while True:
        time.sleep(1)
        now = time.time(); last, bye = SEEN["last"], SEEN["bye"]
        gone = (bye and now - bye > 8) or (last and now - last > 180) or (last is None and now - SEEN["start"] > 90)
        if gone:
            srv.shutdown(); return


APP_ID = "pdf-studio"; VERSION = "9"
SRV = [None]


def claim_port(port):
    """If an older copy of THIS tool holds the port, ask it to quit and take its place. Never touches the other tool."""
    base = f"http://127.0.0.1:{port}"
    try: info = json.load(urllib.request.urlopen(base + "/api/id", timeout=1.5))
    except Exception: return "free"
    if not isinstance(info, dict) or info.get("app") != APP_ID: return "free"
    if info.get("version") == VERSION: return "same"
    try: urllib.request.urlopen(urllib.request.Request(base + "/api/quit", b"{}", {"X-RF-Quit": "1"}, method="POST"), timeout=2)
    except Exception: pass
    import time as _t
    for _ in range(30):
        _t.sleep(0.2)
        try: urllib.request.urlopen(base + "/api/id", timeout=0.5)
        except Exception: return "free"
    return "busy"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def local(self):
        return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def do_GET(self):
        if self.path.split("?")[0] == "/api/id":
            return self.send(200, {"app": APP_ID, "version": VERSION})
        if self.path.split("?")[0] == "/api/ping":
            import time; SEEN["last"] = time.time(); SEEN["bye"] = None; return self.send(200, {"ok": True})
        if self.path.split("?")[0] == "/api/bye":
            import time; SEEN["bye"] = time.time(); return self.send(200, {"ok": True})
        u = urlparse(self.path)
        if not self.local(): return self.send(403, {"error": "local only"})
        if u.path == "/":
            return self.send(200, PAGE.replace("__TYPES__", json.dumps(TYPES)).encode(), "text/html; charset=utf-8")
        if u.path == "/api/info":
            c = load_config()
            return self.send(200, {"out": str(OUT), "games": existing(), "browser": bool(find_browser()), "repo": c.get("repo", "Taptap91/40k-gameforge"), "branch": c.get("branch", "game-packs"), "hasToken": bool(c.get("token"))})
        if u.path == "/api/job":
            j = JOBS.get(parse_qs(u.query).get("id", [""])[0])
            return self.send(200 if j else 404, j or {"error": "unknown job"})
        if u.path == "/api/pdf":
            p = WORK / Path(parse_qs(u.query).get("path", [""])[0]).name
            if p.exists(): return self.send(200, p.read_bytes(), "application/pdf")
        self.send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if not self.local(): return self.send(403, {"error": "local only"})
        if self.path == "/api/quit":
            if self.headers.get("X-RF-Quit") != "1": return self.send(403, {"error": "no"})
            self.send(200, {"ok": True}); threading.Timer(0.3, lambda: SRV[0] and SRV[0].shutdown()).start(); return
        n = int(self.headers.get("Content-Length", 0)); raw = self.rfile.read(n)
        try:
            if u.path == "/api/upload":
                name = safe(parse_qs(u.query).get("name", ["file.pdf"])[0])
                p = WORK / f"{uuid.uuid4().hex[:8]}.pdf"; p.write_bytes(raw)
                return self.send(200, register(p, name))
            d = json.loads(raw or b"{}")
            if u.path == "/api/capture": return self.send(200, capture(d.get("url", "").strip()))
            if u.path == "/api/page/open": return self.send(200, start_job(lambda p: open_page(d, p)))
            if u.path == "/api/page/set": return self.send(200, page_set(d))
            if u.path == "/api/page/preview": return self.send(200, live_preview(d))
            if u.path == "/api/page/shot": return self.send(200, page_shot(d))
            if u.path == "/api/page/click": return self.send(200, page_click(d))
            if u.path == "/api/preview": return self.send(200, start_job(lambda p: preview(d, p)))
            if u.path == "/api/page/print": return self.send(200, start_job(lambda p: print_page(d, p)))
            if u.path == "/api/page/cancel": close_session(d.get("sid", "")); return self.send(200, {"ok": True})
            if u.path == "/api/save": return self.send(200, save(d))
            if u.path == "/api/remote": return self.send(200, remote_games(d))
            if u.path == "/api/detect": return self.send(200, start_job(lambda p: detect(d, p)))
            if u.path == "/api/merge": return self.send(200, start_job(lambda p: merge(d, p)))
        except Exception as e:
            return self.send(400, {"error": str(e) or e.__class__.__name__})
        self.send(404, {"error": "not found"})


PAGE = r"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>RulesForge PDF Studio</title><style>
:root{color-scheme:dark;--bg:#1c1c1e;--c:#2a2a2d;--b:#3a3a3e;--t:#f2f2f4;--m:#9a9aa2;--a:#0a84ff}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:var(--bg);color:var(--t);font:14px/1.4 system-ui,sans-serif;display:grid;grid-template-columns:minmax(330px,25%) 1fr;overflow:hidden}
@media(max-width:760px){body{grid-template-columns:1fr;grid-template-rows:auto 55vh;overflow:auto}}
aside{overflow-y:auto;border-right:1px solid var(--b);background:var(--c);padding:0 12px 24px}
h1{margin:0;font-size:17px;padding:12px 0 2px}h1 small{display:block;color:var(--m);font-weight:400;font-size:11px}
#stat{position:sticky;top:0;z-index:5;background:var(--c);padding:8px 0;border-bottom:1px solid var(--b);margin-bottom:6px}
#msg{min-height:20px;font-size:13px}.err{color:#ff6b6b}.ok{color:#5ddc8b}
details.sec{border-bottom:1px solid var(--b);padding:6px 0}details.sec>summary{cursor:pointer;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--m);padding:6px 0;font-weight:600}
.drop{border:2px dashed var(--b);border-radius:10px;padding:14px;text-align:center;color:var(--m);cursor:pointer;font-size:13px}.drop.on{border-color:var(--a);color:var(--t)}
input,select,textarea,button{font:inherit;color:var(--t);background:var(--bg);border:1px solid var(--b);border-radius:8px;padding:6px 8px}input,select,textarea{width:100%}button{cursor:pointer}button.p{background:var(--a);border-color:var(--a);font-weight:600}button:disabled{opacity:.5;cursor:default}
label{display:block;margin:8px 0 2px;color:var(--m);font-size:12px}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hint{color:var(--m);font-size:12px;margin-top:3px}
.cap{display:flex;gap:6px;margin-top:8px}.cap input{flex:1;min-width:0}
.row{display:flex;gap:4px;align-items:center;background:var(--bg);border:2px solid var(--b);border-radius:8px;padding:4px 6px;margin-top:6px;cursor:pointer}.row.on{border-color:var(--a)}
.row .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.row small{color:var(--m)}.row input{width:64px;padding:2px 4px;font-size:12px}.row button{padding:1px 6px}
.bar{height:10px;border-radius:8px;background:var(--bg);border:1px solid var(--b);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;width:0;background:var(--a);transition:width .2s}
.sw{position:relative;display:grid;grid-template-columns:1fr 1fr;margin-top:10px;background:var(--bg);border:1px solid var(--b);border-radius:999px;padding:3px;isolation:isolate}.sw i{position:absolute;z-index:-1;top:3px;bottom:3px;left:3px;width:calc(50% - 3px);border-radius:999px;background:var(--a);transition:transform .25s cubic-bezier(.3,1.3,.5,1)}.sw[data-v=up] i{transform:translateX(100%)}.sw button{border:0;background:transparent;border-radius:999px;font-weight:600;font-size:13px}
.pgp{border:1px solid var(--b);border-radius:10px;padding:8px;margin-top:8px}.row2{display:flex;gap:5px;flex-wrap:wrap;margin:6px 0}.row2 button{padding:4px 8px;font-size:12px}
#ctl{max-height:220px;overflow:auto;margin:4px 0}#ctl label{display:flex;gap:6px;align-items:center;padding:2px;font-size:12px;margin:0;color:var(--t)}#ctl input{width:auto}#ctl small{color:var(--m)}
#pdl,#pup{margin-top:10px}[hidden]{display:none!important}
main{display:flex;flex-direction:column;min-width:0;min-height:0;background:#0e0e10}#vh{display:flex;gap:10px;align-items:center;padding:8px 14px;border-bottom:1px solid var(--b);background:var(--c);font-size:13px}#vt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vtabs button{padding:3px 10px;font-size:12px}#vtabs button.on{background:var(--a);border-color:var(--a)}#liveview{flex:1;overflow:auto;background:#fff}#liveview img{display:block;width:100%;cursor:pointer}#busy{color:#ff9f0a}#view{flex:1;border:0;width:100%;background:#2b2b2e}#empty{flex:1;display:grid;place-items:center;color:var(--m);text-align:center;padding:30px}
</style>
<aside>
<h1>PDF Studio <small>v9 · click the live page, per-file headers/footers</small></h1>
<div id="stat"><div id="msg"></div><div class="bar" id="bar" hidden><i id="barf"></i></div><div class="hint" id="barl"></div></div>

<details class="sec" open><summary>1 · Add a page or PDF</summary>
<div class="drop" id="drop">Drop PDFs here, or click to choose<input id="pick" type="file" accept="application/pdf" multiple hidden></div>
<div class="cap"><input id="url" placeholder="…or paste a web page address"><button id="grab">Open</button></div>
<div class="hint" id="nb"></div>
<div id="pgp" hidden class="pgp"><div class="hint" id="pgt"></div>
<div class="row2"><button data-all="tick">Tick all</button><button data-all="untick">Untick all</button><button data-all="open">Open all sections</button><button data-all="close">Close all sections</button></div>
<div id="ctl"></div>
<div class="row2"><button class="p" id="psave">Save this page as a PDF</button><button id="pcan">Cancel</button></div>
<div class="hint">The preview on the right updates after each change. Saving keeps exactly what you see.</div></div>
</details>

<details class="sec" open><summary>2 · Files (click one to view it)</summary>
<div id="list"></div><div class="hint" id="lh">Merged top to bottom. ↑ ↓ reorder. Pages is optional: <b>1-5, 8, 12-</b> keeps just those pages.</div>
</details>

<details class="sec" open><summary>3 · Headers and footers</summary>
<div class="hint" id="sf">Click a file in the list first.</div>
<div class="two"><div><label>Top %</label><input id="top" type="number" min="0" max="40" step="0.5" placeholder="0" disabled></div><div><label>Bottom %</label><input id="bot" type="number" min="0" max="40" step="0.5" placeholder="0" disabled></div></div>
<div class="row2"><button id="det" disabled>Find them automatically</button><button id="allb" disabled>Use for all files</button></div><div class="hint" id="detout"></div>
<div class="hint">The text inside these bands is deleted from the PDF, not just covered. The viewer shows the result so you can check it, then adjust the numbers if real text is too close to the edge.</div>
</details>

<details class="sec" open><summary>4 · Name it</summary>
<div class="two"><div><label>Game</label><input id="game" list="games" placeholder="Warhammer 40K"><datalist id="games"></datalist></div>
<div><label>Edition</label><input id="ed" list="eds" placeholder="11th Edition"><datalist id="eds"></datalist></div></div>
<label>Type: where it shows in the Game Pack</label><select id="type"></select>
<label>Title: what the app calls it</label><input id="title" placeholder="Codex: Space Marines">
<div id="facw"><label>Faction (for an army)</label><input id="fac" placeholder="Space Marines"></div>
<div id="kw" hidden><label>Rules kind</label><select id="rk"><option value="core">Core Rules</option><option value="updates">Update / FAQ / errata</option></select></div>
<div class="two"><div><label>Version (optional)</label><input id="ver" placeholder="2026-11"></div><div><label>Note (optional)</label><input id="desc"></div></div>
</details>

<details class="sec" open><summary>5 · Merge, then send</summary>
<button class="p" id="mg" style="width:100%">Merge the PDFs</button>
<div class="hint" id="mres">Merge first; then choose to download it or upload it.</div>
<div class="sw" id="sw" data-v="down"><i></i><button data-s="down">Download</button><button data-s="up">Upload to GitHub</button></div>
<div id="pdl"><button class="p" id="dl" style="width:100%" disabled>Download PDF</button></div>
<div id="pup" hidden>
<input type="checkbox" id="up" checked hidden>
<div class="two"><div><label>Repository</label><input id="repo" value="Taptap91/40k-gameforge"></div><div><label>Branch</label><input id="br" value="game-packs"></div></div>
<label>Token <span id="tkn"></span></label><input id="tok" type="password" autocomplete="off" placeholder="GitHub token with Contents: read and write">
<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="rem" style="width:auto"> Remember on this computer</label>
<div style="margin-top:6px"><button id="load">Load folders from GitHub</button></div>
<label>Destination <small>(only folders under packs/incoming)</small></label><select id="dest" disabled><option>Load the folders first</option></select>
<div class="hint" id="path"></div>
<div class="hint">Needs a fine-grained token limited to this one repository (GitHub › Settings › Developer settings › Fine-grained tokens › Contents: Read and write). The token only goes to github.com.</div>
<button class="p" id="save" style="width:100%;margin-top:10px" disabled>Upload to GitHub</button></div>
<div class="hint" id="out"></div>
</details>
</aside>
<main><div id="vh"><span id="vt">Nothing to show yet</span><span id="vtabs" hidden><button data-vt="live" class="on">Interactive page</button><button data-vt="pdf">PDF preview</button></span><span id="busy" hidden>Updating…</span></div>
<div id="empty">Add a PDF, or paste a web page address.<br>It will appear here so you can check it.</div><div id="liveview" hidden></div><iframe id="view" hidden></iframe></main>
<script>
setInterval(()=>fetch("/api/ping").catch(()=>{}),3000);fetch("/api/ping").catch(()=>{});addEventListener("pagehide",()=>navigator.sendBeacon&&navigator.sendBeacon("/api/bye"));
const TYPES=__TYPES__,$=id=>document.getElementById(id);let items=[],sel=-1,info={games:{}},pg=null,merged=null,sig="",remote=null;
$("type").innerHTML=Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${k} · ${v}</option>`).join("");
const esc=t=>String(t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const msg=(t,c)=>{$("msg").innerHTML=`<span class="${c||""}">${t}</span>`};
const api=async(p,b)=>{const r=await fetch(p,{method:"POST",body:b});const j=await r.json();if(!r.ok)throw Error(j.error);return j};
const prog=(on,pct,label)=>{$("bar").hidden=!on;$("barf").style.width=pct+"%";$("barl").textContent=on?`${pct}%  ${label||""}`:""};
async function job(path,body){const {job:id}=await api(path,body);for(;;){const j=await (await fetch("/api/job?id="+id)).json();prog(true,j.pct,j.label);if(j.done){if(j.error)throw Error(j.error);return j.result}await new Promise(r=>setTimeout(r,250))}}
function show(url,label){$("empty").hidden=true;$("liveview").hidden=true;$("view").hidden=false;$("view").src=url+"#toolbar=1&navpanes=0&view=FitH";$("vt").textContent=label}
function blank(t){$("liveview").hidden=true;$("vtabs").hidden=true;$("view").hidden=true;$("view").removeAttribute("src");$("empty").hidden=false;$("empty").innerHTML=t;$("vt").textContent="Nothing to show yet"}

/* ---- files list and per-file headers/footers ---- */
function draw(){$("list").innerHTML=items.map((f,i)=>`<div class="row ${i===sel?"on":""}" data-s="${i}"><span class="n" data-s="${i}">${esc(f.name)} <small>${f.pages}p${f.top||f.bottom?` · −${f.top||0}%/−${f.bottom||0}%`:""}</small></span><input data-r="${i}" value="${esc(f.range||"")}" placeholder="all pages"><button data-u="${i}">↑</button><button data-d="${i}">↓</button><button data-x="${i}">✕</button></div>`).join("");
 const f=items[sel];$("top").disabled=$("bot").disabled=$("det").disabled=!f;$("allb").disabled=!f;$("top").value=f?f.top||"":"";$("bot").value=f?f.bottom||"":"";$("sf").textContent=f?`For: ${f.name}`:"Click a file in the list first."}
$("list").onclick=e=>{const g=k=>e.target.dataset[k];
 if(g("x")!=null){const i=+g("x");items.splice(i,1);sel=Math.min(sel>i?sel-1:sel,items.length-1);draw();items.length?(sel>=0&&preview()):blank("Add a PDF, or paste a web page address.");return}
 if(g("u")>0){const i=+g("u");[items[i-1],items[i]]=[items[i],items[i-1]];if(sel===i)sel--;else if(sel===i-1)sel++;draw();return}
 if(g("d")!=null){const i=+g("d");if(i<items.length-1){[items[i+1],items[i]]=[items[i],items[i+1]];if(sel===i)sel++;else if(sel===i+1)sel--;draw()}return}
 if(g("s")!=null&&e.target.tagName!=="INPUT"){choose(+g("s"))}};
$("list").oninput=e=>{if(e.target.dataset.r!=null){items[e.target.dataset.r].range=e.target.value;if(+e.target.dataset.r===sel)later()}};
function choose(i){if(pg)return msg("Save or cancel the open web page first.","err");sel=i;draw();preview()}
let pt=null;const later=()=>{clearTimeout(pt);pt=setTimeout(preview,700)};
async function preview(){const f=items[sel];if(!f||pg)return;$("busy").hidden=false;try{const r=await job("/api/preview",JSON.stringify({item:{id:f.id,range:f.range||"",top:f.top||0,bottom:f.bottom||0}}));if(items[sel]===f){show(r.url,`${f.name} · ${r.pages} pages${f.top||f.bottom?" · headers/footers removed":""}`)}}catch(e){msg(e.message,"err")}prog(false);$("busy").hidden=true}
$("top").oninput=$("bot").oninput=()=>{const f=items[sel];if(!f)return;f.top=+$("top").value||0;f.bottom=+$("bot").value||0;later();gate()};
$("det").onclick=async()=>{const f=items[sel];if(!f)return;$("det").disabled=true;msg("Looking for repeated header and footer lines…");try{const r=await job("/api/detect",JSON.stringify({items:[{id:f.id,range:f.range||""}]}));f.top=r.top||0;f.bottom=r.bottom||0;$("detout").textContent=r.found.length?"Found: "+r.found.join(" · "):"Nothing repeated found.";msg("Search finished. Check the preview on the right.","ok");draw();await preview()}catch(e){msg(e.message,"err")}prog(false);$("det").disabled=false;gate()};
$("allb").onclick=()=>{const f=items[sel];if(!f)return;items.forEach(x=>{x.top=f.top||0;x.bottom=f.bottom||0});draw();msg("Same header/footer sizes set for every file.","ok");gate()};
async function add(files){for(const f of files){if(!/pdf$/i.test(f.name)){msg(`${f.name} isn't a PDF`,"err");continue}msg(`Reading ${f.name}…`);try{items.push({...await api("/api/upload?name="+encodeURIComponent(f.name),f),top:0,bottom:0});sel=items.length-1}catch(e){msg(e.message,"err")}}draw();msg("");if(!pg)preview()}
$("drop").onclick=()=>$("pick").click();$("pick").onchange=e=>add(e.target.files);
$("drop").ondragover=e=>{e.preventDefault();$("drop").classList.add("on")};$("drop").ondragleave=()=>$("drop").classList.remove("on");
$("drop").ondrop=e=>{e.preventDefault();$("drop").classList.remove("on");add(e.dataTransfer.files)};

/* ---- opening a web page: live preview, tick/untick, then save as a PDF ---- */
function drawCtl(){$("ctl").innerHTML=pg.controls.map(c=>c.type==="button"?`<label><button data-click="${c.i}">${esc(c.label)}</button> <small>(button on the page)</small></label>`:`<label><input type="checkbox" data-c="${c.i}" ${c.state?"checked":""}> ${esc(c.label)} <small>${c.type==="checkbox"?"checkbox":"section"}</small></label>`).join("")||"<small>No checkboxes or show/hide sections found on this page.</small>"}
let rf=false,again=false,vmode="live",chunks=[];
async function shot(){const r=await api("/api/page/shot",JSON.stringify({sid:pg.sid}));chunks=r.chunks;const st=$("liveview").scrollTop;$("liveview").innerHTML=r.chunks.map((c,i)=>`<img data-ci="${i}" draggable="false" src="${c.src}">`).join("");$("liveview").scrollTop=st;$("empty").hidden=true;$("view").hidden=true;$("liveview").hidden=false;$("vt").textContent="Click things on the page to show or hide them: "+(pg.title||pg.url)}
async function refresh(){if(!pg)return;if(rf){again=true;return}rf=true;$("busy").hidden=false;try{do{again=false;if(vmode==="live")await shot();else{const r=await api("/api/page/preview",JSON.stringify({sid:pg.sid}));if(pg)show(r.url,"PDF preview of "+(pg.title||pg.url)+" (this is what will be saved)")}}while(again&&pg)}catch(e){msg(e.message,"err")}rf=false;$("busy").hidden=true}
$("vtabs").onclick=e=>{const v=e.target.dataset.vt;if(!v||!pg)return;vmode=v;[...$("vtabs").children].forEach(b=>b.classList.toggle("on",b.dataset.vt===v));refresh()};
$("liveview").onclick=async e=>{const im=e.target.closest("img");if(!im||!pg||rf)return;const c=chunks[+im.dataset.ci],r=im.getBoundingClientRect();const x=(e.clientX-r.left)/r.width*1280,y=c.y+(e.clientY-r.top)/r.height*c.h;rf=true;$("busy").hidden=false;try{const j=await api("/api/page/click",JSON.stringify({sid:pg.sid,x,y}));pg.controls=j.controls;drawCtl();await shot()}catch(err){msg(err.message,"err")}rf=false;$("busy").hidden=true};
async function setOps(ops){try{const r=await api("/api/page/set",JSON.stringify({sid:pg.sid,ops}));r.states.forEach(s=>{const c=pg.controls.find(x=>x.i===s.i);if(c)c.state=s.state});drawCtl();refresh()}catch(e){msg(e.message,"err")}}
async function openPage(){const u=$("url").value.trim();if(!u)return;if(pg)await cancelPage();$("grab").disabled=true;msg("Opening the page…");blank("Opening the page…");try{pg=await job("/api/page/open",JSON.stringify({url:u}));pg.url=u;$("pgt").textContent=`Opened: ${pg.title||u}. Click things on the page itself, or use the list below.`;drawCtl();$("pgp").hidden=false;vmode="live";$("vtabs").hidden=false;[...$("vtabs").children].forEach(b=>b.classList.toggle("on",b.dataset.vt==="live"));await shot();msg("Page ready. Click show/hide buttons right on the page, or use the list on the left, then save it.","ok")}catch(e){pg=null;msg(e.message,"err");items.length?preview():blank("Add a PDF, or paste a web page address.")}prog(false);$("grab").disabled=false}
$("grab").onclick=openPage;$("url").onkeydown=e=>{if(e.key==="Enter")openPage()};
$("ctl").onchange=e=>{const i=e.target.dataset.c;if(i==null)return;const c=pg.controls.find(x=>x.i==i);setOps([{i:+i,kind:c.type,v:e.target.checked}])};
$("ctl").onclick=e=>{const i=e.target.dataset.click;if(i!=null){const c=pg.controls.find(x=>x.i==i);setOps([{i:+i,kind:"button",v:/^(show|expand)/i.test(c.label)}])}};
$("pgp").onclick=e=>{const a=e.target.dataset.all;if(!a||!pg)return;const on=a==="tick"||a==="open",sec=a==="open"||a==="close";setOps(pg.controls.filter(c=>sec?(c.type!=="checkbox"):c.type==="checkbox").map(c=>({i:c.i,kind:c.type,v:on})))};
async function cancelPage(){const s=pg&&pg.sid;pg=null;$("vtabs").hidden=true;$("pgp").hidden=true;if(s)await api("/api/page/cancel",JSON.stringify({sid:s})).catch(()=>{});msg("");items.length?preview():blank("Add a PDF, or paste a web page address.")}
$("pcan").onclick=cancelPage;
$("psave").onclick=async()=>{$("psave").disabled=true;msg("Saving the page as a PDF…");try{const f=await job("/api/page/print",JSON.stringify({sid:pg.sid}));pg=null;$("vtabs").hidden=true;$("pgp").hidden=true;$("url").value="";items.push({...f,top:0,bottom:0});sel=items.length-1;draw();msg("Saved. Now press “Find them automatically” to remove its header and footer, then check the preview. Paste another address for the next page.","ok");prog(false);await preview()}catch(e){msg(e.message,"err")}prog(false);$("psave").disabled=false};

/* ---- naming and the Game Pack destination ---- */
function dests(){const o=[];for(const[g,es]of Object.entries(remote.games)){if(!es.length)o.push([g,""]);es.forEach(e=>o.push([g,e]))}return o}
$("load").onclick=async()=>{msg("Reading the repository…");try{remote=await api("/api/remote",JSON.stringify({repo:$("repo").value,branch:$("br").value,token:$("tok").value}));const o=dests();
$("dest").innerHTML=o.map(([g,e],i)=>`<option value="${i}">${g}${e?" / "+e:" (no edition yet)"}</option>`).join("")+`<option value="new">＋ New Game Pack…</option>`;$("dest").disabled=false;$("up").checked=true;pickDest();msg("Folders loaded.","ok")}catch(e){msg(e.message,"err")}};
function paint(){$("path").textContent=$("dest").value==="new"?"A new Game Pack: type its Game and Edition above. The folders are created when you upload.":"Uploads to packs/incoming/"+$("game").value+"/"+($("ed").value||"…")+"/"+$("type").value+"/"}
function pickDest(){const v=$("dest").value,fresh=v==="new";$("game").readOnly=!fresh;$("ed").readOnly=!fresh;
if(!fresh){const[g,e]=dests()[+v];$("game").value=g;$("ed").value=e;$("ed").readOnly=!!e}else{$("game").value=$("ed").value="";$("game").focus()}paint()}
$("dest").onchange=pickDest;for(const id of["type","game","ed"])$(id).addEventListener("input",()=>{if(remote)paint()});$("type").addEventListener("change",()=>{if(remote)paint()});
function sync(){const t=$("type").value;$("facw").hidden=t!=="Factions";$("kw").hidden=t!=="Rules";$("eds").innerHTML=(info.games[$("game").value]||[]).map(e=>`<option value="${e}">`).join("")}
$("type").onchange=$("game").oninput=sync;
const form=m=>({github:$("up").checked&&m==="folder"?{repo:$("repo").value,branch:$("br").value,token:$("tok").value,remember:$("rem").checked}:null,mode:m,items:items.map(i=>({id:i.id,range:i.range||"",top:i.top||0,bottom:i.bottom||0})),game:$("game").value,edition:$("ed").value,type:$("type").value,title:$("title").value,faction:$("fac").value,rulesKind:$("rk").value,version:$("ver").value,description:$("desc").value});

/* ---- merge, then download or upload ---- */
const signature=()=>JSON.stringify([items.map(i=>[i.id,i.range||"",i.top||0,i.bottom||0]),$("title").value]);
function mode(v){$("sw").dataset.v=v;$("pdl").hidden=v!=="down";$("pup").hidden=v!=="up"}
$("sw").onclick=e=>{const v=e.target.dataset.s;if(v)mode(v)};
function gate(){const ok=merged&&sig===signature();$("save").disabled=$("dl").disabled=!ok;if(merged&&!ok)$("mres").textContent="Something changed since the merge: merge again before downloading or uploading."}
document.addEventListener("input",()=>setTimeout(gate,0));document.addEventListener("click",()=>setTimeout(gate,0));
$("mg").onclick=async()=>{if(!items.length)return msg("Add a PDF first.","err");$("mg").disabled=true;merged=null;gate();prog(true,0,"Starting…");try{const r=await job("/api/merge",JSON.stringify(form("download")));merged=r.merged;sig=signature();$("mres").textContent=`Merged ${r.pages} pages (${r.mb}). Now download it or upload it.`;msg("Merge finished.","ok");gate();show(`/api/pdf?path=merged-${r.merged}.pdf`,`Merged: ${r.name} · ${r.pages} pages`)}catch(e){msg(e.message,"err");prog(false)}$("mg").disabled=false};
$("save").onclick=async()=>{$("save").disabled=true;prog(true,100,"Uploading / saving…");try{const r=await api("/api/save",JSON.stringify({...form("folder"),merged}));msg(r.uploaded?`Saved ${r.pages} pages and uploaded to ${r.uploaded}. The converter will pick it up in a minute or two.`:`Saved ${r.pages} pages to ${r.saved}. Commit and push it to GitHub; the pack converter does the rest.`,"ok")}catch(e){msg(e.message,"err")}prog(false);gate()};
$("dl").onclick=async()=>{try{const r=await api("/api/save",JSON.stringify({...form("download"),merged}));const a=document.createElement("a");a.href=r.download;a.download=r.name;a.click();msg("Downloaded.","ok")}catch(e){msg(e.message,"err")}};
fetch("/api/info").then(r=>r.json()).then(j=>{info=j;$("repo").value=j.repo;$("br").value=j.branch;if(j.hasToken)$("tkn").textContent="(saved: leave blank to use it)";$("games").innerHTML=Object.keys(j.games).map(g=>`<option value="${g}">`).join("");$("out").textContent="Saves into: "+j.out;if(!j.browser)$("nb").textContent="Opening web pages needs Chrome or Edge installed; none was found.";sync()});sync();draw();
</script></html>
"""

def _alert(text):
    try: (Path(__file__).resolve().parent / "pdf-studio-error.txt").write_text(text, "utf-8")
    except Exception: pass
    try:
        import tkinter, tkinter.messagebox
        r = tkinter.Tk(); r.withdraw(); r.attributes("-topmost", True); tkinter.messagebox.showerror("RulesForge PDF Studio", text); r.destroy()
    except Exception:
        try:
            import ctypes; ctypes.windll.user32.MessageBoxW(0, text, "RulesForge PDF Studio", 0x10)
        except Exception: print(text)


def main():
    port = int(os.environ.get("PORT", 8940))
    st = claim_port(port)
    if st == "same":   # already running this exact version: just open it
        if not os.environ.get("NO_BROWSER"): webbrowser.open(f"http://127.0.0.1:{port}")
        return
    for attempt in range(25):   # an older copy may still be running on the same port; use the next free one
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), H); SRV[0] = srv; break
        except OSError:
            port += 1
    else:
        raise SystemExit("Couldn't find a free port. Close other PDF Studio windows and try again.")
    if port != int(os.environ.get("PORT", 8940)):
        print("NOTE: an older PDF Studio is still open in another window; this new one is using a different address. Close the old window.")
    print(f"PDF Studio is running at http://127.0.0.1:{port}  (Ctrl+C to quit)\nSaving to: {OUT}")
    if not os.environ.get("NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    if not os.environ.get("NO_BROWSER"): threading.Thread(target=watch, args=(srv,), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        import traceback; _alert("PDF Studio couldn't start:\n\n" + traceback.format_exc()[-900:]); sys.exit(1)
