# From Demo Mode to real accounts

Phase 1 ships without sign-in. This is the plan for replacing Demo Mode with Supabase Auth and a
real database without rebuilding the product. Hyphy Studio already runs Supabase Auth
(passwordless email links, `@supabase/ssr`, a session-refreshing `proxy.ts`); reuse those patterns.

## What stays the same

Pages, server actions, components and the registries consume `Session`, `Workspace` and
`Repository`. None of them know where identity or data come from. The swap happens in two files:

- `src/lib/identity/index.ts` picks the identity source (`HYPHY_IDENTITY`).
- `src/lib/data/index.ts` picks the repository (`HYPHY_DATA`).

## Steps

1. **Project.** Create a dedicated Supabase project for Hyphy Tools (never Studio's). Add
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` to
   the Hyphy Tools Vercel project only.
2. **Schema.** Review and apply `supabase/migrations/20260925000000_platform_foundation.sql`
   locally, run `supabase/tests/rls-smoke.sql`, then apply to the project. Add a private Storage
   bucket `space-files` with policies that call `can_see_file()`.
3. **Clients.** `npm i @supabase/supabase-js @supabase/ssr`; add `src/lib/supabase/server.ts`
   (request-scoped client with cookies) and `src/proxy.ts` that refreshes sessions on app routes —
   both as in Hyphy Studio.
4. **Identity source.** Implement `supabaseIdentity.getSession()` in
   `src/lib/identity/supabase-source.ts`: `auth.getUser()` (verified, not decoded), then the profile
   and active memberships joined with spaces. Map rows to `Person` / `SpaceMembership`.
5. **Sign-in.** Add `/sign-in` (email link) and `/auth/confirm`. When `getSession()` is null, the
   Space layout redirects to `/sign-in?next=…`. New users get a profile and, through the
   `handle_new_profile` trigger, a personal Space.
6. **Repository.** Add `src/lib/data/supabase/repository.ts` implementing `Repository` with the
   user's client. Queries filter by `space_id`; RLS does the per-person scoping, so the demo
   repository's visibility code is not repeated. Writes that must also create activity or inbox
   items rely on the database triggers.
7. **Invitations.** `invite()` inserts an `invited` membership and sends an email (Resend, as in
   Studio). Accepting flips it to `active`.
8. **Switch.** Set `HYPHY_IDENTITY=supabase` and `HYPHY_DATA=supabase`, then remove Demo Mode
   (DEMO-MODE.md).
9. **Billing (later).** Plans map to Stripe prices only when paid plans launch. The webhook
   updates `spaces.plan`; nothing else reads billing. Studio's membership code shows the pattern:
   webhook-verified state only, never a checkout-success URL.

## Tests to add with it

- Unauthenticated requests to any `/{space}` route redirect to sign-in.
- A member can't read another member's receipts through the API, only through approval roles.
- A guest can't read a project they weren't given, or any money.
- An admin can't grant owner or admin; an owner can.
- Turning a module off hides it and refuses its server actions.

The unit and end-to-end suites in `tests/` keep running against Demo Mode and continue to
describe the intended behavior.
