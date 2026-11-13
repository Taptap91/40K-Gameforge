# Uploading a pack PDF

Drop your PDF into the right folder — that's all a sidecar `.json` used to do, and now the folder does it
for you. A GitHub Actions workflow (`.github/workflows/convert-packs.yml`) picks it up automatically,
converts it to the pack's `.xlsx` format, adds it to `packs/index.json`, and removes the PDF — nobody
downloading the pack in the app ever fetches your original PDF, only the small converted file.

## Where to put it

```
packs/incoming/<Game>/<Edition>/Rules/<file>.pdf       Core Rules, an FAQ/balance dataslate, or a mission
                                                        pack (auto-detected) — anything that isn't a faction
packs/incoming/<Game>/<Edition>/Factions/<file>.pdf    A codex/battletome for one faction
```

For example, a Space Marines codex for 40K 11th Edition goes in
`packs/incoming/Warhammer 40K/11th Edition/Factions/space-marines.pdf`. Everyone uploading to the same
Game + Edition folders ends up contributing to the same "Warhammer 40K - 11th Edition" download in the
app — the app installs every Rules and Factions file in that bundle in one go.

There's no review step: whatever you push here goes live for everyone as soon as it converts, so only
upload PDFs you have the legal right to share. A PDF that isn't nested exactly like this (missing the
Game, Edition, or Rules/Factions folder) is skipped rather than guessed at — check the workflow run's log
if your upload doesn't show up.

## Optional sidecar

You don't need one. If you want to override something the workflow would otherwise detect or default,
add a `.json` file with the same name right beside the PDF — every field is optional:

```json
{
  "title": "Space Marines",
  "faction": "Space Marines",
  "version": "1.0.0",
  "description": "One line shown under the title in the app."
}
```

| field | used for | notes |
|---|---|---|
| `title` | either | defaults to the PDF's own title |
| `faction` | Factions/ only | the app usually detects this from the PDF itself |
| `kind` | Rules/ only | `core` (default) or `updates`, for an FAQ/balance dataslate that isn't the full rulebook. A mission pack is always detected automatically. |
| `version` | either | defaults to today's date — bump this (or just re-upload) so the app shows "Update" to people who already have it |
| `description` | either | one line, shown under the title |
