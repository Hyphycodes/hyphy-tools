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
| `/tools`                        | The marketplace: search, filters (`?c=money`), editorial sections       |
| `/tools/{slug}`                 | One tool: header facts, the tool itself, how it works, privacy, related |
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
   privacy facts, keywords in people's words, aliases (other products people know), related tools.
2. Give it artwork in `src/components/marketplace/art.tsx` — TypeScript asks for it (every id
   needs a composition).
3. Give it an interface: `src/components/tools/{name}-tool.tsx` (no props), and register it in
   `src/components/marketplace/tool-runtime.tsx` — also required by TypeScript. A Coming soon tool
   registers `null`; a tool marked Available without an interface fails the build.
4. Put its logic in `src/lib/tools/{name}.ts` with tests in `tests/lib-{name}.spec.ts`.
5. `npm run test:unit` (the registry, search and tool logic) and `npm run verify`.

It then appears in the marketplace, its category, its family, search and related tools, with its
own static page and share card.

## How tools keep things

- **Nothing** — most File Lab and Image Lab tools: files are read in the browser and results are
  downloads. Zips are made on the device (`src/lib/files/zip.ts`).
- **This browser** — `useLocalState()` (`src/lib/share/local.ts`): validated localStorage, SSR-safe.
  Used for drafts (a bill, a subscription list, a Signal Page).
- **The link itself** — `src/lib/share/link-state.ts`: state is compressed into the address after
  `#` (`#z…`), which browsers never send to a server. When?, Bring, the Christmas List and shared
  Split bills work this way: people pass the updated link back to the group, and opening a link
  merges it with what this browser already knows. Every decoded link is validated with the tool's
  zod schema — a link is input from a stranger.
- **An account** — not built yet. Receipts and Mileage (working in Hyphy Spaces) wait for it.

When persistence arrives, a tool keeps the same state shape and swaps where it lives: the link
becomes an id, the zod schema stays the contract.

## Search

`searchTools(query, listedTools)` normalizes, stems and expands everyday synonyms, then scores
each tool by where the words land (name, aliases, kind, keywords, tagline, description), with
bonuses for whole phrases and a penalty for answering only half the question. Typos (one or two
letters) and half-typed words count. When a tool matched through a name people know it by, the
result says so ("Signal Pages · for “linktree”"). The examples the user gave are tests.

## Look and motion

The public world is `.world-night` (`src/app/(public)/world.css`): the product's semantic tokens
re-lit for dark, so tools written against tokens work in both the light Spaces product and the
dark world. See docs/DESIGN.md. Motion is CSS and the View Transitions API only: reveals once on
scroll (hidden only after the runtime starts, with a failsafe), a slow ambient drift in the hero,
hover depth on cards, and nothing when reduced motion is on.
