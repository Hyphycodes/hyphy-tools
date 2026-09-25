# Demo Mode

Demo Mode stands in for sign-in during Phase 1 so the whole product can be explored with no
account, database or setup. It is a preview tool, not security.

## What it does

- **Preview As.** A slim dark “Demo · Preview as…” control in the sidebar's footer, under the
  profile it would otherwise repeat (on phones, a thin line above the top bar that shows who you
  are). Click it, press <kbd>Shift</kbd>+<kbd>D</kbd> anywhere, or search
  "preview" in ⌘K, then pick a person and one of their Spaces. It stays out of the page on purpose,
  so the product can be judged as it will ship. The choice is stored in the
  `hyphy_preview_as` cookie so the server renders the right person on the first paint.
- **Your changes.** Receipts, trips, projects, invites, saved codes and tool toggles are written
  to a per-browser journal (`hyphy_demo_journal.*` cookies, capped at ~7 KB — the oldest changes
  drop off first). They're visible to every persona in _your_ browser only, so you can submit as
  Mike and approve as Dana.
- **Pins** live in their own small cookie (`hyphy_demo_pins`, `src/lib/data/demo/prefs.ts`) so
  they never age out with the journal. Seeded defaults apply until someone changes their own.
- **Reset** clears the journal and the pins. The seeded world is regenerated relative to the current time, so
  "3h ago" is always three hours ago.

## On real data

With `HYPHY_DATA=supabase` Demo Mode keeps Preview As and Reset, but the world is the shared
development database instead of the seed plus a journal:

- **Who you are.** The cookie still holds a persona key (`mike`). The server looks it up in the
  development-only `dev.personas` table, then reads and writes _as that person_ under Row Level
  Security (`src/lib/identity/dev-source.ts`, `src/lib/data/supabase/dev.ts`). The browser never
  sends an id or a role, no password or key reaches it, and an unknown key gets the default person.
  The lookup refuses to run unless the database carries the development marker
  (`supabase/dev/dev_tools.sql`), which production never has.
- **Your changes** are real rows, seen by everyone using that database, and survive refreshes,
  other browsers and restarts. The count on Reset is what's changed since the last seed.
- **Pins** are rows in `pins`, per person per Space.
- **Reset** re-seeds the whole development database, for everyone. The server refuses unless
  `HYPHY_DEMO_RESET=on` is set **and** the database is marked as development; without the flag
  the button isn't shown.

## Where it lives

Everything Demo Mode is confined to:

| File                                  | Role                                             |
| ------------------------------------- | ------------------------------------------------ |
| `src/lib/identity/demo-source.ts`     | The demo `IdentitySource` (reads the cookie)     |
| `src/lib/identity/dev-source.ts`      | Personas on the development database             |
| `src/lib/data/supabase/dev.ts`        | Persona lookup, change count, guarded Reset      |
| `supabase/dev/dev_tools.sql`          | The development marker and persona table         |
| `src/lib/data/demo/`                  | Seed, clock, journal, demo `Repository`          |
| `src/lib/demo/actions.ts`, `model.ts` | Preview As / Reset server actions and their data |
| `src/components/demo/demo-bar.tsx`    | The dock and the Preview As sheet                |

The product itself never checks for Demo Mode. The single condition is in the Space layout:
render `<DemoBar>` when `session.source === 'demo'`. (On desktop the sidebar makes room for the
dock through one CSS rule in `globals.css`, keyed on the dock's `data-demo-dock` attribute; it
goes away with the dock.) The command bar's "Preview as" results come
from the same demo model and disappear with it.

## Businesses and invitations in Demo Mode

Creating a business and invitation links are real-account features (docs/BUSINESS.md). In Demo
Mode `/create-business` and `/invite/…` open as previews that say so; inviting still adds the
demo's fictional "invited" person, shown under People → Invited; changing roles, removing and
transferring explain that they work with real accounts. The demo businesses and people stay as
they are.

## Removing it

1. Set `HYPHY_IDENTITY=supabase` and `HYPHY_DATA=supabase` (the Supabase identity source is built;
   see AUTH.md, "Before switching it on"). Demo Mode's actions already refuse to run then.
2. Delete `src/lib/demo/`, `src/components/demo/`, `src/lib/identity/demo-source.ts`,
   `src/lib/identity/dev-source.ts`, `src/lib/data/supabase/dev.ts` and `src/lib/data/demo/`
   (keep the seed and `world.ts` as fixtures for tests and the development database).
3. Remove the `demo` prop from `AppShell` and the `demoModel` call in the Space layout.

Pages, components, server actions and the registries don't change.
