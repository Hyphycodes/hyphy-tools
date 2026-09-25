# Hyphy Tools

The software platform of Hyphy LLC: a universal toolbox that grows into a person's or a
business's operating system. Hyphy Studio (`hyphy-studio`) is the marketing site; this repository
is the product.

**Demo Mode is the default.** There is no sign-in: open it and you're in, as one of the Demo Mode
people, in one of their Spaces. Real accounts (Supabase Auth: sign-up, sign-in, recovery, a
Personal Space for every new account) are built and tested but switched off until the hosted
setup is verified — see [docs/AUTH.md](docs/AUTH.md). The account pages (`/sign-in`, `/sign-up`, …)
can be opened in Demo Mode as a preview.

## Run it

Node 22+ and npm.

```sh
npm ci
npm run dev          # http://localhost:3000/platform
```

No environment variables, database or accounts are needed. `/` opens the current person's main
Space. The slim **Demo · Preview as…** control at the bottom of the sidebar (a thin line above the top bar on
phones, or <kbd>Shift</kbd>+<kbd>D</kbd> anywhere) previews as someone else; **Reset** undoes your
changes.

```sh
npm run verify       # lint + route types + TypeScript + production build
npm test             # unit + end-to-end tests (starts `next start` on :3107; build first)
```

In a sandbox with a preinstalled Chromium: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm test`.

## Who you can be

| Person         | Space              | Role            | What it shows                                        |
| -------------- | ------------------ | --------------- | ---------------------------------------------------- |
| Jerry          | Personal           | Personal        | Tools, receipts, miles, saved work                   |
| Jerry          | Hyphy LLC          | Owner           | A small studio: projects, approvals, plan            |
| Jerry          | Salt & Ember / ABC | Manager / Guest | One person, four roles                               |
| Sarah Chen     | Hyphy LLC          | Manager         | Operations without settings or billing               |
| Dana Whitfield | ABC Construction   | Owner           | Projects, vehicles, people, approvals, plan          |
| Luis Ortega    | ABC Construction   | Admin           | People and settings, no plan                         |
| Mike Rodriguez | ABC Construction   | Member          | Phone-first: his project, his truck, his submissions |
| Chris Okafor   | ABC Construction   | Guest           | Two shared projects and their files, nothing else    |
| Rosa Delgado   | Salt & Ember       | Owner           | A restaurant: events, QR codes, link page            |

All people and businesses are fictional. Emails use the reserved `.example` domain.

## Where things are

```
src/
  app/(app)/[space]/…      every page lives inside a Space: /personal, /hyphy, /abc-construction…
  app/(app)/[space]/actions.ts   every change: validate → check permission → repository
  lib/platform/            the product's rules: types, roles, plans, tool registry, Create registry,
                           navigation, dashboard composition, custom fields, formatting
  lib/identity/            who is here (Session, Workspace) — Demo Mode or real accounts (mode.ts)
  lib/supabase/, lib/auth/ Supabase Auth clients, session proxy, account actions and rules
  lib/data/                what they can see (Repository) — demo repository now, Supabase later
  lib/data/demo/           seeded world + the per-browser change journal
  lib/demo/                Demo Mode controls (Preview As, Reset) — removed with real sign-in
  components/shell/        sidebar, phone bars, Space switcher, command bar, Create menu
  components/create/       Universal Create sheets (receipt, mileage, project, person, vehicle, files)
  components/dashboard/    role-aware dashboard widgets
  components/records/      shared rows: activity, inbox, projects, vehicles, files, receipts
  components/tools/        the tools (QR, PDF, Images ported from Studio; Links, Receipts, Mileage)
  components/ui/           design system primitives
supabase/                  proposed schema + RLS (not applied), with an RLS smoke test
docs/                      architecture, auth plan, Demo Mode, design, Studio inventory
tests/                     unit (rules) and end-to-end (personas, access, flows, phones)
```

## Read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Spaces, roles vs plans vs modules, the registries, data flow.
- [docs/DEMO-MODE.md](docs/DEMO-MODE.md) — how the preview works and how to remove it.
- [docs/AUTH.md](docs/AUTH.md) — real accounts: how they work, what's tested, how to switch them on.
- [docs/DESIGN.md](docs/DESIGN.md) — the visual system.
- [docs/STUDIO-INVENTORY.md](docs/STUDIO-INVENTORY.md) — what came from Hyphy Studio and what stays there.

## Routes

Everything is served under `/platform` (`basePath`, set in `src/lib/base-path.ts`):
hyphy-studio.com/platform is a Vercel rewrite to this deployment, which ships on its own. The
paths below are relative to it.

`/` → your main Space. Inside any Space (`/{space}`):

| Path                                     | What                                             |
| ---------------------------------------- | ------------------------------------------------ |
| `/`                                      | Home: composed for your role                     |
| `/inbox`                                 | Needs attention: approvals, documents, mentions  |
| `/tools`                                 | Tools library                                    |
| `/tools/receipts` `/tools/mileage`       | Trackers with approvals and CSV export           |
| `/tools/receipts?receipt=…`              | One receipt: details, status, approve or return  |
| `/tools/mileage?trip=…`                  | One trip: details, status, approve or return     |
| `/tools/pdf` `/tools/qr` `/tools/images` | Utilities (ported from Hyphy Studio, extended)   |
| `/tools/links`                           | Link page editor with live phone preview         |
| `/projects` `/projects/[id]`             | Projects (a restaurant's are Events), with tabs  |
| `/vehicles` `/vehicles/[id]`             | Vehicles: fuel, trips, papers, custom fields     |
| `/people` `/people/[id]`                 | People and the role table                        |
| `/files`                                 | Files, attached to the records they belong to    |
| `/activity`                              | The shared activity feed                         |
| `/settings`                              | Space profile, plan, tools on/off, custom fields |
| `/profile`                               | One identity, every Space and role               |

## Deployment

Ready for Vercel as a standard Next.js project with no environment variables. It is not deployed
by this repository; create a dedicated Vercel project when you want a preview URL.
