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
**Style anything that exists or that you add** (open the section you need in the side panel):
* **Text style:** colour, size, weight, font, italic, align, line height, letter spacing, capitals, underline, text shadow.
* **Fill and border:** solid colour, linear or radial **gradient**, or a **picture** (paste an address or upload); border
  width, style and colour; **rounding for each corner**.
* **Effects:** drop **shadow** (x, y, blur, spread, colour, strength, inside), **blur**, frosted **glass blur**, opacity, blend mode.
* **Size and space:** width, height, min/max, **margin and padding on each side**, Left/Centre/Right, overflow.
* **Position and layer:** normal, offset, **free** (absolute) or stuck on screen; offsets; layer order (bring forward /
  send back); **move, rotate and scale** without disturbing the layout.
* **Free move:** tick it, then in Edit drag an item anywhere (it **snaps to edges and centres** of its box and its
  neighbours, with pink guides) and drag the handles to **resize**.
* **Arrange the contents** of a block: direction, wrap, spread, line-up, columns, gap.
* **Hover, Pressed and Focused looks:** switch the Normal / Hover / Pressed / Focused tabs and style how it reacts.

**Animation:** pick an effect (fade, slide, zoom, pop, flip, shake, or looping pulse, float, spin, glow, blink), its length,
delay, feel (smooth, bounce…) and repeats, and press ▶ Preview. **Smooth changes** make hover and pressed looks glide.
Under **Whole app**, *Screen change* animates every move between screens. Animations switch off for visitors whose
device asks for reduced motion.

**Reusable styles:** *Save selected element's look as a style*, apply it to other things, and **Edit** it once to update
everything using it (like Figma styles). **Whole app** lists the app's colours, radius and fonts: change one and the
whole app changes (like Figma variables).

**Add things and pages:** select a block, choose where, then add a Heading, Text, Button, Image, Rectangle, Circle, Line,
Divider, Space, **Row** or **Column** (to lay several items out). *＋ New page* adds a screen with its own menu button.
**Buttons:** any button, yours or the app's, can open an app screen, one of your pages, a web address, scroll to the top
or do nothing (this one button only). Also: remove or hide anything, rename text, reorder by dragging or ◀ ▶,
**Undo** (Ctrl+Z), **All my changes** (✕ to remove any), **Reset everything**.

## Test on any screen size and organise layers
* **Device bar** above the preview: Desktop / Tablet / Phone, a list of common devices (iPhone, iPad, Galaxy, Pixel,
  laptops, 1080p/1440p), exact width and height, rotate, a **width slider** to watch the layout respond at every size,
  and zoom. Edits go to the size range the width falls in (shown beside the bar).
* **Layers tab:** every element on the current screen as a tree. Click or Shift-click to select; ● hides; 🔓 locks
  (locked layers can't be picked or moved on the canvas); double-click to rename; **Group selected** to style, hide or lock
  several together; **drag a layer** onto another to reorder it on the canvas (top edge before, bottom edge after,
  middle inside a box you added).

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
