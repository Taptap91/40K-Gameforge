# battle/

Everything for the Battle screen (the in-game assistant).

- `maps/` — recommended terrain layouts from the Warhammer Event Companion, cropped to the battlefield.
  - `layouts.json` lists every map: its file, its Deployment card, and each Force Disposition pairing that uses it
    (`you` vs `opponent`, layout letter A/B/C, and both Primary Missions). A pairing works in either order.
  - Map files are named `<deployment>-<n>.webp` (e.g. `tipping-point-1.webp`).

Note: the maps are Games Workshop artwork, included for testing. A release build should read each player's own
copy of the Event Companion instead of shipping these files.
