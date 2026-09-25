# Supabase — proposed, not applied

Nothing in this folder has been applied to any database. Phase 1 runs entirely on Demo Mode and
needs no Supabase project or credentials.

`migrations/20260925000000_platform_foundation.sql` is the proposed production schema:

- `profiles` (one per person) and `spaces` (personal or business) with `space_members` carrying
  each person's role in each Space.
- Space-owned records: `projects`, `vehicles`, `receipts`, `mileage_entries`, `files`
  (+ `file_attachments`), `qr_codes`, `link_pages`, `activity`, `inbox_items`.
- `can(space, permission)` mirrors `src/lib/platform/roles.ts`; every policy uses it, so the
  database enforces what the interface shows.
- Row Level Security reproduces the visibility rules in `src/lib/data/demo/repository.ts`
  (members see their own submissions, guests only shared projects, and so on).

`migrations/20260925100000_connected_systems.sql` follows it: one review shape for receipts and
trips (return reason, resubmission), an `approval_queue` view instead of approval inbox rows,
project `value` and `cost_allowance`, Space `work_style` and `mileage_rate`, QR codes linked to a
project or link page, and a `pins` table.

Before applying:

1. Create a dedicated Supabase project for Hyphy Tools. Never apply this to Hyphy Studio's
   project (which holds leads, client projects and Studio subscriptions) or any other.
2. Review the policies against `repository.ts` and the role table in `roles.ts`.
3. Apply locally first (`supabase db reset`), run the RLS checks listed in `docs/AUTH.md`, then
   apply to the hosted project.

## Checking the policies on plain Postgres

`tests/prelude.sql` stubs Supabase's `auth` schema so the migration runs anywhere; `tests/rls-smoke.sql`
creates an owner, a member and a guest and checks what each can see and do:

```sh
createdb hyphy_tools_check
psql -d hyphy_tools_check -f supabase/tests/prelude.sql
psql -d hyphy_tools_check -f supabase/migrations/20260925000000_platform_foundation.sql
psql -d hyphy_tools_check -f supabase/migrations/20260925100000_connected_systems.sql
psql -d hyphy_tools_check -f supabase/tests/rls-smoke.sql
```

Every count should match its label, and both NOTICE lines should start with `ok:`.
