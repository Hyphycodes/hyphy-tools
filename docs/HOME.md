# The home above the tools

Hyphy Tools opens on a personal home, not a warehouse. Three **modes** are lenses over the same
catalog, **situations** surface a few human moments with the tools they take, and **My Tools**
fills itself from what someone pins and opens. The full catalog is always one tap away at
`/tools/all`. Nothing here needs an account.

## Modes

| Mode     | For                                     | Air                                            |
| -------- | --------------------------------------- | ---------------------------------------------- |
| Everyday | Life, friends and quick fixes           | Warm cream daylight, soft color, rounder cards |
| Create   | Photos, files and things you make       | Deep ink-violet, paint-bright light, posters   |
| Work     | Business, money and getting things done | Graphite, mint, hairlines, tighter corners     |
| All      | Show me everything                      | Hyphy at night: the classic marketplace        |

- Modes are **never permissions**: every tool is still in search and on All tools.
- A tool joins modes through `modes` in its registry entry (`src/lib/catalog/tools.ts`): a rank
  (1–6 are the mode's starter set) and its line in that mode (QR Studio is "Wi-Fi, sharing,
  events" in Everyday and "Menus, reviews, marketing" in Work). `tier` (`experience`, `tool`,
  `quick`) says how much room a tool deserves; quick tools will live in a compact drawer.
- Mode definitions, situations and the "+" groups are data in `src/lib/catalog/modes.ts`.
  `validateCatalog()` checks them (every step opens a real, open tool; ranks don't tie).
- The atmosphere is `src/app/(public)/home.css`: each mode re-lights the product's tokens, like
  a tool's world does, so components need no per-mode code. Flags on `<html>` (never `:has()`):
  `data-home` (this page is the home) and `data-lens` (the mode).
- The switch sits at the top of the home (Everyday · Create · Work · All). Tool pages don't
  change with the mode; the mode is how the home is arranged, not how a tool behaves.

## The first visit

"What are you here for?" — Everyday, Create, Work, or Show me everything. One tap, saved in the
browser; the classic marketplace is right below it for anyone who'd rather just look.

## The home in a mode

1. The mode's hero: greeting, headline, search that leans toward the mode's tools.
2. **Your tools** (or **Start with these** for someone new): pinned tools in the order pinned,
   then regulars (opened on 3+ different days), then tools tried lately, each in the order it
   first arrived — so nothing jumps around. Cards show "Yesterday", "Sunday" for what was opened
   lately. Starters fill the shelf until it's the person's own.
3. **Pick up where you left off**: work a tool is really holding, read from that tool's own
   storage with its own schema (`src/lib/home/active.ts`, loaded after first paint). Plan
   ("5 of 8 are in"), Where? (votes or the winner), Split, Bring, Mileage (a live drive, or the
   month's miles), Receipts (the month's total, added this week), Subscriptions, Secret Santa,
   Christmas List. Tools that keep nothing never appear here.
4. **What's going on?** Situations for the mode (seasonal ones only in season, and first then).
5. The mode's shelf, in the mode's card shape, without repeating what's on Your tools.
6. **Browse all tools**: every category, one tap into `/tools/all?c=…`.

"All" keeps the classic marketplace, with Your tools and open work on top once there are any.

## Keeping it personal without an account

`src/lib/home/prefs.ts` is the whole model (pure, tested in `tests/lib-home.spec.ts`), kept in
`localStorage` under `hyphy.home.v1`:

- `lens` and when it was chosen; `pins` (`{ on, t }`, a tombstone when taken off); `uses` per
  tool (`first`, `last`, distinct `days`). No clicks, durations or pages; "Forget recent" clears
  `uses`.
- Every field is last-writer-wins by its own timestamp and `mergeHome()` joins two copies, so
  syncing with an account later is a merge, not a migration.
- `components/home/use-home.ts` is the store (`useSyncExternalStore`, other tabs included).
- The server sends the first-visit home; `HOME_BOOT` (`src/lib/home/boot.ts`, inlined in the
  layout) marks the mode before first paint so its colors are there at once, and hides the
  first-visit version for returning people until their own renders (with a failsafe).

"Keep handy" is a quiet button on every tool page and a corner button on cards that appears on
hover (always shown on All tools, where phones pin).

## Search by intent

`searchTools()` recognizes whole-query intents (`INTENTS` in `src/lib/catalog/search.ts`):
"dinner" → Split, Where?, When?, Plan; "instagram" → Social Crop, Resize, Palette; "receipt" →
Receipts, Split; "work mileage" → Mileage; "merge" → PDF; "make smaller" → Resize. Deterministic,
no AI. The current mode breaks near-ties toward its own tools and never hides anything.

## The "+" and the phone dock

"Start something" (`components/home/quick.tsx`): scan, upload, make, plan, track, in the order the
mode reaches for them; each opens a tool. On phones the home and All tools get a three-part dock:
Home, "+", All tools. Search stays in the header; tool pages keep the bottom for their own action.

## Handoffs

Outcome-aware next steps, only where the relationship is real (`components/tools/next-step.tsx`):

- Resize (one photo, done) → "Make social sizes" / "Pull its colors": the photo is **carried** to
  Social Crop or Palette (`src/lib/share/carry.ts`: in memory, this tab, taken once), no second
  upload.
- Mileage trip saved → "Add a receipt". Receipts filed as fuel or travel → "Log the drive".
- Secret Santa names drawn → "Make a Christmas List".
- Where? → a Plan, and Plan → When?, Where?, Bring, Split already hand off (docs/TOOLS.md).

The carry module is the seam for a shared asset tray later (one photo → Resize → Social Crop →
Palette).
