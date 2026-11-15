# RulesForge PDF Studio

Merge several PDFs (a codex split across files, for instance), capture web pages as PDFs, and name the result
so it lands in the right Game Pack with the right title.

**Start it:** install Python 3 and run `pip install pypdf` once, then double-click `Start PDF Studio.bat`
(Windows) or run `python3 pdf_studio.py` (Mac/Linux). Your browser opens to a page served from your own
computer only; nothing is uploaded anywhere.

1. **Pieces**: drop PDFs in, or paste a web address and press Capture (uses Chrome or Edge on your computer).
   Reorder with ↑ ↓. Type a page range like `1-5, 8, 12-` to keep only some pages of a piece.
2. **Name it**: Game, Edition, Type (Rules, Factions, Companions, Collections) and Title. A Factions file also
   takes the faction name; a Rules file can be marked as an update/FAQ.
3. **Save to Game Pack folder** writes `packs/incoming/<Game>/<Edition>/<Type>/<Title>.pdf` plus a
   `<Title>.json` beside it (title, faction, version, note). Commit and push it; the pack converter reads the
   JSON, so the app shows exactly the title you typed. **Download PDF** just gives you the merged file.

Set `RF_OUT` to save somewhere other than the repo's `packs/incoming`.
Web capture prints the page as text-based PDF without browser headers or footers, which the app reads well.
Pages that need a login or that load content as you scroll may capture only what's visible at load.
