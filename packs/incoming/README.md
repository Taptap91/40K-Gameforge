# Uploading a pack PDF

Drop your PDF into whichever subfolder fits — `Factions/`, `Rules/`, or `Mission Packs/` — add a sidecar
`.json` file with the same name right beside it, and push to the `game-packs` branch. The subfolders are
just for keeping things organized; the conversion workflow scans all of them (and any others you add) the
same way, so nothing breaks if a PDF ends up in the "wrong" one.
A GitHub Actions workflow (`.github/workflows/convert-packs.yml`) picks it up automatically, converts it
to the pack's `.xlsx` format, adds it to `packs/index.json`, and removes the PDF and sidecar — nobody
downloading the pack in the app ever fetches your original PDF, only the small converted file.

There's no review step: whatever you push here goes live for everyone as soon as it converts, so only
upload PDFs you have the legal right to share, and double check the sidecar before you push.

## Example

For `space-marines.pdf`, add `space-marines.json` next to it:

```json
{
  "game": "40K",
  "editionTag": "11th Edition",
  "author": "Your name",
  "version": "1.0.0",
  "kind": "faction",
  "faction": "Space Marines",
  "description": "One line shown under the title in the app."
}
```

| field | required | notes |
|---|---|---|
| `game` | yes | groups packs in the app ("40K", "AoS", "Star Wars"…) |
| `editionTag` | yes | shown next to the group ("11th Edition", "10th Edition"…) |
| `author` | yes | shown as "Created by …" |
| `version` | yes | bump this on a re-upload so the app shows "Update" to people who already have it |
| `kind` | no | hint for what the PDF is: `faction` (a codex/battletome), `core` (a core rulebook), or `updates` (an FAQ/errata/balance dataslate). Defaults to `core`. A faction PDF — or a mission pack — is detected automatically either way, and `kind` is ignored for a mission pack. |
| `faction` | no | only used for a faction pack; the app usually detects this from the PDF itself |
| `title` | no | defaults to the PDF's own title |
| `description` | no | one line, shown under the title |

A mission pack (a Chapter Approved–style mission deck) works the same way — just drop the PDF and its
sidecar in here like anything else. Everything, mission packs included, works the same way a human doing
Add PDF → ⋮ → Download Excel in the app would produce.

If your PDF doesn't have a sidecar `.json`, or the sidecar is missing a required field, the workflow
skips it (and leaves a note in the run's log) rather than publishing something broken.
