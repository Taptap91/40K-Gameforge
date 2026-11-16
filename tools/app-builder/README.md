# RulesForge App Builder

Visually change RulesForge, and add to it, for **desktop, tablet and phone**, with no code. (PDF Studio, in
`tools/pdf-studio`, is a separate tool for preparing PDFs; this one is for the app's own design and content.)

**Start it:** you need Python 3 (nothing else to install) and your RulesForge folder (the one with `index.html`).
Double-click `Start App Builder.bat` (Windows), or run `python3 app_builder.py` (Mac/Linux). If it isn't inside your
RulesForge folder, pass the folder: `python3 app_builder.py "C:\path\to\RulesForge"`. The real app runs inside the
editor; the first time, download your Game Packs in it as you normally would.

## Using it
* Pick **Desktop / Tablet / Phone**. The app is shown at that width and its own responsive rules apply.
* **Use the app** lets you click around (buttons do what they're set to do, so you can test) to reach a screen.
  **Edit** lets you click anything to change it. Dashed blue = hovering, orange = picked.
* **Apply changes to** *this screen size only* (default) or *every screen size*. For things that repeat (cards,
  menu buttons), **All like this** changes the whole kind; **Only this one** changes just that item.

## What you can do
* **Restyle anything that exists:** text colour, size, weight, font, background, rounding, width/height, opacity;
  **space outside (margin) and space inside (padding) on each side**, and Left / Centre / Right positioning;
  for blocks that hold other blocks, direction, wrapping, spread, number of columns and gaps.
* **Remove or hide** anything on a screen size. **Rename** headings, buttons and menu names.
* **Rearrange:** drag a block onto another, or ◀ Earlier / Later ▶, for blocks in a row, column or grid.
* **Add things:** select a block, choose where (inside it, before it, after it), then add a **Heading, Text, Button,
  Image, Divider, Space, Row** (items side by side) or **Column** (items stacked). Put several things in a Row or
  Column box to lay them out. Pictures are uploaded into `custom/assets/`.
* **Add pages:** *＋ New page* adds a screen with its own menu button (choose an icon, or leave it out of the menu).
  Open it, select its area, and add things to it.
* **Choose where buttons go:** under *When it's pressed*, any button, yours or the app's, can open one of the app's
  screens, one of your pages, a web address, scroll to the top, or do nothing. This applies to that one button.
* **Undo** (Ctrl+Z), **All my changes** (with ✕ to remove any one), **Reset everything**.

## Saving and publishing
**Save** writes `custom/custom.json` (and any pictures in `custom/assets/`) in your RulesForge folder; the previous
version is kept as `custom.json.bak`. Upload those to GitHub, or use **Publish to GitHub** (repository, branch,
and a fine-grained token with *Contents: Read and write*). The app reads the file each time it loads, so it's
live once the app's files are published. Without the file, or with it empty, the app is exactly as shipped.

## Limits
* It changes design, layout, wording, pages and where buttons lead. It can't create new features or change how the
  Battle Tracker or the list builder work, and it can't make a button run a calculation.
* Changes are tied to what the app draws today. After an app update, check **All my changes**: an item may have
  moved or been renamed. Reordering is saved by position, so it won't follow items added later.
* Adding many pages makes the phone's bottom bar crowded; keep extra pages out of the menu and link to them from a
  button instead.
* Text built from your data (army and unit names) isn't something to rename here.
