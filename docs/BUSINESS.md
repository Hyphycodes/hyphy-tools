# Businesses, teams and invitations

Phase 2B. A real person can create a Business, bring people into it and run it together. It works
with real accounts (`HYPHY_IDENTITY=supabase`) and is **built and tested but not switched on**:
Demo Mode stays the default until the hosted Vercel → Supabase check is done (docs/AUTH.md).

One person, one account, many Spaces. Nobody gets an employee login, a business login or a second
app: a person is a person, and each Space they belong to is a membership with a role.

```
Jerry ── Personal ............ owner   (made with the account, always his)
      ├─ Hyphy LLC ........... owner
      ├─ Oasis ............... manager
      └─ ABC Construction .... guest
```

## Creating a Business

`/create-business` — from the Space switcher, the profile menu, Welcome and Profile. One form, one
server action (`lib/business/actions.ts`), one database function (`public.create_business`):

| Field         | Notes                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| Business name | Required, up to 80 characters.                                                                           |
| Kind          | Eight choices (`lib/platform/business-types.ts`). Sets starting words and tools; changeable in Settings. |
| Address       | Made from the name (`ABC Construction` → `abc-construction`). Taken → `-2`, `-3`… unless they typed it.  |

In one transaction it creates the Space (`kind = business`, the type's work style, words and
tools, a mark from the name, plan `business-pro` while billing is off) and the creator's
**owner** membership. A request key made when the form opens makes it retry-safe: a double
submit, a retried request or two submits racing return the same Business (tested with parallel
connections). Addresses the app uses (`sign-in`, `invite`, `create-business`, `welcome`, …) are
refused by a database check. An owner can have up to 25 businesses.

Not asked: size, revenue, tax ID, billing, custom fields, vehicles. Those come later, if at all.

### Kinds → starting setup

| Kind                            | Projects called | Tools on (plus People and Files, always)        |
| ------------------------------- | --------------- | ----------------------------------------------- |
| Construction / Trades           | Jobs            | Projects, Vehicles, Receipts, Mileage, QR       |
| Restaurant / Hospitality        | Events          | Projects, Receipts, QR, Link Pages              |
| Real Estate                     | Properties      | Projects, Mileage, PDF, Images, QR, Link Pages  |
| Creative / Agency               | Projects        | Projects, PDF, Images, QR, Link Pages, Receipts |
| Transportation / Field Services | Jobs            | Projects, Vehicles, Mileage, Receipts           |
| Professional Services           | Projects        | Projects, PDF, Receipts, Mileage                |
| Retail                          | —               | Receipts, QR, Link Pages, Images, PDF           |
| Something else                  | Projects        | Projects, Receipts, QR, PDF                     |

One Projects module underneath; the words come from `spaces.labels` and the work style
(`lib/platform/work.ts`). No per-industry tables.

### Setup, then Home

After creating it, the owner lands on `/{business}/setup`: the business's tools (already set from
its kind — the same toggles as Settings), then **Invite your team** (email + role, as many as they
like), then Finish or Skip. Until setup is finished the owner's Home shows a "Finish setting up"
line. A new business's Home (for owners and admins) shows first steps instead of empty panels —
Create your first job, Invite your team, Add a vehicle, Upload a file, Create a QR code, Save a
receipt — each only if its tool is on and the role allows it. Members and guests always get their
own role's Home. No invented activity.

### Settings

Business details: name, kind, what projects are called (one / several), and the mark (a logo
placeholder until file storage exists). **The address never changes**: links, bookmarks and
invitations keep working, and records refer to the Space by id, so a new name shows everywhere at
once. (Address changes with redirects can come later if there's a real need.)

## Invitations

An invitation is **not** a membership. It is an email address, the role it will grant, and a link.

| Column                                                                                          | Meaning                                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `email`                                                                                         | lowercased and trimmed                                               |
| `role`, `title`, `project_ids`                                                                  | what they'll get (never owner)                                       |
| `status`                                                                                        | `pending` · `accepted` · `revoked` (expired = pending past its date) |
| `token_hash`                                                                                    | SHA-256 of the link's secret — the secret itself is never stored     |
| `invited_by`, `created_at`, `sent_at`, `expires_at` (7 days), `accepted_at/by`, `revoked_at/by` |                                                                      |

At most one pending invitation per address per business (a unique index).

**The link.** `…/platform/invite/{secret}` — 32 random bytes from the server, base64url. It is
unguessable, single-purpose, expiring and replaceable, and it **locates** an invitation; it never
proves who you are. The page sets `Referrer-Policy: no-referrer`. Nothing logs it.

**Accepting** (`public.accept_invitation`) needs all of:

1. a signed-in person (`auth.uid()`, from the verified session),
2. whose **confirmed** Supabase Auth email (`auth.users.email` with `email_confirmed_at`) equals
   the invited address — never the profile email, never anything the browser sends,
3. a link that still exists, isn't revoked, isn't used and hasn't expired,
4. an explicit Accept.

Then, in one transaction with the invitation row locked: the membership is created (or a former
member's comes back) with the invitation's role, and the invitation is marked accepted by them.
Twice, or twice at once: one membership, and the second answer is "already part of it". Someone
already a member: nothing changes, the invitation is used up. After acceptance the membership
belongs to the person's id — changing their email later changes nothing.

**The landing page** (`/invite/{secret}`) explains itself in every state:

| State                        | What they see                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Signed out                   | "Jo invited you to ABC Construction", role, address; Create account / Sign in |
| Signed in as the invited one | "Join ABC Construction?" — Accept invite / Not now                            |
| Signed in as someone else    | "This invitation is for another account" — sign in as the invited address     |
| Already a member             | "You're already part of ABC Construction" — Open                              |
| Expired / revoked / used     | Plain words and what to do ("Ask the business to send a new one")             |

Create account keeps the invitation: the address is filled in, and `next=/invite/{secret}` goes
through sign-up, the confirmation email and back.

**Managing invitations** (People → Invited; owners and admins):

- **Resend**: a new secret, emailed; the old link stops working immediately; the expiry restarts.
  Limited to one a minute. The same row — never a second pending invitation.
- **Copy a new link**: the same, without email, for sharing by hand (or when email isn't set up).
- **Join as**: change the role before they accept.
- **Revoke**: the link stops working; invite again any time.
- The email can't be edited: revoke and invite again.

**Races** (tested with parallel connections): two acceptances at once → one membership; revoke vs
accept → exactly one wins; resend vs accept with the old link → the old link works only if it got
there first; a role changed before acceptance is the role they get.

## Roles

| Role    | In plain words                                                   | Team powers                                                    |
| ------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Owner   | Controls the business, including its plan and who owns it.       | Everything; the only one who adds or changes admins; transfers |
| Admin   | Can help manage the business and its team.                       | Invite and manage managers, members and guests                 |
| Manager | Can manage day-to-day work and approvals.                        | None over people                                               |
| Member  | Can submit and work with the business information they're given. | None                                                           |
| Guest   | Limited access to the projects and information shared with them. | None                                                           |

`lib/platform/roles.ts` (`grantableRoles`, `canManageMember`) decides what the interface offers;
the database decides again (`private.check_grantable`) for every invitation and role change.
Nobody can invite an owner, change their own role, or touch the owner's membership.

## People

People shows **Active** members and **Invited** people together ("6 active members · 2 invited"),
with a chip for each role and for Invited. Each person: name, role, what they're working on now,
their vehicle, and what's waiting on the approver. Operational, not HR.

A person's page adds **Role & access** for owners and admins: change the role, **Remove from
business**, and — for the owner — **Transfer ownership**.

- **Removing** someone marks the membership `removed` (with who and when). They lose access on
  the next request. Their account and Personal Space are untouched; everything they made stays in
  the business with their name on it (names still resolve through the directory). They can be
  invited back.
- **Leaving** (Profile → Your Spaces → Leave) is the same, by the person themselves. The owner
  can't leave without transferring first.

## Ownership

Every Business has **exactly one owner**, always — a deferred constraint trigger checks it at the
end of every transaction, whatever changed memberships.

**Transfer** (`public.transfer_ownership`) is its own step, never a role dropdown: only the owner,
only to an active member who isn't a guest, and they type the business's name to confirm. The
target becomes owner and the previous owner becomes an admin, in one transaction. Admins can't
take ownership, transfer it, or remove or demote the owner.

## How the database protects it

- Memberships are no longer written directly by anyone: every change goes through a checked
  function (`create_business`, `accept_invitation`, `set_member_role`, `remove_member`,
  `leave_space`, `transfer_ownership`), each `security definer` with an empty search path,
  identifying the caller by `auth.uid()` only.
- Invitations are readable only by people who manage that business's team, never including the
  link's hash, and are never written directly.
- **A current membership is required for every Space-owned row** — a restrictive policy on
  projects, vehicles, receipts, mileage, files, codes, link pages, activity, inbox, approval
  history and pins. Before this, "your own receipts", "projects you're on" and "your own activity"
  didn't check membership, so a removed member could still read them by id. Now they can't.
- A Personal Space holds only its owner. The development-only placeholder invitation refuses
  outside the development world.

`supabase/tests/teams.sql` (11 groups) attacks all of it; `tests/data.spec.ts` adds the races.

## Email

`lib/email` is one small interface; membership code never knows who delivers.

| `HYPHY_EMAIL`           | What happens                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `capture` (dev default) | Written to `HYPHY_MAIL_DIR` (default `.hyphy-mail/`) as `.html` + `.json`: the preview |
| `resend`                | Sent through Resend (`RESEND_API_KEY`, `HYPHY_EMAIL_FROM`) — built, **not yet tested** |
| unset in production     | Nothing is sent; the invitation still exists and its link can be copied from People    |

The invitation email (`lib/email/invitation.ts`): "Join ABC Construction", who invited them, the
role in plain words, an optional note, one button, the address it's for and how long it works; a
plain-text twin; every value escaped. A failed send never undoes the invitation.

## Demo Mode

Demo Mode is unchanged and still the default. Its businesses, people and roles are the seeded
story. There:

- `/create-business` and invitation links open as previews that say real accounts are needed.
- Inviting still adds the demo's fictional "invited" person (in this browser, or on the development
  database through `invite_member`), shown under Invited.
- Changing roles, removing, resending, revoking and transferring say they work with real accounts.

Real-account tables never receive demo personas: the development personas can't accept real
invitations (their Auth rows have no confirmed email), and the real team code only runs for
real sessions (`lib/teams/index.ts`).

## Testing

| Suite                                  | Covers                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/teams.sql`             | creation, invitations, acceptance rules, expiry/revoke/resend, who may do what, removal, ownership, isolation                                                                                                  |
| `tests/data.spec.ts` › under pressure  | concurrent create, accept×3, revoke vs accept, resend vs accept, role before accept, removal                                                                                                                   |
| `tests/unit.spec.ts`                   | kinds and presets, addresses, roles, the email (and its escaping), provider choice                                                                                                                             |
| `tests/business.spec.ts` (`test:auth`) | the whole journey with real Supabase Auth: create → invite → sign up from the link → confirm → accept → member Home → manager → remove; resend, revoke, expiry, wrong account; transfer; two sealed businesses |
| `tests/app.spec.ts`                    | Demo Mode: the new pages are previews; the demo team explains itself                                                                                                                                           |

## Later

- **Business customization** (Phase 2C): custom fields, richer terminology, approval settings.
- Address changes with redirects; logo upload (with Storage); closing a business (it must have a
  plan for its records and members); ownership among several owners, if ever needed.
- Account deletion must first transfer or close owned businesses (the one-owner rule already
  refuses a delete that would leave one ownerless).
