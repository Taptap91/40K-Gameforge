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


def find_app():
    cands = [sys.argv[1] if len(sys.argv) > 1 else None, os.environ.get("RF_APP"), *[str(p) for p in [HERE, *HERE.parents]]]
    for c in cands:
        if c and (Path(c) / "index.html").is_file() and (Path(c) / "js" / "main.js").is_file():
            return Path(c).resolve()
    sys.exit("App Builder needs your RulesForge folder (the one containing index.html and js/).\nRun:  python app_builder.py \"C:\\path\\to\\RulesForge\"")


APP = find_app()
CUSTOM = APP / "custom" / "custom.json"
DEFAULT = {"version": 4, "css": "", "labels": [], "pages": [], "elements": [], "actions": [], "styles": [], "applied": [], "locks": [], "names": [], "groups": [], "rules": {"all": {}, "desktop": {}, "tablet": {}, "phone": {}}}
ASSETS = APP / "custom" / "assets"
LISTS = ("labels", "pages", "elements", "actions", "styles", "applied", "locks", "names", "groups")


def load_custom():
    try:
        d = json.loads(CUSTOM.read_text("utf-8"))
        d.setdefault("rules", DEFAULT["rules"]); d.setdefault("css", "")
        for k in LISTS: d.setdefault(k, [])
        for k in DEFAULT["rules"]: d["rules"].setdefault(k, {})
        return d
    except Exception:
        return json.loads(json.dumps(DEFAULT))


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



class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(data)

    def local(self): return self.headers.get("Host", "").split(":")[0] in ("127.0.0.1", "localhost")

    def do_GET(self):
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
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            if self.path.startswith("/api/asset"):
                from urllib.parse import parse_qs, urlparse
                return self.send(200, save_asset(parse_qs(urlparse(self.path).query).get("name", ["image"])[0], raw))
            d = json.loads(raw or b"{}")
            if self.path == "/api/custom": save_custom(d); return self.send(200, {"saved": str(CUSTOM)})
            if self.path == "/api/publish": return self.send(200, publish(d))
        except Exception as e:
            return self.send(400, {"error": str(e) or e.__class__.__name__})
        self.send(404, {"error": "not found"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8960))
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"App Builder is running at http://127.0.0.1:{port}  (Ctrl+C to quit)\nEditing the app in: {APP}")
    if not os.environ.get("NO_BROWSER"): threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    if not os.environ.get("NO_BROWSER"): threading.Thread(target=watch, args=(srv,), daemon=True).start()
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
