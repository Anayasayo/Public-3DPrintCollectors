# 3DPrintCollectors

A local Magic: The Gathering collection tracker and Commander deck builder. Runs entirely on this PC — the
server binds to `127.0.0.1` only, and everything lives in one SQLite file.

**Get it here:** [download the ZIP](https://github.com/Anayasayo/Public-3DPrintCollectors/archive/refs/heads/main.zip), or open the [GitHub page](https://github.com/Anayasayo/Public-3DPrintCollectors) and click the green **Code** button, then **Download ZIP**. Step-by-step setup is in [INSTALL.md](INSTALL.md).

## Start it

**New computer? See [INSTALL.md](INSTALL.md)** for step-by-step setup on Mac and Windows, where your data
lives, and how to move it between computers.

- **Windows:** double-click **`Start 3DPrintCollectors.vbs`** (or the desktop shortcut).
- **Mac:** run **`Install on Mac.command`** once; it creates **3DPrintCollectors.app** in Applications.

The browser opens <http://127.0.0.1:5178>. Closing the last app tab stops the server about 30 seconds later.

From a terminal:

```
cd 3DPrintCollectors   # the folder you unzipped
npm start        # build the web app + run the server
npm run serve    # run the server using the existing build
npm test         # server test suite
npm run dev      # live-reload dev mode (web on :5179, API on :5178)
```

## One-time setup: pricing key

Prices come from **JustTCG**, which resells TCGplayer pricing per condition (TCGplayer stopped issuing its
own API keys years ago).

1. Make a free account at <https://justtcg.com> and copy the API key.
2. Paste it into **Settings → API key** (or into `JUSTTCG_API_KEY=` in `.env`) and restart.

Free plan: 100 requests/day, 10/minute, 20 cards per request — about 2,000 card prices a day, refreshed
stalest-first. Raise the caps in Settings if you upgrade the plan.

Without a key the app still works: it falls back to the TCGplayer *market* price that ships with the Scryfall
card catalog (one price per finish, not per condition). Those prices are labelled "fallback" everywhere.

## How pricing works

| Source | When it is used | Badge |
| --- | --- | --- |
| **TCGplayer last 5 sales** | When you click "Last 5 sales" on a card. Averages the 5 most recent sold listings per condition. Used for 7 days, then it falls back. | gold dot |
| **JustTCG** (TCGplayer, per condition) | Automatic background refresh for every card you own, want, or have in a deck. | green dot |
| **TCGplayer market (Scryfall)** | Only when the two above have nothing for that printing/condition. | grey dot |

Only **NM**, **LP** and **MP** are tracked, per the TCGplayer grades. HP/Damaged cards found in imports are
flagged so you can downgrade them to MP, skip them, or send them to Miscellaneous.

The "Last 5 sales" feed is TCGplayer's own undocumented endpoint (the one their product pages use). It is
never called automatically — only when you click the button on a card.

## What it does

- **Collection** — every card tracked by exact printing: set, collector number, finish (normal / foil /
  etched) and treatment (borderless, showcase, extended art, full art, retro frame, surge foil, serialized…).
  Binders, tags, notes, purchase price, bulk edits, filters and a running total.
- **Commander decks** — build or import a deck, and the validator checks the real rules: exactly 100 cards
  including the commander, commander eligibility (legendary creature / Vehicle / Spacecraft with P/T, or
  "can be your commander"), partner pairings, singleton with all its exceptions (basics, "any number of",
  Seven Dwarves, Nazgûl), colour identity, the current banned list, and Game Changers against your target
  bracket. Add, remove, change and swap buttons; mana curve, type and pip breakdowns; owned-vs-missing costs.
- **Quick import to collection** — one button files a whole deck into the collection in a `Deck: <name>`
  binder, and it starts counting toward your total.
- **Change tracking** — after a deck is in the collection, every edit is logged. "Sync changes" applies them:
  additions join the collection, removals go to **Miscellaneous**, and a condition change just re-grades the
  copy you already own.
- **Miscellaneous** — cards pulled out of decks wait here without counting toward your total until you file
  them into a binder or remove them.
- **Import / export** — Excel (.xlsx/.xls), CSV and plain text, both collections and decklists. Column
  layouts from ManaBox, Moxfield, Archidekt, Deckbox, Dragon Shield, Delver Lens and the TCGplayer app are
  detected automatically, with a mapping editor and a row-by-row preview before anything is saved. Exports
  carry Scryfall IDs so a re-import restores the identical printings.
- **Dashboard** — total value, value-over-time chart, biggest gainers/losers, most valuable cards, per-binder
  and per-condition totals, wishlist price alerts.
- **Sets** — completion per set with the missing list and what it would cost.

## Layout

```
server/            Express + SQLite API (TypeScript)
  src/scryfall/    catalog download (Scryfall bulk data, refreshed weekly)
  src/pricing/     JustTCG client, refresh queue, last-5-sales, valuation
  src/decks/       Commander validator + deck/collection sync
  src/import/      txt / csv / xlsx parsers, matching, commit
  src/export/      xlsx + csv + decklist writers
  test/            vitest suites
web/               React + Vite UI
mac/launch.sh      macOS launcher (run by the .app that "Install on Mac.command" creates)
data/              collection.db, plus automatic backups/ (kept: 20 newest)
.env               your JustTCG key (git-ignored)
```

## Data safety

A backup is taken on every start and kept in `data/backups/` (20 newest); Settings has "Back up now" and
one-click restore. Backups hold only your own data — collection, decks, Misc, wishlist, prices and settings
— so each one is a couple of hundred KB; the 90 MB card catalog is left out because it re-downloads from
Scryfall. Restoring replaces your data and leaves the catalog alone.

To move everything to another computer, use **Settings → Download backup file** there and **Restore from a
file…** on the new one (details in [INSTALL.md](INSTALL.md#move-your-data-to-another-computer)).
