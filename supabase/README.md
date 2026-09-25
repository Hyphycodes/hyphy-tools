# Supabase — the Hyphy Tools database

The app reads and writes this database when `HYPHY_DATA=supabase`; with the default
(`HYPHY_DATA=demo`) it needs no database at all. The same schema runs on a hosted Supabase project
or on plain Postgres (with `tests/prelude.sql` standing in for what Supabase provides).

## What's here

| Path                                                | What it is                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/20260925000000_platform_foundation.sql` | Profiles, Spaces, memberships and every Space-owned table; `can(space, permission)` mirroring `src/lib/platform/roles.ts`; Row Level Security on all of it |
| `migrations/20260925100000_connected_systems.sql`   | One review shape for receipts and trips, project value and allowance, work style, pins                                                                     |
| `migrations/20260926000000_real_persistence.sql`    | Approval history, activity written by triggers, review guards, invitations, the Space directory, indexes, policy fixes found in review                     |
| `dev/dev_tools.sql`                                 | **Development only.** Marks a database as the development world and maps Demo Mode's persona keys to seeded people                                         |
| `tests/prelude.sql`                                 | Stand-ins for Supabase's `auth` schema and roles, so the migrations run on plain Postgres                                                                  |
| `tests/rls-smoke.sql`                               | A quick hand-run policy check                                                                                                                              |

### Tables

`profiles`, `spaces`, `space_members`, `projects`, `vehicles`, `receipts`, `mileage_entries`,
`files` + `file_attachments`, `qr_codes`, `link_pages`, `activity`, `inbox_items`,
`approval_events`, `pins`, and the `approval_queue` view. Every Space-owned row carries `space_id`
and its creator (`created_by`). **No Storage buckets yet** — see "Files" below.

### What Row Level Security protects

- **Spaces are sealed.** Every table is readable only by members of the row's Space; nothing
  crosses Spaces, including by id.
- **Money is personal.** Members see their own receipts and trips; approvers
  (`expenses.view_all`) see everyone's. Guests see no money but their own.
- **Guests** see only the projects they were given and what's attached to them — no vehicles, no
  company directory.
- **Approvals.** Members can create only drafts or submissions, never approved rows; a member
  can't approve or return their own; a decided item can't be re-decided; owner and Space never
  change (`guard_review`). The history in `approval_events` and all of `activity` are written only
  by triggers, as the person acting — nobody can insert history by hand.
- **Plans and roles** can't be changed from the app: `spaces.plan` has no update grant, and only
  owners grant owner or admin (`invite_member`).
- **Pins** belong to one person in one Space.

## Development database

The app never uses the service-role key. It connects with `DATABASE_URL` (server only) and runs
every query inside a transaction as the person — `role authenticated` plus that person's JWT
claims, exactly how Supabase's own API runs a signed-in request — so these policies decide every
row. Who the person is comes from the identity source; see `docs/DEMO-MODE.md` for how Demo Mode
picks one without trusting the browser.

**On this machine** (Postgres 15+; no Docker needed):

```sh
export DATABASE_URL=postgres://postgres@localhost:54322/hyphy
npm run db:local     # drop + create the database: prelude, migrations, dev tools, seed
npm run test:data    # repository, RLS isolation and parity tests (35)
HYPHY_DATA=supabase HYPHY_DEMO_RESET=on npm run dev
```

**On a hosted project** — a dedicated `hyphy-tools-dev` project, never Hyphy Studio's or any
other project with real data:

```sh
supabase link --project-ref <ref> && supabase db push        # the three migrations
psql "$DATABASE_URL" -f supabase/dev/dev_tools.sql           # development projects only
DATABASE_URL=… npm run db:seed                               # the seeded world
```

Use the pooler connection string (transaction mode, port 6543) for the app. Every setting the app
makes is transaction-local, so pooling is safe.

## Seeding and Reset

`src/lib/data/supabase/world.ts` turns the same seed Demo Mode uses into SQL (ids become stable
uuids through `demoUuid`, timestamps are relative to now). It runs in one transaction, first
checks that the database is marked `development` and aborts otherwise, then takes every lock it
needs before truncating and re-inserting. Triggers are silenced for the seed (`hyphy.seeding`), so
the seeded activity and history are exactly the story's.

Reset in the app calls the same thing, and only when both `HYPHY_DEMO_RESET=on` is set on the
server **and** the database carries the development marker. A production database has neither.

## Files

File records, their attachments and their activity are real rows. The bytes are not stored yet:
there is no Storage bucket, Download is disabled, and the file panel says so. Adding a private
`space-files` bucket whose policies call `can_see_file()` is part of the production work in
`docs/AUTH.md`.
