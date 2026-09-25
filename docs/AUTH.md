# From Demo Mode to real accounts

Phase 1.9 made the data real: with `HYPHY_DATA=supabase` every read and write goes to the Hyphy
Tools database under Row Level Security. What's left is real identity — sign-up, sign-in and
sessions — to replace Demo Mode's development personas. Hyphy Studio already runs Supabase Auth
(passwordless email links, `@supabase/ssr`, a session-refreshing `proxy.ts`); reuse those patterns.

## Where things stand

| Piece                                             | State                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Schema, policies, triggers (`supabase/`)          | Done; tested for isolation and parity (`tests/data.spec.ts`)             |
| Repository on the database (`lib/data/supabase/`) | Done; runs as the person, RLS decides                                    |
| Identity                                          | Development personas (`lib/identity/dev-source.ts`) — not for production |
| Sign-up / sign-in                                 | Not built                                                                |
| File bytes (Storage)                              | Not built; metadata only                                                 |
| Invitation email                                  | Not built; `invite_member` creates the invited membership                |
| Billing                                           | Not built                                                                |

## How identity reaches the database

`asPerson(personId, …)` (`src/lib/data/supabase/db.ts`) opens a transaction, switches to the
`authenticated` role and sets the JWT claims to that person — what Supabase's API does for a
signed-in request — so `auth.uid()` is that person and every policy applies. The only question is
where `personId` comes from:

- **Now (development):** Demo Mode's persona key → `dev.personas`, on the server, only on a
  database marked as the development world.
- **Production:** a verified Supabase Auth session. Nothing else changes.

The browser never supplies an id or a role, and the service-role key is never used by the app. The
app logs in as `hyphy_app`, a role that can do nothing but become `authenticated` for one
transaction, so even its own credentials can't get around the policies.

## Steps to real sign-in

1. **Production project.** A separate Supabase project for production (the dev project keeps its
   `dev` schema; production never gets `supabase/dev/`). Apply the migrations with
   `supabase db push` and set the `hyphy_app` password there. Set `DATABASE_URL` (transaction
   pooler, as `hyphy_app`), `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on the Hyphy Tools Vercel project only.
2. **Clients.** `npm i @supabase/supabase-js @supabase/ssr`; add `src/lib/supabase/server.ts`
   (request-scoped client with cookies) and `src/proxy.ts` refreshing sessions — as in Studio.
3. **Identity source.** In `src/lib/identity/supabase-source.ts`: `auth.getUser()` (verified with
   Supabase, never just decoded), then `loadSession(user.id, 'supabase')` from
   `src/lib/data/supabase/session.ts` — the same query the dev personas use.
4. **Sign-in.** `/sign-in` (email link) and `/auth/confirm`. A null session redirects to
   `/sign-in?next=…`. `handle_new_profile` gives every new person a personal Space.
5. **Invitations.** Send the email when `invite_member` runs; accepting flips the membership to
   `active` and links the placeholder identity to the real auth user.
6. **Storage.** A private `space-files` bucket with policies calling `can_see_file()`; upload
   through signed URLs; turn Download on.
7. **Switch.** `HYPHY_IDENTITY=supabase`, `HYPHY_DATA=supabase`; remove Demo Mode (DEMO-MODE.md).
8. **Billing (later).** A Stripe webhook updates `spaces.plan`; nothing else reads billing.

## Tests to add with it

- Unauthenticated requests to any `/{space}` route redirect to sign-in.
- A forged or expired session cookie gets no data.
- The isolation suite in `tests/data.spec.ts` runs again with sessions from real sign-ins.
