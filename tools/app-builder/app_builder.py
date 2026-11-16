#!/usr/bin/env python3
"""RulesForge App Builder: change how the app looks and is laid out, visually, for desktop, tablet and phone.

Run:  python app_builder.py [path-to-your-RulesForge-folder]     (needs only Python 3; nothing to install)
It opens in your browser on this computer only. The real app runs inside the editor; click any part of it, change
colours, sizes, spacing, visibility, layout, order and text, and watch it update. Save writes custom/custom.json in
your RulesForge folder (the app reads it on load); Publish sends that file and any pictures you added to GitHub.
"""
import base64, json, mimetypes, os, re, sys, threading, urllib.error, urllib.request, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
GITHUB_API = os.environ.get("GITHUB_API", "https://api.github.com")
CONFIG = Path.home() / ".rulesforge-appbuilder.json"


def alert(text):
    """Windowless launches have no console, so problems are shown in a dialog and saved next to the program."""
    try: (HERE / "app-builder-error.txt").write_text(text, "utf-8")
    except Exception: pass
    try:
        import tkinter, tkinter.messagebox
        r = tkinter.Tk(); r.withdraw(); r.attributes("-topmost", True); tkinter.messagebox.showerror("RulesForge App Builder", text); r.destroy()
    except Exception:
        try:
            import ctypes; ctypes.windll.user32.MessageBoxW(0, text, "RulesForge App Builder", 0x10)
        except Exception: print(text)


def valid_app(c):
    return bool(c) and (Path(c) / "index.html").is_file() and (Path(c) / "js" / "main.js").is_file()


def find_app():
    saved = Path.home() / ".rulesforge-appfolder.txt"
    cands = [sys.argv[1] if len(sys.argv) > 1 else None, os.environ.get("RF_APP"), *[str(p) for p in [HERE, *HERE.parents]]]
    try: cands.append(saved.read_text("utf-8").strip())
    except Exception: pass
    for c in cands:
        if valid_app(c): return Path(c).resolve()
    try:   # first run: ask where the RulesForge folder is
        import tkinter, tkinter.filedialog, tkinter.messagebox
        r = tkinter.Tk(); r.withdraw(); r.attributes("-topmost", True)
        tkinter.messagebox.showinfo("RulesForge App Builder", "First, choose your RulesForge folder: the one that contains index.html and a js folder.\n(Download the app from GitHub as a ZIP and unzip it if you don't have it yet.)")
        while True:
            c = tkinter.filedialog.askdirectory(title="Choose your RulesForge folder")
            if not c: r.destroy(); sys.exit(0)
            if valid_app(c):
                saved.write_text(c, "utf-8"); r.destroy(); return Path(c).resolve()
            tkinter.messagebox.showwarning("RulesForge App Builder", "That folder doesn't contain index.html and a js folder. Pick the main RulesForge folder.")
    except SystemExit: raise
    except Exception: pass
    alert("App Builder needs your RulesForge folder (the one containing index.html and js/).\nRun:  python app_builder.py \"C:\\path\\to\\RulesForge\"")
    sys.exit(1)


APP = find_app()
CUSTOM = APP / "custom" / "custom.json"
DEFAULT = {"version": 4, "css": "", "labels": [], "pages": [], "elements": [], "actions": [], "styles": [], "applied": [], "locks": [], "names": [], "groups": [], "templates": [], "rules": {"all": {}, "desktop": {}, "tablet": {}, "phone": {}}}
ASSETS = APP / "custom" / "assets"
LISTS = ("labels", "pages", "elements", "actions", "styles", "applied", "locks", "names", "groups", "templates")


def load_custom():
    try:
        d = json.loads(CUSTOM.read_text("utf-8"))
        d.setdefault("rules", DEFAULT["rules"]); d.setdefault("css", "")
        for k in LISTS: d.setdefault(k, [])
        for k in DEFAULT["rules"]: d["rules"].setdefault(k, {})
        return d
    except Exception:
        return json.loads(json.dumps(DEFAULT))


def change_text(d):
    """Change one piece of visible text in the app's own index.html, so the code itself says the new name.
    d = {"from": old text, "to": new text, "attr": 'data-view="lists"' or 'id="listsTitle"'} (attr says which element).
    Only writes when the text is found exactly once inside that element, so nothing is guessed."""
    import html as _h
    old, new, attr = (d.get("from") or "").strip(), (d.get("to") or "").strip(), (d.get("attr") or "").strip()
    if not old or not new: raise RuntimeError("Nothing to change.")
    if not attr: return {"changed": 0, "reason": "no-locator"}
    f = APP / "index.html"
    src = f.read_bytes().decode("utf-8")
    m = re.search(r"<([a-zA-Z0-9]+)\b[^>]*\b" + re.escape(attr) + r"[^>]*>", src)
    if not m: return {"changed": 0, "reason": "element-not-found"}
    tag = m.group(1)
    end = src.find("</" + tag + ">", m.end())
    if end < 0: return {"changed": 0, "reason": "element-not-closed"}
    inner = src[m.end() - 1:end]  # starts at the '>' that closes the opening tag
    pat = re.compile(r"(>\s*)" + re.escape(_h.escape(old, quote=False)) + r"(?=\s*(?:<|\Z))")
    hits = len(pat.findall(inner))
    if hits != 1: return {"changed": 0, "reason": "text-found-%d-times" % hits}
    inner2 = pat.sub(lambda g: g.group(1) + _h.escape(new, quote=False), inner, count=1)
    f.write_bytes((src[:m.end() - 1] + inner2 + src[end:]).encode("utf-8"))
    return {"changed": 1, "file": "index.html"}


def save_custom(d):
    if not isinstance(d, dict) or not isinstance(d.get("css", ""), str) or any(not isinstance(d.get(k, []), list) for k in LISTS):
        raise ValueError("That doesn't look like App Builder data.")
    if len(json.dumps(d)) > 2_000_000:
        raise ValueError("Too many changes in one file.")
    out = {"version": 4, "css": d.get("css", ""), **{k: d.get(k, []) for k in LISTS}, "rules": d.get("rules", DEFAULT["rules"])}
    CUSTOM.parent.mkdir(parents=True, exist_ok=True)
    if CUSTOM.exists():
        CUSTOM.with_suffix(".json.bak").write_bytes(CUSTOM.read_bytes())
    tmp = CUSTOM.with_suffix(".tmp"); tmp.write_text(json.dumps(out, indent=1, ensure_ascii=False), "utf-8"); tmp.replace(CUSTOM)
    return out


def save_asset(name, raw):
    name = re.sub(r"[^\w.-]", "_", Path(name).name)[:80] or "image"
    if not re.search(r"\.(png|jpe?g|gif|webp|svg)$", name, re.I):
        raise ValueError("Use a PNG, JPG, GIF, WebP or SVG image.")
    if len(raw) > 8_000_000:
        raise ValueError("That image is over 8 MB; make it smaller first.")
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / name).write_bytes(raw)
    return {"src": f"custom/assets/{name}"}


def put_file(cfg, head, rel, data, message):
    url = f"{GITHUB_API}/repos/{cfg['repo']}/contents/" + "/".join(urllib.request.quote(p) for p in rel.split("/"))
    sha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{url}?ref={cfg['branch']}", headers=head)) as r: sha = json.load(r).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404: raise RuntimeError(gh_error(e))
    body = {"message": message, "content": base64.b64encode(data).decode(), "branch": cfg["branch"]}
    if sha: body["sha"] = sha
    try:
        with urllib.request.urlopen(urllib.request.Request(url, json.dumps(body).encode(), {**head, "Content-Type": "application/json"}, method="PUT")): pass
    except urllib.error.HTTPError as e:
        raise RuntimeError(gh_error(e))


def publish(d):
    cfg = {"repo": d.get("repo", "").strip(), "branch": d.get("branch", "").strip() or "main", "token": d.get("token", "").strip()}
    try: saved = json.loads(CONFIG.read_text("utf-8"))
    except Exception: saved = {}
    cfg["token"] = cfg["token"] or saved.get("token", "")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", cfg["repo"]) or not cfg["token"]:
        raise ValueError("Fill in the repository (owner/name), the branch and a GitHub token.")
    if d.get("remember"):
        CONFIG.write_text(json.dumps(cfg), "utf-8")
        try: CONFIG.chmod(0o600)
        except OSError: pass
    saved = save_custom(d["data"])
    head = {"Authorization": f"Bearer {cfg['token']}", "Accept": "application/vnd.github+json", "User-Agent": "rulesforge-appbuilder"}
    msg = "Update the app design (App Builder)"
    # Pictures first, so they are there when the page that shows them goes live.
    for src in sorted(set(re.findall(r"custom/assets/[\w.-]+\.(?:png|jpe?g|gif|webp|svg)", json.dumps(saved)))):
        f = APP / src
        if f.is_file(): put_file(cfg, head, src, f.read_bytes(), msg)
    put_file(cfg, head, "custom/custom.json", CUSTOM.read_bytes(), msg)
    return {"published": f"{cfg['repo']}@{cfg['branch']}:custom/custom.json"}


def gh_error(e):
    try: msg = json.load(e).get("message", "")
    except Exception: msg = ""
    hint = {401: "GitHub didn't accept the token.", 403: "The token can't write to this repository (it needs Contents: Read and write).", 404: "GitHub can't find that repository or branch with this token."}.get(e.code, "")
    return f"GitHub said {e.code}: {msg} {hint}".strip()


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


APP_ID = "app-builder"; VERSION = "15"
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
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(data)

    def local(self): return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def do_GET(self):
        if self.path.split("?")[0] == "/api/id":
            return self.send(200, {"app": APP_ID, "version": VERSION, "folder": str(APP)})
        if self.path.split("?")[0] == "/api/ping":
            import time; SEEN["last"] = time.time(); SEEN["bye"] = None; return self.send(200, {"ok": True})
        if self.path.split("?")[0] == "/api/bye":
            import time; SEEN["bye"] = time.time(); return self.send(200, {"ok": True})
        if not self.local(): return self.send(403, {"error": "local only"})
        p = self.path.split("?")[0]
        if p == "/": return self.send(200, (HERE / "builder.html").read_bytes(), "text/html; charset=utf-8")
        if p == "/api/custom": return self.send(200, load_custom())
        if p == "/api/info": return self.send(200, {"app": str(APP)})
        if p.startswith("/app/"):
            rel = p[5:] or "index.html"
            f = (APP / rel.lstrip("/")).resolve()
            if f.is_dir(): f = f / "index.html"
            if APP in f.parents and f.is_file():
                ct = {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html"}.get(f.suffix) or mimetypes.guess_type(str(f))[0] or "application/octet-stream"
                return self.send(200, f.read_bytes(), ct)
        self.send(404, {"error": "not found"})

    def do_POST(self):
        if not self.local(): return self.send(403, {"error": "local only"})
        if self.path == "/api/quit":
            if self.headers.get("X-RF-Quit") != "1": return self.send(403, {"error": "no"})
            self.send(200, {"ok": True}); threading.Timer(0.3, lambda: SRV[0] and SRV[0].shutdown()).start(); return
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            if self.path.startswith("/api/asset"):
                from urllib.parse import parse_qs, urlparse
                return self.send(200, save_asset(parse_qs(urlparse(self.path).query).get("name", ["image"])[0], raw))
            d = json.loads(raw or b"{}")
            if self.path == "/api/custom": save_custom(d); return self.send(200, {"saved": str(CUSTOM)})
            if self.path == "/api/publish": return self.send(200, publish(d))
            if self.path == "/api/source/text": return self.send(200, change_text(d))
        except Exception as e:
            return self.send(400, {"error": str(e) or e.__class__.__name__})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8960))
    if claim_port(port) == "same":   # already running this exact version: just open it
        if not os.environ.get("NO_BROWSER"): webbrowser.open(f"http://127.0.0.1:{port}")
        sys.exit(0)
    for _ in range(25):   # an older copy may still hold the port; use the next free one
        try: srv = ThreadingHTTPServer(("127.0.0.1", port), H); break
        except OSError: port += 1
    else:
        alert("Couldn't find a free port. Close other App Builder windows and try again."); sys.exit(1)
    SRV[0] = srv
    print(f"App Builder is running at http://127.0.0.1:{port}  (Ctrl+C to quit)\nEditing the app in: {APP}")
    if not os.environ.get("NO_BROWSER"): threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    if not os.environ.get("NO_BROWSER"): threading.Thread(target=watch, args=(srv,), daemon=True).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
