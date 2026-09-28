# The public Tools world

Hyphy Tools has two sides:

- **The public Tools world** (`/tools`, `/tools/{tool}`, `/p`) — a dark marketplace anyone can
  browse, search and use. No account, no sign-in, nothing uploaded for tools that run on the
  device. This is what `/` opens.
- **Hyphy Spaces** (`/spaces` → `/{space}/…`) — the signed-in product (Demo Mode today): Spaces,
  roles, receipts, mileage, projects. It is not linked from the public world until accounts open.

Everything below is about the public side.

## Routes

| Path                            | What                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| `/`                             | Redirects to `/tools`                                                   |
| `/tools`                        | The home: modes, your tools, open work, situations (docs/HOME.md)       |
| `/tools/all`                    | Every tool, filtered by what it helps with (`?c=money`)                 |
| `/tools/{slug}`                 | One tool, in its own world: a slim line, the tool, an info drawer, next |
| `/tools/{slug}/opengraph-image` | The share card for that tool                                            |
| `/p#…`                          | A published Signal Page (the page rides inside the link)                |
| `/spaces`                       | Opens Hyphy Spaces (your last Space)                                    |

All of it sits under the `/platform` base path (hyphy-studio.com/platform is a rewrite to this
deployment). Pages are static: the registry is read at build time.

## The registry — one entry per tool

`src/lib/catalog/` is the single source of truth:

| File          | What                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------- |
| `ids.ts`      | The closed lists: tool ids, category ids, family ids (no dependencies)                      |
| `schema.ts`   | Zod schemas; the `Tool`, `Family`, `Category` types are derived from them                   |
| `tools.ts`    | Every tool, with its copy, status, access, privacy facts, keywords, related                 |
| `taxonomy.ts` | Categories (what it helps with) and families (Gather, Signal, Image Lab, File Lab)          |
| `index.ts`    | Queries: `listedTools`, `toolBySlug`, `relatedTo`, `privacyFacts`, `catalogFacts`           |
| `search.ts`   | People-language search (synonyms, typos, half-typed words, phrases)                         |
| `validate.ts` | `validateCatalog()` — schema plus cross-checks; `tests/catalog.spec.ts` expects no problems |

The marketplace sections, search, filters, family pages, related tools, the tool page header,
privacy wording, share cards and the static routes all read the registry. Nothing about a tool is
written anywhere else.

### Statuses, visibility, access

- `status`: only **Available**, **Beta** and **Coming soon** ever reach the surface.
- `visibility`: `public` (everywhere), `unlisted` (its page works from a direct link, but it's not
  in the marketplace or search), `hidden` (no page at all).
- `access`: `free`; `freemium` when a planned extra is expected to cost money (listed in `later`
  with `pro: true`); `pro` when the tool itself will. `validateCatalog` keeps these honest.
- `account`: `none` | `optional` | `required`.
- `featured`, `pick` and `fresh` are editorial. There are no usage numbers anywhere.

### Privacy is generated from facts

Each tool declares `privacy: { processing: 'device' | 'server', storage: ['none' | 'browser' |
'link' | 'account'], note? }`. `privacyFacts()` turns those facts into every label and sentence
the site shows ("Runs on your device", "On your device · shared by link", "Kept with your
account"), so a claim can't outrun the code. A tool may only say it runs on your device when it
really does its work in the browser.

## Adding a tool

1. Add its id to `TOOL_IDS` (`ids.ts`) and an entry to `tools.ts` — copy, category, family,
   privacy facts, keywords in people's words, aliases (other products people know), related tools,
   the modes it belongs to (rank and line in each) and its tier. Add it to a situation or an
   intent in `modes.ts` / `search.ts` if it truly belongs there (docs/HOME.md).
2. Give it artwork in `src/components/marketplace/art.tsx` and, once it's open, a miniature in
   `src/components/marketplace/minis.tsx` — TypeScript asks for both.
3. Give it a world in `src/components/marketplace/worlds.ts` (surface, room, paper, ink, second
   and third colors, pattern, main object, motion, payoff, action, path) — also required by
   TypeScript. See docs/EXPERIENCE.md.
4. Give it an interface: `src/components/tools/{name}-tool.tsx` (no props), and register it in
   `src/components/marketplace/tool-runtime.tsx` — also required by TypeScript. A Coming soon tool
   registers `null`; a tool marked Available without an interface fails the build.
5. Put its logic in `src/lib/tools/{name}.ts` with tests in `tests/lib-{name}.spec.ts`.
6. `npm run test:unit` (the registry, search and tool logic) and `npm run verify`.

It then appears in the marketplace, its category, its family, search and related tools, with its
own static page and share card.

## How tools keep things

- **Nothing** — most File Lab and Image Lab tools: files are read in the browser and results are
  downloads. Zips are made on the device (`src/lib/files/zip.ts`).
- **This browser** — `useLocalState()` (`src/lib/share/local.ts`): validated localStorage, SSR-safe.
  Used for drafts (a bill, a subscription list, a Signal Page).
- **The link itself** — `src/lib/share/link-state.ts`: state is compressed into the address after
  `#` (`#z…`), which browsers never send to a server. When?, Bring, the Christmas List, Where?,
  Plan and shared Split bills work this way: people pass the updated link back to the group, and
  opening a link merges it with what this browser already knows. Every decoded link is validated
  with the tool's zod schema — a link is input from a stranger.
- **Photos in this browser** — `src/lib/share/photos.ts`: IndexedDB for pictures (Receipts),
  made smaller first; the records beside them stay in `useLocalState`.
- **An account** — not built yet. Receipts and Mileage keep everything in this browser today
  (they also work inside Hyphy Spaces); with accounts they keep the same shapes and move.

`useLocalState` writes a change still waiting in its debounce when the page goes away, so
leaving right after a change (to another tool, say) never loses it.

When persistence arrives, a tool keeps the same state shape and swaps where it lives: the link
becomes an id, the zod schema stays the contract.

## Search

`searchTools(query, listedTools)` normalizes, stems and expands everyday synonyms, then scores
each tool by where the words land (name, aliases, kind, keywords, tagline, description), with
bonuses for whole phrases and a penalty for answering only half the question. Typos (one or two
letters) and half-typed words count. When a tool matched through a name people know it by, the
result says so ("Signal Pages · for “linktree”"). The examples the user gave are tests.

## The marketplace and tool pages

The home above all this (modes, your tools, situations) is in docs/HOME.md. With "All" chosen,
or on a first visit below the one question, the classic marketplace opens on “What do you want to do?”: quick actions for the common jobs (each a
tiny version of its tool), then search, then two featured tools, three mood shelves (“Make it
look good” prints, “Plans with people” wide cards, “Everyday helpers” tiles), every open tool as
an app-style row under what it helps with, a one-line privacy note and what's on the way. Every
card is its tool's world with a miniature of the tool in it (`minis.tsx`): a receipt with who had
what, a lit week, a real QR code, “4.8 MB → 380 KB”. No counts, staff picks or badges; only Beta
and Soon are ever tagged.

A tool page is its tool's world (docs/EXPERIENCE.md): one slim line (back, mark, name,
“Stays on your device ⓘ”, Share), then the tool itself. How it works, where data goes, honest
limits and what's coming live in the info drawer (`#tool-info`, a native popover) and a quiet
line under the workspace, followed by “Open next”. On a phone the tool starts on the first screen.

## Performance rules

Measured on the production build (iPhone viewport, 4× CPU throttle), these were what made
browsing slow; keep them out:

- **No `:has()` anchored on `<html>` or `body`.** It makes the browser restyle the whole page
  after every DOM change (67 ms per change on the marketplace, unthrottled). Put a flag on
  `<html>` instead: `data-world` (layout), `data-modal` (`useModalLock`), `data-demo-dock`.
- **Tool links prefetch on intent.** Use `IntentLink` (`components/marketplace/intent-link.tsx`)
  for links to tools and to the marketplace: it prefetches on touch, hover or focus. Plain
  `<Link>` prefetches every static page it can see; on the marketplace that was over 1 MB.
- **No view transitions for page changes**: snapshotting the old page was the slowest part of
  opening a tool. `PageTransition` is a CSS fade on the new page.
- **Client schemas use `zod/mini`.** Full `zod` is a 390 KB chunk; `lib/tools/*` schemas ship in
  tool pages. `useLocalState` and `decodeState` accept either.
- **Heavy engines load when used**: pdf-lib, PDF.js and the receipt reader are `import()`ed when
  a file is chosen, never at the top of a module. The marketplace test suite checks this.
- **Glows are gradients, not blur filters**; animate transforms and opacity only.

## Group sessions

Where?, Plan (and, in their own words, When?, Bring and the Christmas List) are group sessions:
one thing a group does together, living in its link. `src/lib/share/group.ts` is the device
store (the sessions this browser keeps, its role in each — organizer or guest — and who this
device is), `components/tools/group-session.ts` the hook that opens a link, merges it, keeps the
address current and builds the shareable link, and `components/tools/group-share.tsx` the shared
parts: send (the share sheet or the clipboard), a code to scan, the tick when it went out,
“What should we call you?” (the name is offered again in every group tool on this device), the
bar that asks a guest to send the link back, and the sessions list. Each tool brings only its
schema and its merge (`mergeWhere`, `mergePlan`), tested for order-independence.

Secret Santa is deliberately not a shared session: the draw stays in the organizer's browser and
each person's private link carries only their own envelope (`slipFor`), so no link can reveal
anyone else's match.

## Plan connects the group tools

A Plan opens When?, Where?, Bring and Split for its occasion (`/tools/when?plan=…&title=…`,
`src/lib/share/handoff.ts`). The tool starts titled for the plan and shows “For Kamila's
Birthday · Add to the plan” (`components/tools/plan-return.tsx`); that leaves the tool's link and
a one-line summary in this browser under the plan's id, and `/tools/plan?open=…` takes them in:
Where? brings its winner as the place, When? its best time as the day. Where? can also start a
new plan from a winner (`/tools/plan?place=…`). The hops are full navigations on purpose: these
pages keep rewriting their own address, which can cancel a client-side one.

## Receipts and Mileage

Receipts reads a photo once with the same on-device reader as Split
(`readReceiptLines` in `lib/tools/receipt-reader.ts`), parses the amounts with `parseReceipt` and
the date, card and category with `extractExpense` (`lib/tools/receipts.ts`), and asks only for
what it couldn't read. What was found is saved with the record; nothing is read twice and nothing
is uploaded. PDFs are drawn to a picture first (`lib/tools/pdf-render.ts`).

Mileage measures a drive from `navigator.geolocation.watchPosition` while the page is open
(`addFix` in `lib/tools/mileage.ts` ignores vague fixes, standing-still jitter and impossible
jumps), keeps the screen on with the Wake Lock API where available, and survives a reload. The
site's `Permissions-Policy` allows camera and location for itself only (`next.config.ts`).

## Split reads receipts on the device

Split is receipt first: a photo (camera on phones, a file anywhere) is read by a
`ReceiptReader` (`lib/tools/receipt-reader.ts`), parsed by `parseReceipt` (`lib/tools/receipt.ts`,
tested in `tests/lib-receipt.spec.ts`) and shown for review before anything is split. Every
reader declares `where` the photo goes and a one-line `privacy` sentence, which Split shows by
the camera button; a reader that uploads must say so, and the tool's registry privacy facts must
change with it.

The reader today is Tesseract (WebAssembly) running in a worker. Its worker, engine and English
model are copied from `node_modules` into `public/vendor/ocr` by `scripts/vendor-ocr.mjs` (run
before `dev` and `build`; ignored by git), so reading a receipt talks to no one else. The first
scan downloads about 4 MB, cached afterwards. A vision model behind a Hyphy route can replace it
by returning a `ParsedReceipt` from a new reader in `receiptReader()`.

Split's steps live in the address (`?step=people`), so the back gesture steps back through the
check; typing items in and splitting evenly stay one tap from the start.

## Look and motion

The public world is `.world-night` (`src/app/(public)/world.css`): the product's semantic tokens
re-lit for dark, so tools written against tokens work in both the light Spaces product and the
dark world. See docs/DESIGN.md. Motion is CSS only: a fade as pages open, reveals once on scroll
(hidden only after the runtime starts, with a failsafe), a slow ambient drift in the hero, hover
depth on cards, and nothing when reduced motion is on.
