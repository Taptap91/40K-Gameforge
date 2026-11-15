# Adding another game (templates)

RulesForge's Game Packs are not tied to Warhammer. Any game (D&D, Halo Flashpoint, Age of Sigmar, Kill Team…) is
a Game Pack made of these parts, each a plain `.xlsx` you fill in:

| You want to add… | Template | Drop it in `packs/incoming/<Game>/<Edition>/…` | Where it shows in the Game Pack |
|---|---|---|---|
| The rulebook, or an FAQ/errata | `rules-template.xlsx` | `Rules/` | **Core Rules** (updates sit beneath it) |
| Reference entries: monsters, spells, units, items, cards, classes | `collection-template.xlsx` | `Collections/` | A column named by the file's **Section** (Bestiary, Spellbook, Reference…) |
| Modes, scenarios, event rules | `rules-template.xlsx` with Kind set to *Event Companion* | `Companions/` | **Event Companions** |
| An army/faction with datasheets | a faction workbook exported from the app | `Factions/` | **Factions** |
| A mission deck | a mission-pack workbook exported from the app | `Rules/` | **Mission Packs** |

The `<Game>` and `<Edition>` folder names make the Game Pack ("Dungeons & Dragons - 5th Edition"). Everyone adding
files to the same two folders contributes to the same pack. Pushing a file there is enough: a workflow checks it,
adds it to `packs/index.json` and removes the original. A file that isn't in one of the formats above is skipped
with a message in the workflow log.

## How a Collection reads in the app

* **Category** groups the entries in the left-hand list (Creatures, Spells, Items…), each group folds open and closed.
* **Name** is the entry's heading and what search finds first.
* **Tags** is one short line under the heading (`Large, Giant`).
* **Stats** is one `Name: value` per line, shown in bold (`Hit points: 84`).
* **Text** is the entry's rules text. `**bold**` and bullet lines (starting `-` or `•`) work.
* Search covers every word of every entry.

Keep names short, one idea per entry, and use the same Category spelling throughout so entries group together.
