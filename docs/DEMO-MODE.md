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

## Where it lives

Everything Demo Mode is confined to:

| File                                  | Role                                             |
| ------------------------------------- | ------------------------------------------------ |
| `src/lib/identity/demo-source.ts`     | The demo `IdentitySource` (reads the cookie)     |
| `src/lib/data/demo/`                  | Seed, clock, journal, demo `Repository`          |
| `src/lib/demo/actions.ts`, `model.ts` | Preview As / Reset server actions and their data |
| `src/components/demo/demo-bar.tsx`    | The dock and the Preview As sheet                |

The product itself never checks for Demo Mode. The single condition is in the Space layout:
render `<DemoBar>` when `session.source === 'demo'`. (On desktop the sidebar makes room for the
dock through one CSS rule in `globals.css`, keyed on the dock's `data-demo-dock` attribute; it
goes away with the dock.) The command bar's "Preview as" results come
from the same demo model and disappear with it.

## Removing it

1. Implement the Supabase identity source and repository (see AUTH.md) and set
   `HYPHY_IDENTITY=supabase`, `HYPHY_DATA=supabase`.
2. Delete `src/lib/demo/`, `src/components/demo/`, `src/lib/identity/demo-source.ts` and
   `src/lib/data/demo/` (keep the seed as fixtures for tests or a staging database if useful).
3. Remove the `demo` prop from `AppShell` and the `demoModel` call in the Space layout.

Pages, components, server actions and the registries don't change.
