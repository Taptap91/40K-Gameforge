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
3. **Remove headers and footers** (optional): enter how much of the top and bottom of every page to clear, as a
   percentage, or press *Find them automatically* to detect lines repeated on most pages (website address, date,
   page numbers). The text in those bands is deleted from the saved PDF, not merely covered. Set it before saving.
4. **Save to Game Pack folder** writes `packs/incoming/<Game>/<Edition>/<Type>/<Title>.pdf` plus a
   `<Title>.json` beside it (title, faction, version, note). Commit and push it; the pack converter reads the
   JSON, so the app shows exactly the title you typed. **Download PDF** just gives you the merged file.

**Upload to GitHub** (optional): open that section, tick the box, and enter the repository and branch (the
workflow reads `game-packs`) plus a fine-grained token limited to that repository with *Contents: Read and write*.
Saving then also uploads the `.json` and the PDF straight to `packs/incoming/…`, replacing an older file of the same
name, and the pack converter runs from there. Tick *Remember* to keep the token in `~/.rulesforge-pdfstudio.json`
on this computer only. Without it, the token is used once and not stored.

**Choosing the folder:** press *Load folders from GitHub*. The Destination list then shows only the Game /
Edition folders that already exist under `packs/incoming`, so a file can't land somewhere that isn't a Game Pack.
Choose **＋ New Game Pack…** to start one: type its Game and Edition names and the folders are created by the
first upload (Git keeps no empty folders, so there is nothing to make beforehand).

**Using it on its own:** this folder works without the rest of the repository. Outside the repository it saves
local copies to `RulesForge-PDFs` in your home folder, and GitHub upload works the same.

Set `RF_OUT` to save somewhere other than the repo's `packs/incoming`.
Web capture prints the page as text-based PDF without browser headers or footers, which the app reads well.
Pages that need a login or that load content as you scroll may capture only what's visible at load.


## Merge, then download or upload
Press **1 · Merge the PDFs** (a progress bar shows the pages being merged). When it finishes, **Download PDF** and **Upload / save** unlock. If you change the files, ranges, header/footer sizes or title afterwards, merge again. **Find them automatically** also shows a progress bar while it reads the pages.
