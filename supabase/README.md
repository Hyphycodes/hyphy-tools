# Supabase — the Hyphy Tools database

The app reads and writes this database when `HYPHY_DATA=supabase`; with the default
(`HYPHY_DATA=demo`) it needs no database at all. The same schema runs on a hosted Supabase project
or on plain Postgres (with `tests/prelude.sql` standing in for what Supabase provides).

## What's here

| Path                                                | What it is                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/20260925000000_platform_foundation.sql` | Profiles, Spaces, memberships and every Space-owned table; `can(space, permission)` mirroring `src/lib/platform/roles.ts`; Row Level Security on all of it                                   |
| `migrations/20260925100000_connected_systems.sql`   | One review shape for receipts and trips, project value and allowance, work style, pins                                                                                                       |
| `migrations/20260926000000_real_persistence.sql`    | Approval history, activity written by triggers, review guards, invitations, the Space directory, indexes, policy fixes found in review                                                       |
| `migrations/20260927000000_hosted_hardening.sql`    | Found deploying to hosted Supabase: no `anon` access to anything, internal helpers not callable, seeding mode not usable by a person, the `hyphy_app` role, guests' directory narrowed       |
| `migrations/20260927100000_advisor_fixes.sql`       | Supabase's database advisor: trigger functions not offered as RPCs, a fixed search path                                                                                                      |
| `migrations/20260927200000_no_truncate.sql`         | No TRUNCATE (which bypasses Row Level Security), TRIGGER or REFERENCES for people or the public API                                                                                          |
| `migrations/20260928000000_real_accounts.sql`       | Real accounts: every new Supabase Auth user gets a profile, Personal Space and owner membership, once; profile email follows Auth; Personal Spaces hold only their owner; reserved addresses |
| `tests/accounts.sql`                                | The account bootstrap: once and idempotent, nobody bootstraps or edits anyone else, personas untouched; always rolled back                                                                   |
| `dev/dev_tools.sql`                                 | **Development only.** The development marker, Demo Mode's personas, and the guarded `dev.reset_world` / `dev.changes_since_seed`                                                             |
| `tests/isolation.sql`                               | RLS attack suite: real people trying what must fail (other Spaces, ids from elsewhere, self-approval, guest enumeration, `anon`)                                                             |
| `tests/fingerprint.sql`                             | What every persona can see, hashed — identical on every database holding the development world                                                                                               |
| `tests/flows.sql`                                   | The product's write paths as real people, checking what the triggers record; always rolled back                                                                                              |
| `tests/prelude.sql`                                 | Stand-ins for Supabase's `auth` schema and roles, so the migrations run on plain Postgres                                                                                                    |

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
- **Accounts.** A new Supabase Auth user gets exactly one profile, Personal Space and owner
  membership (`private.ensure_person`, callable by nobody). People edit only their own name and
  details — never an id or email. A Personal Space holds only its owner.
- **The public API gets nothing.** Hosted Supabase publishes `public` to anyone holding the
  publishable key, as `anon`; `anon` has no table or function at all. Hyphy Tools doesn't use that
  API. Signed-in people can call only the policy helpers (which answer about their own access),
  `invite_member` and `space_directory`.

## The app's database role

The app logs in as `hyphy_app`, never as `postgres` and never with the service-role key.
`hyphy_app` owns nothing and can read or change nothing itself: all it can do is become
`authenticated` for one transaction as a given person (`src/lib/data/supabase/db.ts`) — how
Supabase's own API runs a signed-in request — so these policies decide every row, even if the
app's credentials leaked. On a development database it can also read the persona map and call the
two guarded `dev.` functions.

Its password is set per environment, never in a migration or in this repository. In the
project's SQL editor:

```sql
alter role hyphy_app login password '<a long random password>';
```

and the app's connection string is the project's **transaction pooler** (Supabase → Connect →
Transaction pooler, port 6543) with that role:

```
postgres://hyphy_app.<project-ref>:<password>@<pooler-host>:6543/postgres
```

## Development database

Who the person is comes from the identity source; see `docs/DEMO-MODE.md` for how Demo Mode picks
one without trusting the browser.

**On this machine** (Postgres 15+; no Docker needed):

```sh
export DATABASE_URL=postgres://hyphy_app@localhost:54322/hyphy          # as the app
export DATABASE_ADMIN_URL=postgres://postgres@localhost:54322/hyphy     # to rebuild it
npm run db:local     # drop + create: prelude, migrations, dev tools, then seed as the app
npm run test:data    # repository, RLS isolation, parity and reset tests
psql "$DATABASE_ADMIN_URL" -f supabase/tests/isolation.sql     # attack suite, report at the end
HYPHY_DATA=supabase HYPHY_DEMO_RESET=on npm run dev
```

**`hyphy-tools-dev`** (hosted, `jgvrqdausbjkfsspjgce`) holds all seven migrations (the seventh,
`real_accounts`, checked there with `tests/accounts.sql`), the dev tools
and the seeded world. It was checked with the same files: `tests/isolation.sql` (every attack
refused), `tests/flows.sql` (every write path as real people) and `tests/fingerprint.sql`, whose
hash is identical to the local database's — every persona sees exactly the same rows on hosted
Supabase as locally, and locally exactly what Demo Mode shows. To rebuild another development
project: `supabase db push`, then `supabase/dev/dev_tools.sql` in the SQL editor, set the
`hyphy_app` password, then `DATABASE_URL=… npm run db:seed`. Never on a production project.

Every setting the app makes is transaction-local, so the transaction pooler is safe. Reads are one
round trip: the claims and the statement go as one message, which Postgres runs as one implicit
transaction.

## Seeding and Reset

`src/lib/data/supabase/world.ts` turns the same seed Demo Mode uses into rows (ids become stable
uuids through `demoUuid`, timestamps are relative to now) and hands them to `dev.reset_world`,
which runs as one transaction: it refuses unless the database is marked `development`, refuses a
malformed world before touching anything, takes every lock up front, truncates and re-inserts.
Tables come from a fixed list and values are typed by each table's row type — the function accepts
data, never SQL. Triggers are silenced for the seed only (`hyphy.seeding`, which a person's
request can't switch on), so the seeded activity and history are exactly the story's. If it loses
a deadlock race with page reads it is retried; concurrent resets and reads are tested.

Reset in the app calls the same thing, and only when `HYPHY_DEMO_RESET=on` is set on the server
**and** the database carries the development marker. A production database has neither — and no
`dev.reset_world` to call.

## Advisor notes

Supabase's database advisor on `hyphy-tools-dev` has no errors. What it still reports, on purpose:
the policy helpers, `invite_member` and `space_directory` are callable by signed-in people (they
must be, and each is covered by `tests/isolation.sql`); and, for scale rather than correctness,
policies that call `auth.uid()` per row instead of `(select auth.uid())`, and foreign keys on
`created_by`-style columns without indexes. Worth doing before production data volumes, not now.

## Files

File records, their attachments and their activity are real rows. The bytes are not stored yet:
there is no Storage bucket, Download is disabled, and the file panel says so. Adding a private
`space-files` bucket whose policies call `can_see_file()` is part of the production work in
`docs/AUTH.md`.
