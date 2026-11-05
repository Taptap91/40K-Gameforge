# RulesForge faction kit

This folder ships with the app. It sets every faction's button image and colours, so they are the same for every user,
whether or not they upload a faction pack.

## Images

Put one image per faction in this folder, named exactly as in the table below. Only the ending changes with the format:
`dark-angels.png`, `dark-angels.svg`, `dark-angels.webp` and `dark-angels.jpg` all work.

- **Any size and format.** PNG, SVG, WebP, JPG, GIF and AVIF all work. The app trims empty, see-through edges and scales
  the image to fit:
  - **Banner:** as tall as the banner allows, 5px from the top and 5px above the coloured bottom line (101px tall on
    desktop, 82px on phones). The width follows the image's shape, up to 30px more than the height (131px / 112px);
    a wider image is scaled down to fit that width. Every symbol is centred in the same spot, whatever its shape.
  - **Button:** inside 30 × 28.
- **Best results:** a roughly square image with a see-through background (PNG, SVG or WebP), at least 256 pixels tall.
  JPG has no see-through background, so its background colour shows as a box.
- **Black symbols:** a symbol drawn only in black or dark grey (a plain black SVG, say) is shown in near-white
  automatically, so it doesn't vanish on the app's dark background. Coloured images are left as they are.
- **Keep files small** (under about 300 KB each) so the app loads quickly.
- **Use artwork you own or have the rights to.**
- **No image for a faction?** The app falls back to the icon in that faction's PDF, if the user uploads one.

## Colours

`factions.json` holds each faction's two colours: the main colour first, then the trim. Change a hex code there to change
that faction's banner, button, keyword tags, checkboxes and selected-weapon borders for everyone.
If the main colour is very dark (like black), the app uses the trim colour for keyword tags, checkboxes and selected
borders so they stay visible. A new faction can be added the same way. Add a line with its name, colours and image name.

| Faction | Image name | Main | Trim |
|---|---|---|---|
| Adepta Sororitas | `adepta-sororitas.png` | `#b3262d` | `#e6e1d3` |
| Adeptus Custodes | `adeptus-custodes.png` | `#d4a72c` | `#8e1f2a` |
| Adeptus Mechanicus | `adeptus-mechanicus.png` | `#b0302a` | `#b9bcc0` |
| Astra Militarum | `astra-militarum.png` | `#6b7a3a` | `#b58a4c` |
| Black Templars | `black-templars.png` | `#1b1b1e` | `#e9e6df` |
| Blood Angels | `blood-angels.png` | `#b3121b` | `#d4a72c` |
| Dark Angels | `dark-angels.png` | `#1f6b3a` | `#f6f4f1` |
| Deathwatch | `deathwatch.png` | `#9aa3ad` | `#2e2e33` |
| Grey Knights | `grey-knights.png` | `#a9b4bf` | `#3b6fb6` |
| Imperial Agents | `imperial-agents.png` | `#8a8f96` | `#b3262d` |
| Imperial Knights | `imperial-knights.png` | `#2f5fa8` | `#d4a72c` |
| Space Marines | `space-marines.png` | `#2f5fb8` | `#d4a72c` |
| Space Wolves | `space-wolves.png` | `#7f9bb3` | `#d4a72c` |
| Chaos Daemons | `chaos-daemons.png` | `#a3202a` | `#7a3fb0` |
| Chaos Knights | `chaos-knights.png` | `#7a1f1f` | `#9aa0a6` |
| Chaos Space Marines | `chaos-space-marines.png` | `#1b1b1e` | `#c9a227` |
| Death Guard | `death-guard.png` | `#9aa83f` | `#b08d57` |
| Emperor's Children | `emperors-children.png` | `#c0399a` | `#d9b84a` |
| Thousand Sons | `thousand-sons.png` | `#2f6fc0` | `#d4a72c` |
| World Eaters | `world-eaters.png` | `#c0201f` | `#b08d57` |
| Aeldari | `aeldari.png` | `#1f8a78` | `#d9b84a` |
| Drukhari | `drukhari.png` | `#6b3a8c` | `#2fa88a` |
| Genestealer Cults | `genestealer-cults.png` | `#6a4a9c` | `#c9a227` |
| Leagues of Votann | `leagues-of-votann.png` | `#c9732f` | `#6b7d8c` |
| Necrons | `necrons.png` | `#36c45a` | `#9aa0a6` |
| Orks | `orks.png` | `#4f9a2f` | `#d9b84a` |
| T'au Empire | `tau-empire.png` | `#d99a4e` | `#3f7fbf` |
| Tyranids | `tyranids.png` | `#7d3fb0` | `#d8cfb4` |
