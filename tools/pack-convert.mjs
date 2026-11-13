#!/usr/bin/env node
/* RulesForge · tools/pack-convert.mjs
 * Converts every PDF under packs/incoming/ (including its Factions/, Rules/ and Mission Packs/
 * subfolders, or any other subfolder — it's scanned recursively, so the subfolders are just for a
 * volunteer's own organization and aren't enforced) into a pack .xlsx and a packs/index.json entry,
 * using the app's own PDF-parsing pipeline (tools/convert.js) run headlessly in Chromium via
 * Playwright — see tools/convert.js's header comment for why a real browser is required.
 *
 * Run locally:   node tools/pack-convert.mjs
 * Run in CI:     .github/workflows/convert-packs.yml calls this on every push that touches packs/incoming/**
 *
 * For each <name>.pdf, looks for a sidecar <name>.json right beside it (same folder) describing the pack:
 *   {
 *     "game": "40K",                 // required — groups packs in the app's Game Packs sheet
 *     "editionTag": "11th Edition",  // required — same
 *     "author": "Jane Volunteer",    // required — shown as "Created by …"
 *     "version": "1.0.0",            // required — lets the app detect updates
 *     "title": "Space Marines",      // optional — defaults to the PDF's own title
 *     "faction": "Space Marines",    // optional — only used for faction packs; defaults to what's detected
 *     "kind": "core",                // optional hint: "core" | "updates" | "faction" | "points" (default "core")
 *     "description": "…"             // optional — shown under the title in the app
 *   }
 * On success the PDF and its sidecar are deleted (the app only ever fetches the small .xlsx that
 * replaces them) and packs/index.json is updated in place. A PDF with no sidecar, or whose sidecar is
 * missing a required field, is skipped with a warning so a bad upload can't silently publish garbage.
 */
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, writeFile, rm, readdir } from "fs/promises";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INCOMING = path.join(ROOT, "packs", "incoming");
const PACKS_DIR = path.join(ROOT, "packs");
const INDEX_PATH = path.join(PACKS_DIR, "index.json");
const REQUIRED_META = ["game", "editionTag", "author", "version"];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json" };

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
}

/** Every *.pdf under `dir`, at any depth, as absolute paths — so Factions/, Rules/, Mission Packs/
 * (or any other subfolder a volunteer makes) are all picked up the same way. */
async function findPdfs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await findPdfs(full));
    else if (/\.pdf$/i.test(entry.name)) out.push(full);
  }
  return out;
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
    const pdfName = path.relative(INCOMING, pdfPath);   // e.g. "Factions/space-marines.pdf", for logging
    const metaPath = pdfPath.replace(/\.pdf$/i, ".json");
    if (!existsSync(metaPath)) {
      console.warn(`Skipping ${pdfName}: no sidecar ${path.basename(metaPath)} describing it (game/editionTag/author/version), right beside it.`);
      results.skipped.push({ file: pdfName, reason: "missing sidecar .json" });
      continue;
    }
    let meta;
    try { meta = JSON.parse(await readFile(metaPath, "utf8")); }
    catch (err) { console.warn(`Skipping ${pdfName}: sidecar .json is invalid: ${err.message}`); results.skipped.push({ file: pdfName, reason: "invalid sidecar json" }); continue; }
    const missing = REQUIRED_META.filter(k => !meta[k]);
    if (missing.length) {
      console.warn(`Skipping ${pdfName}: sidecar is missing ${missing.join(", ")}.`);
      results.skipped.push({ file: pdfName, reason: `sidecar missing ${missing.join(", ")}` });
      continue;
    }

    try {
      const bytes = await readFile(pdfPath);
      const base64 = bytes.toString("base64");
      const opts = { kind: meta.kind || "core", faction: meta.faction || "" };
      const result = await page.evaluate(([b64, name, o]) => window.__convertPdf(b64, name, o), [base64, path.basename(pdfPath), opts]);

      const title = meta.title || result.title;
      const id = slugify(meta.id || title);
      const fileName = `${id}.xlsx`;
      const xlsxBytes = Buffer.from(result.xlsxBase64, "base64");
      await writeFile(path.join(PACKS_DIR, fileName), xlsxBytes);

      const entry = {
        id,
        title,
        faction: result.kind === "faction" ? (meta.faction || result.faction || title) : undefined,
        kind: result.kind,
        game: meta.game,
        editionTag: meta.editionTag,
        version: meta.version,
        author: meta.author,
        description: meta.description || "",
        file: fileName,
        sizeKB: Math.round(xlsxBytes.length / 1024),
      };
      Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

      const i = index.packs.findIndex(p => p.id === id);
      if (i >= 0) index.packs[i] = entry; else index.packs.push(entry);

      await rm(pdfPath);
      await rm(metaPath);
      console.log(`Converted ${pdfName} → packs/${fileName} (${entry.kind}${entry.faction ? ", " + entry.faction : ""})`);
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
