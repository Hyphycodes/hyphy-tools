# Real accounts (Supabase Auth)

Phase 2A built real sign-in behind the product: email and password with Supabase Auth, a verified
session on every request, and a Hyphy profile with a Personal Space made for every new account.
**It is built and tested, but it is not switched on.** Demo Mode is still the default.

## Current state

| Setting                   | What happens                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HYPHY_IDENTITY` unset    | **Demo Mode.** No sign-in. `/` opens the app as a Demo Mode person; Preview As, Space switching and Reset work as before. |
| `HYPHY_IDENTITY=demo`     | Same. Anything other than exactly `supabase` means Demo Mode, so a typo can never switch real accounts on.                |
| `HYPHY_IDENTITY=supabase` | **Real accounts.** Every app page needs a verified Supabase Auth session; Demo Mode's controls refuse to run.             |

In Demo Mode the account pages (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`,
`/welcome`, `/auth/error`) can still be opened to review them. They carry a "Preview" line, their
forms answer "sign-in isn't switched on yet", and nothing sends anyone to them. The proxy does
nothing at all in Demo Mode.

**Not yet verified:** the hosted path — a Vercel deployment talking to hosted Supabase Auth and the
hosted database. See "Before switching it on".

## How it fits together

Authentication (who are you?) is Supabase Auth. Authorization (what may you see and do?) is the
Hyphy database: memberships, roles and Row Level Security. The two meet at one id:
**`profiles.id = auth.users.id`**.

```
browser ──cookies──▶ src/proxy.ts ──▶ lib/supabase/proxy.ts   refresh + getClaims(); guard routes
                                   │
page / server action ──▶ lib/identity/index.ts   getSession(): the one switch (mode.ts)
                                   │
            ┌──────────────────────┼──────────────────────────┐
     demo-source.ts          dev-source.ts             supabase-source.ts
   (seed + cookie)     (dev DB personas, server)   verifiedIdentity() → getClaims()
                                   │                            │
                                   └──────── loadSession(personId) ────────┘
                                     profile + active memberships, read AS the person under RLS
                                                       │
                                     Session → Workspace → Repository (unchanged)
```

- **One switch.** `lib/identity/mode.ts` reads `HYPHY_IDENTITY` on the server. `lib/identity/index.ts`
  picks the identity source; pages, tools and dashboards receive the same `Session`/`Workspace`
  whichever produced it. The only differences the UI sees are capability-based: `session.account`
  exists for real accounts (so Profile shows the account and password panels, and the profile menu
  a working Sign out).
- **Real accounts need the real database.** `HYPHY_IDENTITY=supabase` refuses to run unless
  `HYPHY_DATA=supabase` — a real person must never be shown the fictional seed.
- **Identity is verified, not read.** `verifiedIdentity()` (`lib/supabase/server.ts`) calls
  `supabase.auth.getClaims()`, which verifies the access token's signature — locally against the
  project's published keys when it uses asymmetric signing keys (the default for new projects),
  otherwise with Supabase Auth. `getSession()` from supabase-js is never trusted. Once per request
  (React `cache`). Only `sub` (a uuid) and `email` are used; `role` must be `authenticated`.
- **Everything else comes from the database.** `loadSession(sub)` reads the profile and active
  memberships as that person, under RLS — the same function Demo Mode's development personas use.
  Roles, Spaces and access never come from Auth metadata, cookies or the browser.

### Clients (`@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2)

| File                     | Used by                                           | Notes                                                                 |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------- |
| `lib/supabase/server.ts` | Server Components, Server Actions, Route Handlers | New client per call, with this request's cookies; never module-scoped |
| `lib/supabase/proxy.ts`  | `src/proxy.ts` (Next.js 16's name for middleware) | Refreshes the session, writes cookies to request and response         |
| `lib/supabase/client.ts` | Client Components (none yet)                      | Publishable key only; every Auth action currently runs on the server  |
| `lib/supabase/config.ts` | all three                                         | Refuses a secret or `service_role` key in the public variable         |

Supabase is used for **Auth only**. Data still goes through `DATABASE_URL` as `hyphy_app`, becoming
the verified person per transaction (`lib/data/supabase/db.ts`), so RLS decides every row exactly as
in Phase 1.9.

### Session refresh (the proxy)

With real accounts, before every page (static files excluded by the matcher):

1. Create the Supabase client over the request's cookies — then immediately `getClaims()`, with
   nothing in between (Supabase's guidance: anything in between risks random sign-outs).
2. If the token was refreshed, `setAll` writes the new cookies onto the request (so this render
   sees them) and the response (so the browser keeps them), plus Supabase's
   `Cache-Control: private, no-cache, no-store`, `Expires` and `Pragma` headers so no CDN can serve
   one person's session to another. Redirects copy the cookies and those headers.
3. Not signed in and not on a public account page → `/sign-in?next=<where they were going>`.
   Signed in and on `/sign-in`, `/sign-up` or `/forgot-password` → home.
4. Remember the Space they're in (`hyphy_space` cookie) so `/` can return there.

Pages and every Server Action check again through `requireSession`/`requireWorkspace` — the proxy is
the first gate, not the only one (a Server Action posts to whatever route it's on).

### Route protection

- Public: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/auth/*`.
- Everything else, including `/welcome`, needs a session.
- Unknown Space, or a Space you're not in → the same "This isn't in your Spaces" page.
- `next` is only ever an internal path (`safeNext` in `lib/auth/routes.ts`): no other origins,
  `//host`, `/\host`, `/..//host`, control characters or schemes, and never back into the account
  pages. Tested with each of those.

### Active Space

The Space is the URL (`/abc-construction/...`); `getWorkspace` finds it among the person's active
memberships or returns not-found. For `/`, `homeFor(session, remembered)`:

1. the remembered Space (`hyphy_space`), **only if** they're an active member right now;
2. else their first Business Space; 3. else their Personal Space; 4. else anything they belong to.

A stale or forged cookie simply falls through.

### Caching

App pages read cookies and are rendered per request (`ƒ` in the build). The account pages call
`connection()` in their layout, so which identity is live is decided at request time, never baked
in at build. Supabase's no-store headers are added whenever the session cookies change.

## Pages

| Route              | What it does                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `/sign-in`         | Email + password. Wrong email and wrong password read the same. Unconfirmed accounts are told to confirm. Keeps `next`. |
| `/sign-up`         | Name, email, password → "Check your email" (with Send again). An existing address gets the same answer, on purpose.     |
| `/auth/confirm`    | Route Handler for email links: `token_hash`+`type` (`verifyOtp`) or `code` (PKCE `exchangeCodeForSession`).             |
| `/auth/error`      | Expired / invalid / preview link, with the way on.                                                                      |
| `/forgot-password` | Email → "If there's an account…" (never reveals whether one exists).                                                    |
| `/reset-password`  | New password, from a recovery link's session. No session → "This link has expired".                                     |
| `/welcome`         | After confirming: their Personal Space is ready, check the display name, pick a first thing to do.                      |
| `/{space}/profile` | Real accounts: display name, login email ("Managed by your account"), change password, sign out.                        |
| Profile menu       | Sign out (real accounts). `signOut({ scope: 'local' })`; cookies cleared even if Supabase is unreachable.               |

Errors are mapped from Supabase Auth's error codes to plain sentences in one place
(`lib/auth/errors.ts`); unknown errors say "Something went wrong" in production and include the
code and message in development. Forms: real labels, `autocomplete` for password managers,
show/hide password, 16px inputs on phones, one announced problem tied to its field and focused,
buttons that say "Signing in…" and can't be pressed twice.

A brand-new Personal Space opens on **Welcome to Hyphy** with the six first things to do (PDF,
QR, image, mileage, receipt, Link Page) instead of empty widgets; it becomes the normal Home as soon
as there's anything in it.

## New accounts: profile, Personal Space, membership

`supabase/migrations/20260928000000_real_accounts.sql`:

- **Trigger** `on_auth_user_created` (after insert on `auth.users`) →
  `private.ensure_person(id, email, raw_user_meta_data->>'name')`:
  1. `insert into profiles (id, name, email) … on conflict (id) do nothing` — the name is what
     they typed (control characters removed, 80 characters), else the part of the email before `@`;
  2. `private.ensure_personal_space(id)` — `insert … on conflict (owner_id) where kind = 'personal'
do nothing` into `spaces`, then the owner membership `on conflict (space_id, person_id) do
nothing`.
- **Exactly once.** The primary key, the one-Personal-Space index and the one-membership-per-Space
  key make every step idempotent, including under a race. Repeated sign-ins don't run it at all.
- **Locked down.** The functions are `security definer` with `search_path = ''` and fully
  qualified names, in the `private` schema (not exposed by the Data API, no usage for `anon`,
  `authenticated` or `hyphy_app`), with `EXECUTE` revoked from everyone. There is no RPC to call;
  nobody can bootstrap anyone, themselves included.
- **Seeding** (`hyphy.seeding`, development only) skips it: the Demo world brings its own rows.
- A failing trigger would block sign-ups, so it's tested against a real Supabase Auth server.

Also in that migration: the profile email follows the login email when it changes in Auth and
can't be edited by anyone (so nobody can claim another address to catch its invitations); people
can update only `name, hue, headline, phone, timezone` of their own profile; names are capped at
80 characters; a Personal Space can only ever hold its owner, as owner; and Space addresses can't
take the app's own paths (`sign-in`, `auth`, `welcome`, …).

Demo personas stay as they are: they exist in `auth.users` on the development database (seeded
without passwords, so nobody can sign in as them), and no constraint was added that they'd fail.

## Security summary

- The browser never supplies a person id, role, Space id or membership. The person is the
  verified token's `sub`; roles come from `space_members`; RLS is the boundary.
- No user-scoped client at module scope; one per request.
- Only the publishable key is public, and a secret key there is refused. No secret, service-role
  key or database password is referenced by client code.
- Nothing reads `user_metadata`/`app_metadata` for access.
- Demo Mode's Preview As and Reset refuse unless `HYPHY_IDENTITY` is demo; Reset additionally needs
  `HYPHY_DEMO_RESET=on` **and** a database carrying the development marker. Under real accounts
  the Preview As cookie is ignored (tested).
- Signing out never deletes anything.

## Environment

| Variable                               | Where  | Purpose                                                              |
| -------------------------------------- | ------ | -------------------------------------------------------------------- |
| `HYPHY_IDENTITY`                       | server | `supabase` to switch real accounts on; anything else = Demo Mode     |
| `HYPHY_DATA`                           | server | must be `supabase` with real accounts                                |
| `DATABASE_URL`                         | server | the `hyphy_app` transaction-pooler connection (supabase/README.md)   |
| `NEXT_PUBLIC_SUPABASE_URL`             | public | the project URL                                                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | the `sb_publishable_…` key (never a secret key)                      |
| `HYPHY_SITE_URL`                       | server | origin people use (e.g. `https://hyphy-studio.com`); links in emails |
| `HYPHY_EMAIL`                          | server | `resend` to send invitations (docs/BUSINESS.md, Email); unset = none |
| `RESEND_API_KEY`, `HYPHY_EMAIL_FROM`   | server | the invitation sender, with `HYPHY_EMAIL=resend` — never public      |

Set the `NEXT_PUBLIC_` values at build time as well (Next.js inlines them). None are needed for Demo
Mode.

## Before switching it on

This is a checklist, not something done yet.

1. **Finish the hosted verification.** A Vercel deployment connected to hosted Supabase with
   `HYPHY_DATA=supabase` must be verified end to end first. Real accounts have not been tested on
   hosted Supabase Auth (the development container can't reach it), and file uploads have not
   been tested against hosted Storage's HTTP API (only its policies, in SQL; docs/FILES.md).
2. **Migrations.** Every migration through `20261001010000_file_policy_tuning.sql` (Phase 2D) is
   applied to `hyphy-tools-dev`, and `supabase/tests/accounts.sql`, `teams.sql`,
   `customization.sql` and `files.sql` pass there. A production project gets every migration with
   `supabase db push` — never `supabase/dev/`.
3. **Supabase Auth settings** (dashboard → Authentication):
   - Email provider on, **Confirm email on**, minimum password length **8**, **leaked password
     protection on** (the advisor flags it off today), secure password change as preferred.
   - **Site URL** `https://hyphy-studio.com/platform`; **Redirect URLs**
     `https://hyphy-studio.com/platform/auth/confirm**` (plus preview origins if used).
   - **Email templates** — use token-hash links, which work in any browser and aren't broken by a
     second email to the same browser (found in testing: with the default PKCE links, asking for
     a reset before confirming invalidates the confirmation link):
     - Confirm signup: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`
     - Reset password: `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery`

     `{{ .RedirectTo }}` is the app's own `…/auth/confirm?next=…` (`confirmUrl()` in
     `lib/auth/actions.ts`), so an invited person's sign-up comes back to their invitation rather
     than to Welcome (found in Phase 2D's browser tests on the local stack). It only works while
     `/auth/confirm**` is in the Redirect URLs; otherwise Supabase falls back to the Site URL.

   - Custom SMTP (the built-in sender is rate-limited and only for team addresses).
   - Add `https://hyphy-studio.com/platform/invite/**` to the Redirect URLs: invited people sign up
     with `next=/invite/…` and come back there after confirming.
   - Consider turning off the Data API for `public`: the app never uses it, and with real JWTs in
     people's browsers it's a second door (RLS still guards it — the same policies apply).
4. **Vercel (Hyphy Tools project only):** `HYPHY_IDENTITY=supabase`, `HYPHY_DATA=supabase`,
   `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `HYPHY_SITE_URL`, and for invitation email `HYPHY_EMAIL=resend`, `RESEND_API_KEY`,
   `HYPHY_EMAIL_FROM` (a verified sending domain). Preview first.
5. Run `npm run test:auth` against that environment's Auth (a development project only).
6. Remove Demo Mode from that deployment (DEMO-MODE.md, "Removing it").

## Testing

| Suite                                      | What it covers                                                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit.spec.ts`                       | mode selection, publishable-key check, `safeNext`, public paths, remembered-Space validation, error map                                                                                                                    |
| `supabase/tests/accounts.sql`              | bootstrap once/idempotent, nobody bootstraps or edits anyone else, Personal Space sealed, personas untouched                                                                                                               |
| `tests/data.spec.ts` › real accounts       | the SQL suite, a new account's session and repository (empty, itself only), renaming                                                                                                                                       |
| `tests/auth.spec.ts` (`npm run test:auth`) | real Supabase Auth: sign-up → email → confirm → Welcome; sign-in errors; persistence; sign out; recovery via token-hash link; used/invalid links; forged cookie; open-redirect attempts; no demo data; Demo controls inert |

`test:auth` needs a Supabase Auth server, a database with the migrations and a mail catcher. It
was run against Supabase Auth (GoTrue) v2.186.0 with ES256 signing keys, local Postgres 16 and
Mailpit, all in containers on the development machine:

```sh
# Postgres with the Supabase roles, an `auth` schema owned by supabase_auth_admin, then GoTrue
# (image ghcr.io/supabase/gotrue) against it, fronted at /auth/v1, SMTP to Mailpit (:1025).
# Then: the grants from supabase/tests/prelude.sql (not its auth stand-ins), every migration,
# and `alter role hyphy_app login password '…'`.
AUTH_E2E_SUPABASE_URL=http://localhost:54321 AUTH_E2E_PUBLISHABLE_KEY=sb_publishable_local \
AUTH_E2E_DATABASE_URL=postgres://hyphy_app:…@localhost:54322/hyphy_auth \
AUTH_E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:54322/hyphy_auth \
AUTH_E2E_MAILPIT_URL=http://localhost:8025 npm run test:auth
```

`test:auth` also runs `tests/business.spec.ts` (Phase 2B), with the app's invitation emails
captured to `.hyphy-mail/e2e` (`HYPHY_EMAIL=capture`). It creates only
`…auth-test@hyphy-tools.example` accounts and deletes them (and their businesses) afterwards. Without
those variables it skips.

## Later

**Invitations — built in Phase 2B** (docs/BUSINESS.md). Invitations are their own table, not
memberships and not Auth users: accepting needs a signed-in person whose _confirmed_ Auth email is
the invited one, so an invitation can never reserve or impersonate an address. `invite_member` (the
placeholder that created `auth.users` rows) now refuses outside the development database.

**Account deletion (not built).** Deleting must be deliberate, never a raw `delete from
auth.users`: Business Spaces they own need an ownership transfer or closure; their Personal Space
and its files are deleted; memberships elsewhere removed while records they created in others'
Spaces stay attributed (today `created_by` would block the delete); stored files purged;
billing cancelled. Build it as a guarded server flow with a grace period.

**Also later:** email change (Profile shows the login email as managed by the account), OAuth
providers and magic links (the confirm route already handles `token_hash` types and PKCE codes),
avatars, MFA. (File bytes are stored since Phase 2D, docs/FILES.md; deleting an account must
also delete its Personal Space's stored files.)
