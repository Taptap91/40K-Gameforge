# RulesForge Layout Studio

Change how RulesForge looks and is laid out, visually, for **desktop, tablet and phone**, with no code.

**Start it:** you need Python 3 (nothing else to install) and your RulesForge folder (the one with `index.html`).
Double-click `Start Layout Studio.bat` (Windows), or run `python3 layout_studio.py` (Mac/Linux). If it isn't inside
your RulesForge folder, pass the folder: `python3 layout_studio.py "C:\path\to\RulesForge"`.

The real app runs inside the editor. The first time, download your Game Packs inside it as you normally would.

1. Pick **Desktop / Tablet / Phone** at the top. The app is shown at that width, and the app's own responsive rules apply.
2. **Use the app** lets you click around normally to reach the screen you want. Then press **Edit**.
3. Click anything. The side panel shows what you picked (dashed blue while hovering, orange once picked) and lets you
   change its text colour, size, weight, font, background, rounding, padding, margin, width, opacity, and, for blocks
   that hold other blocks, direction, wrapping, spacing and number of columns. **Hide it** removes it from that screen size.
4. **Text:** change the wording of a heading, button or menu name. It changes everywhere that same text appears there.
5. **Move:** use ◀ Earlier / Later ▶, or drag the selected block onto another in the app. This works for blocks inside a
   row, column or grid (card lists, button rows). Blocks in an ordinary stack can't be reordered here.
6. **Apply changes to:** *this screen size only* (default) or *every screen size*. Use "all like this" to change every
   card/button of the same kind at once, or "only this one".
7. **Undo** (or Ctrl+Z) steps back; **All my changes** lists every change with a ✕ to remove it; **Reset everything**
   goes back to the original look.
8. **Save** writes `custom/custom.json` in your RulesForge folder (the previous version is kept as `custom.json.bak`).
   Upload that file to GitHub, or use **Publish to GitHub** (repository, branch and a fine-grained token with
   *Contents: Read and write*; it only sends that one file). The app reads the file each time it loads.

Limits: it changes look, layout order and wording, not features or how screens behave. Changes are tied to what the app
draws today: if a future update renames an element or reorders a list, an old change may stop applying or land on
a different block, so check **All my changes** after big app updates. Reordering is saved per position in the list,
so it won't follow items that are added later. Text that the app builds from your data (army names, unit names)
isn't something to rename here.
