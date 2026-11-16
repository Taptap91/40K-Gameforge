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


## Starting and stopping
Double-click the Start file: no black window stays open, your browser opens the tool, and when you close the browser tab the program stops itself within a few seconds. Nothing else to close. (On Windows it also installs the one PDF library it needs the first time, if missing.)

## Capturing web pages with their checkboxes
Paste an address and press **Open page**. The page loads in a hidden browser and every checkbox and show/hide section found on it is listed. Tick or untick the checkboxes individually. Each item has a **Go to** button that scrolls the page viewer to its first instance. The **Show All / Hide All** switch opens or closes every show/hide section (Show All is the default when a page opens), and you can still click any show/hide button on the page itself. then **Save this page as a PDF**. What you chose is exactly what gets printed. Pages that need a sign-in are not supported.

## The new layout (v7)
Controls are on the left quarter; the right three quarters is a PDF viewer.
1. **Add** a PDF, or paste a web address and press **Open**. The page's checkboxes and sections are listed on the left; the viewer shows a live preview you can scroll, and it refreshes after each change. **Save this page as a PDF** keeps exactly what you see.
2. Click any file in the list to view it. Header/footer sizes belong to the selected file: press **Find them automatically** and the viewer shows it with those bands removed. **Use for all files** copies the sizes to every file.
3. Repeat for the next address or PDF. When done, **Merge**, check the merged PDF in the viewer, then **Download** or **Upload to GitHub**.

## Clicking the page itself (v8)
After **Open**, the right side shows the live page as a picture you can click (it loads the part you are looking at first, then the rest): press any show/hide button or checkbox right on it and the picture updates. Scroll it normally. The **PDF preview** tab shows what will be saved. Links are blocked so a stray click can't leave the page. The list on the left still works too.

## Updating while the other tool is open
PDF Studio and App Builder use separate addresses, so you can keep both open. Starting a newer version of one asks the older copy of *that same tool* to quit and takes its place, without touching the other tool. Starting the same version twice just reopens it. (Copies older than v9 can't be asked to quit, so the first time you may see a different address; close their tab and wait a few seconds, or end `python.exe`/`pythonw.exe` in Task Manager.)
