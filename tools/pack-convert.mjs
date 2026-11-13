#!/usr/bin/env node
/* RulesForge · tools/pack-convert.mjs
 * Converts every PDF under packs/incoming/ into a component of a Game Pack bundle in packs/index.json,
 * using the app's own PDF-parsing pipeline (tools/convert.js) run headlessly in Chromium via Playwright
 * — see tools/convert.js's header comment for why a real browser is required.
 *
 * Run locally:   node tools/pack-convert.mjs
 * Run in CI:     .github/workflows/convert-packs.yml calls this on every push that touches packs/incoming/**
 *
 * Folder layout decides which bundle a PDF belongs to and what kind of content it is — a volunteer just
 * drops a PDF in the right place, no metadata file required:
 *
 *   packs/incoming/<Game>/<Edition>/Rules/<name>.pdf       → Core Rules, a rules update/FAQ, or a mission
 *                                                             pack (auto-detected) in the "<Game> - <Edition>"
 *                                                             bundle
 *   packs/incoming/<Game>/<Edition>/Factions/<name>.pdf    → a faction in the "<Game> - <Edition>" bundle
 *
 * A PDF that isn't nested exactly like that (missing the Game, Edition, or Rules/Factions folder) is
 * skipped with a warning rather than guessed at.
 *
 * An optional sidecar <name>.json right beside the PDF can override the auto-detected details — every
 * field in it is optional:
 *   {
 *     "title": "Space Marines",      // defaults to the PDF's own title
 *     "faction": "Space Marines",    // Factions/ only — defaults to what's detected in the PDF
 *     "kind": "updates",             // Rules/ only — "core" (default) or "updates", for a rules update/FAQ
 *                                     // that isn't the full rulebook (a mission pack is detected automatically)
 *     "version": "1.0.0",            // defaults to today's date — lets the app detect updates
 *     "description": "…"             // shown under the title in the app
 *   }
 * On success the PDF and its sidecar (if any) are deleted — the app only ever fetches the small .xlsx
 * that replaces them — and packs/index.json is updated in place, adding or replacing that one component
 * inside its bundle (other components, and other bundles, are left untouched).
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, writeFile, rm, readdir, mkdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INCOMING = path.join(ROOT, "packs", "incoming");
const PACKS_DIR = path.join(ROOT, "packs");
const INDEX_PATH = path.join(PACKS_DIR, "index.json");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
}

/** Every *.pdf under `dir`, at any depth, as absolute paths. */
async function findPdfs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findPdfs(full));
    else if (/\.pdf$/i.test(entry.name)) out.push(full);
  }
  return out;
}

/** Parses packs/incoming/<Game>/<Edition>/<Rules|Factions>/<file>.pdf into its parts, or null if the PDF
 *  isn't nested that way. */
function parseLocation(pdfPath) {
  const rel = path.relative(INCOMING, pdfPath).split(path.sep);
  if (rel.length !== 4) return null;
  const [game, edition, bucket] = rel;
  const b = bucket.trim().toLowerCase();
  if (b !== "rules" && b !== "factions") return null;
  return { game, edition, bucket: b === "rules" ? "Rules" : "Factions" };
}

function serveRoot(root, port) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqPath = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(root, reqPath === "/" ? "/index.html" : reqPath);
      if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (!existsSync(filePath)) { res.writeHead(404); res.end(); return; }
      res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(port, () => resolve(server));
  });
}

async function loadIndex() {
  if (!existsSync(INDEX_PATH)) return { _readme: "The Game Packs catalog.", packs: [] };
  return JSON.parse(await readFile(INDEX_PATH, "utf8"));
}

/** Finds (or creates) the bundle for a Game + Edition, and returns it along with whether it's new. */
function getBundle(index, game, edition) {
  const id = slugify(`${game}-${edition}`);
  let bundle = index.packs.find(p => p.id === id);
  if (!bundle) {
    bundle = { id, title: `${game} - ${edition}`, game, editionTag: edition, components: [] };
    index.packs.push(bundle);
  }
  return bundle;
}

/** The key a component is matched/replaced by, so re-uploading the same faction or the same rules
 *  update doesn't create a duplicate entry. */
function componentKey(entry) {
  if (entry.kind === "faction") return `faction:${entry.faction.trim().toLowerCase()}`;
  if (entry.kind === "core") return "core";
  return `${entry.kind}:${entry.title.trim().toLowerCase()}`;
}

async function main() {
  if (!existsSync(INCOMING)) { console.log("No packs/incoming/ folder — nothing to convert."); return; }
  const pdfPaths = await findPdfs(INCOMING);
  if (!pdfPaths.length) { console.log("No PDFs in packs/incoming/ — nothing to convert."); return; }

  const port = 8923;
  const server = await serveRoot(ROOT, port);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/tools/convert-harness.html`);

  const index = await loadIndex();
  const results = { converted: [], skipped: [] };

  for (const pdfPath of pdfPaths) {
    const pdfName = path.relative(INCOMING, pdfPath);
    const loc = parseLocation(pdfPath);
    if (!loc) {
      console.warn(`Skipping ${pdfName}: expected packs/incoming/<Game>/<Edition>/Rules|Factions/${path.basename(pdfPath)}`);
      results.skipped.push({ file: pdfName, reason: "not nested as <Game>/<Edition>/Rules|Factions/" });
      continue;
    }
    const metaPath = pdfPath.replace(/\.pdf$/i, ".json");
    let meta = {};
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(await readFile(metaPath, "utf8")); }
      catch (err) { console.warn(`Skipping ${pdfName}: sidecar .json is invalid: ${err.message}`); results.skipped.push({ file: pdfName, reason: "invalid sidecar json" }); continue; }
    }

    try {
      const bytes = await readFile(pdfPath);
      const base64 = bytes.toString("base64");
      const opts = { kind: loc.bucket === "Factions" ? "faction" : (meta.kind === "updates" ? "updates" : "core"), faction: loc.bucket === "Factions" ? (meta.faction || "") : "" };
      const result = await page.evaluate(([b64, name, o]) => window.__convertPdf(b64, name, o), [base64, path.basename(pdfPath), opts]);

      const title = meta.title || result.title;
      const bundle = getBundle(index, loc.game, loc.edition);
      const bundleDir = path.join(PACKS_DIR, bundle.id);
      await mkdir(bundleDir, { recursive: true });
      const fileName = `${slugify(result.kind === "faction" ? (meta.faction || result.faction || title) : title)}.xlsx`;
      const xlsxBytes = Buffer.from(result.xlsxBase64, "base64");
      await writeFile(path.join(bundleDir, fileName), xlsxBytes);

      const entry = {
        kind: result.kind,
        title,
        faction: result.kind === "faction" ? (meta.faction || result.faction || title) : undefined,
        version: meta.version || new Date().toISOString().slice(0, 10),
        description: meta.description || "",
        file: `${bundle.id}/${fileName}`,
        sizeKB: Math.round(xlsxBytes.length / 1024),
      };
      Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

      const key = componentKey(entry);
      const i = bundle.components.findIndex(c => componentKey(c) === key);
      if (i >= 0) bundle.components[i] = entry; else bundle.components.push(entry);

      await rm(pdfPath);
      if (existsSync(metaPath)) await rm(metaPath);
      console.log(`Converted ${pdfName} → packs/${entry.file} (${bundle.id}, ${entry.kind}${entry.faction ? ", " + entry.faction : ""})`);
      results.converted.push(entry);
    } catch (err) {
      console.warn(`Couldn't convert ${pdfName}: ${err.message || err}`);
      results.skipped.push({ file: pdfName, reason: err.message || String(err) });
    }
  }

  await writeFile(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");
  await browser.close();
  server.close();

  console.log(`\n${results.converted.length} converted, ${results.skipped.length} skipped.`);
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `converted=${results.converted.length}\nskipped=${results.skipped.length}\n`, { flag: "a" });
  }
  // Skips are a warning, not a failure — a bad upload shouldn't fail the whole run for everyone else's PDFs.
}

main().catch(err => { console.error(err); process.exit(1); });
