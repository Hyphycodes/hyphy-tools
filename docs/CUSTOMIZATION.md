# Business customization

Phase 2C. Each business makes Hyphy its own: the words it uses, the tools it has on, what it tracks
on its jobs, receipts, trips, vehicles and people, the rules those follow, and who approves. The
product stays recognizable. This is a short list of choices written in plain language, not a
database builder.

Everything here works in Demo Mode, on the development database (`HYPHY_DATA=supabase`), and with
real accounts once they are switched on (docs/AUTH.md).

## Where it lives

**Settings → Business settings** (`/{business}/settings`), for owners and admins. Managers use the
result but don't change it; members and guests never see it.

| Section     | Route                 | Holds                                                                                   |
| ----------- | --------------------- | --------------------------------------------------------------------------------------- |
| Overview    | `/settings`           | A summary card per area, the Tools switches, plan, people & roles, recent setup changes |
| Basics      | `/settings/basics`    | Name, kind of business, words, accent color, mark (logo placeholder)                    |
| Jobs (Work) | `/settings/work`      | Fields on each project, under whatever the business calls its projects                  |
| Receipts    | `/settings/receipts`  | Receipt rules, receipt fields, a live preview of the employee's form                    |
| Mileage     | `/settings/mileage`   | Rate, trip rules, trip fields, a live preview                                           |
| Vehicles    | `/settings/vehicles`  | Vehicle fields (called Trucks, Units… per the business's word)                          |
| People      | `/settings/people`    | Per-person facts for this business (crew, certifications)                               |
| Approvals   | `/settings/approvals` | Who approves; the receipt and trip approval rules in one place                          |

A section appears only when its tool is on. Each page leads with what is true now ("Every receipt
needs a job · 1 required field"), and details open when asked. Nothing saves until **Save**, except
the accent color, which saves as soon as it's picked and is as easy to change back.

## Configuration architecture

One business's setup lives in three places. Each piece goes where its shape and its protection fit:

| What                                              | Where                                                                                                        | Why there                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Name, kind, words, accent, tools on, mileage rate | Columns on `spaces` (`name`, `business_type`, `labels`, `brand`, `modules`, `mileage_rate`, `work_style`)    | Read on every page by everyone in the business. Already there and already protected |
| Rules: receipts, mileage, approvals               | `space_settings`: one validated JSON document per business                                                   | A small, closed set of choices that grows. Guests can't read it                     |
| Field definitions                                 | `custom_fields`: one row per field, keyed `(space_id, applies_to, key)`                                      | Fields have a lifecycle (order, archive, in-use checks) that needs rows             |
| Answers                                           | `custom jsonb` on the record itself (`projects`, `vehicles`, `receipts`, `mileage_entries`, `space_members`) | See below                                                                           |

**Why answers live on the record.** An answer belongs to its record: whoever can read the receipt
can read its Cost Code, and nobody else can. Keeping answers on the row means Row Level Security
covers them with no new policy, an export or detail page needs no join, and a removed record takes
its answers with it. The alternative, a separate "values" table with one row per answer, would need
its own access rules copied from every record type, a join per record per field, and it drifts. What
we give up: answers can't be indexed per field. GIN indexes on each `custom` column cover "which
records use this field" (the in-use checks) and containment search. With at most 20 fields per record
type, that is enough.

**Validated, not free-form.** `space_settings.settings` accepts only known keys with known types
(`private.check_space_settings`). Field definitions are checked by `private.guard_custom_field`.
Answers are checked against the field definitions by `private.guard_custom_values` on every insert
and update. The same rules exist in TypeScript (`lib/platform/business-settings.ts`,
`lib/platform/custom-fields.ts`) for the forms and server actions. The database checks again because
the UI is only presentation.

**One engine.** There is no second configuration system. Tools stay the registry
(`lib/platform/tools.ts`), words stay `spaces.labels` (now with `customer` and `vehicles` beside
`projects`), and the work profile (`lib/platform/work.ts`) and `vehicleWords()` read them. The
Phase 1 `spaces.custom_fields` JSON moved into `custom_fields` rows in the same migration, keeping
the same keys, so answers already saved keep their meaning.

## Basics

- **Name.** Changes everywhere at once. The address never changes (links keep working).
- **Kind of business.** See "Presets" below. Changing it never quietly rewrites anything.
- **Words** (`lib/platform/terms.ts`), each from a short list:
  - What you call your work: Projects, Jobs, Properties, Events, Engagements, Cases
  - Who the work is for: Customer, Client, Host, Guest
  - What you call vehicles: Vehicles, Trucks, Units, Vans

  They change the menu, page titles, buttons ("Add truck"), forms, empty states and search. Records
  stay as they are. Free-typed words aren't offered, so the product stays recognizable and nothing
  can be renamed to something confusing.

- **Accent color** (`lib/platform/brand.ts`): nine curated colors, each paired with an ink that
  clears 4.5:1 (tested). It marks the business: its mark in the Space switcher and header, the
  default color of its QR codes (darkened until a phone can scan it), and the default for new link
  pages. It never re-themes the product. A color from before this list stays until someone picks
  another.
- **Logo.** Owners and admins upload one (PNG, JPG or WebP, 2 MB) in Settings; it replaces the
  initials in the Space switcher and header for everyone in the business (docs/FILES.md).

## Tools

Settings' Tools switches are the existing module list (`spaces.modules`). Turning a tool off:

- hides it from the menu, Create, the dashboards, suggestions, search and its settings section,
- stops new records of that kind (server actions check `requireTool`),
- **deletes nothing**. Turn it back on and every record is where it was.

People and Files are always on. They are how a business works at all ("Always on: every business
has people and files").

## Custom fields

"What else does your company track?" One engine (`lib/platform/custom-fields.ts`) serves every
record type.

| Applies to | Seen on                                                      |
| ---------- | ------------------------------------------------------------ |
| Projects   | Create form, project page (Details), projects list, search   |
| Receipts   | Receipt form, receipt detail, Inbox approval card, list, CSV |
| Mileage    | Trip form, trip detail, Inbox approval card, list, CSV       |
| Vehicles   | Add vehicle form, vehicle page, vehicles list, search        |
| People     | The person's page (set by owners and admins)                 |

**Kinds** (the only ones): Text, Number, Money, Date, Yes/No, Dropdown, Person, Project (in the
business's word), Vehicle. File fields exist in the Phase 1 data but can't be created yet (files
attach to records instead, docs/FILES.md). No formulas, rollups, lookups, conditional logic or per-field permissions.

**A definition** has: key (made from the label, stable forever), business, record type, label,
kind, choices (dropdowns), help line, required, position, "show in lists", archived at, created by
and when. Limits: 20 active fields per record type, 50 choices, 200 characters of text.

**Lifecycle**, enforced in both TypeScript and the database:

| Change                           | Before any record has an answer | Once answers exist                                                       |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Rename, help, required, in lists | Yes                             | Yes. Required applies to new and resent records, not history             |
| Change the kind                  | Yes                             | **No.** "Cost Code already has answers saved, so its kind can’t change." |
| Dropdown choices                 | Anything                        | **Add only.** Used choices stay                                          |
| Reorder                          | Move up / move down             | Same                                                                     |
| Remove                           | **Delete**                      | **Stop using**: hidden from forms, answers kept and still shown          |
| Bring back                       | —                               | Yes, with its answers                                                    |

**Answers are checked**: the value must match the kind (a number is a number, a dropdown answer is
one of its choices), and a reference must point at something in this business that the person can
see (a Vehicle field can't name a truck you can't see, and a Person field can't name someone from
another business). Unknown keys and answers to stopped fields are refused. Required fields are
required when a record is submitted. Drafts may be unfinished. A required Project or Vehicle field
isn't enforced while that tool is off.

**Access is inherited.** A field's answers are exactly as visible as the record. Guests see project
fields (on the projects shared with them) and nothing else, not even that receipt fields exist.

**Display.** Detail pages show answers as facts, formatted ("$1,250.00", "Yes", a person's name,
a linked project). Lists show at most a few fields marked "show in lists" in the row's second line.
Search matches text and dropdown answers (Job Number "24-184" finds the job). Receipts and
Mileage CSV exports add one column per field, including stopped ones that have answers.

## Presets

Choosing a kind of business gives a starting setup: words, tools, suggested fields (all optional to
start) and a few rules. Rules are only a starting point. The owner can change everything afterwards.

| Kind                            | Words                   | Suggested fields                                                                     | Rules                   |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| Construction / Trades           | Jobs · Customer         | Job: Job Number (in lists), Foreman. Receipt: Cost Code (100/200/300), Reimbursable? | A job on every receipt  |
| Restaurant / Hospitality        | Events · Client         | Event: Room, Host, Expected Guests. Receipt: Department                              | —                       |
| Real Estate                     | Properties · Client     | Property: MLS Number, Property Type, Agent                                           | A purpose on every trip |
| Creative / Agency               | Projects                | Project: Engagement. Receipt: Bill to client?                                        | —                       |
| Transportation / Field Services | Jobs · Customer · Units | Job: Work Order #. Unit: Inspection Date. Receipt: Reimbursable?                     | A job on every trip     |
| Professional Services           | Engagements · Client    | Engagement: Reference #. Receipt: Bill to client?                                    | A purpose on every trip |
| Retail                          | —                       | Receipt: Department                                                                  | —                       |
| Something else                  | Projects                | —                                                                                    | —                       |

No preset sets a mileage rate. That rate is the business's decision (see Mileage).

- **New business** (`lib/business/index.ts`): the preset's rules and fields are created in the same
  transaction as the business, only for tools that are on.
- **Existing businesses are never overwritten.** The seeded demo businesses keep exactly their
  setup. There is no migration that "applies presets".
- **Changing the kind** asks **"Update recommended setup?"** and lists what the new kind would add
  (tools to turn on, fields to add, words to use, and — when the new kind runs projects
  differently — how, e.g. "Run them as events: each on its day, with a room and a host, no
  progress"), then offers **Keep my current setup** or **Apply recommended additions**. Applying
  only adds: no tool is turned off, no field is archived or changed, no answer, rule or record is
  touched. Fields whose key or name already exists are skipped.

## Receipts

`/settings/receipts`. The rules (defaults = how Phase 1 behaved):

| Rule                          | Default       | Notes                                                                                                              |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| A job on every receipt        | Optional      | Only while Projects is on, and only for people who can see a job to pick                                           |
| A vehicle on every receipt    | Optional      | Only for people who have a vehicle to pick                                                                         |
| A photo of the receipt        | Optional      | Required: every submitted receipt needs a finished photo or PDF of the submitter's own; drafts may wait (FILES.md) |
| Personal expenses (paid back) | Allowed       | Off: the "Personal card (reimburse me)" payment disappears, and the server and database refuse it                  |
| Default category              | None          | Pre-selects the category on a new receipt                                                                          |
| Approval                      | Every receipt | Every receipt · Only over an amount · Not needed                                                                   |
| Receipt fields                | —             | As above                                                                                                           |

**The form assembles itself** from these rules (`formRules()`): required things are marked required,
turned-off things aren't asked, the order is always amount → vendor → date → category → job →
vehicle → payment → the business's fields → notes. A live preview on the settings page shows the
exact form an employee will see.

## Mileage

`/settings/mileage`:

- **What you pay back per mile.** The business's own rate, from $0.01 to $5.00, or empty to track
  miles without paying them back. Hyphy never assumes the IRS or any tax rate. The form shows it
  ("$8.04 back at $0.67 a mile").
- **Each trip keeps the rate it was logged at.** `mileage_entries.rate` is stamped by the database
  when a trip is logged (`private.stamp_mileage_rate`; 0 if the business wasn't paying miles back
  then). Nobody can set or change it, and a new rate never re-prices old trips. Payback everywhere
  (the trip, Mileage, its CSV, project costs, the weekly summary) is miles × the trip's own rate
  (`paidBack()` in `lib/insights.ts`). Trips logged before this existed were given the business's
  rate at the time of the migration.
- **Trips in personal vehicles**: allowed (paid back) or not (company vehicles only).
- **A job on every trip**: optional or required (only asked of people who can see a job to pick).
- **What the trip was for**: optional or required.
- **Round trip** stays on the form as before.
- **Approval**: every trip, or not needed.
- **Trip fields**, as above.

## Approvals

Lightweight on purpose: on or off, who, and for receipts an optional amount.

- **Receipts need approval**: every receipt · only over an amount (e.g. "Receipts over $250") ·
  not needed.
- **Trips need approval**: every trip · not needed.
- **Who approves**: "Owners, admins and managers" (default) or "Only owners and admins".

What doesn't need approval is **filed** immediately as approved with no reviewer ("Filed — no
approval needed" on its timeline). Nobody approved it, so nobody's name is on it. When a rule
changes, items already waiting still wait. Returned items that are resent follow the rules at that
moment.

**Protections that don't move:**

- Nobody approves their own submission, whatever the rules. That includes a submission filed as
  approved with themselves, or anyone else, as reviewer (`guard_review`, the insert and update
  policies, `public.needs_approval`).
- "Only owners and admins" is enforced in the database: `public.can(space, 'expenses.approve')` is
  false for managers then, so a manager's direct update is refused, not only hidden.
- A decided item can't be re-decided. History in `approval_events` is still written only by triggers.

## Employee experience

Mike (a member) sees shorter forms: required things first and marked, turned-off things gone,
defaults filled in, the business's fields in its words, and plain messages when something's missing
("Cost Code is required.", "Choose the job this receipt is for."). He sees no settings, no field
editor and no rules page. What he submits under an approval threshold shows "Filed". Anything else
shows "Waiting for approval".

## Owner experience

Dana (owner) and Luis (admin) configure. Every section has a one-line summary, a Save bar that says
what changed and can undo it, and previews. Ray (manager) approves (unless only owners and admins do)
but can't change setup. The server refuses him (`space.manage`), and so does the database.

**Setup activity.** Important changes write one line to the business's activity: a field added,
stopped, brought back or made required/optional, receipt rules, mileage rules, who approves, the
mileage rate ("$0.70 a mile"), words, kind of business, tools turned on/off. Renames, reordering, help text
and accent color don't, to keep the feed free of noise. The Overview shows the latest as "Recent
setup changes".

## Validation, everywhere

| Layer         | What it checks                                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form          | Required answers, kinds, choices; turns off what the business turned off                                                                                                           |
| Server action | `requirePermission` (`space.manage` to configure; record permissions to answer), `requireTool`, `checkValues`, `submissionProblem`, `parseSettings`, `definitionProblem`           |
| Database      | `check_space_settings`, `guard_custom_field`, `guard_custom_values` (+ `validate_custom`), `check_submission_rules`, `check_space_identity`, `spaces_mileage_rate_range`, policies |

Attacks tested (`supabase/tests/customization.sql`, `tests/data.spec.ts`): another business's
fields, answers of the wrong kind, made-up choices, unknown keys, references into other businesses
or to things the person can't see, answers to stopped fields, members/managers/guests changing
setup, removing a used field, changing a used field's kind, taking away used choices, duplicate
names, unknown settings, negative amounts, self-approval under every rule, a manager approving
when only owners and admins do, choosing or changing a trip's rate, a removed member reading setup,
`anon`.

## No history is rewritten

Settings aren't versioned, but no change corrupts history:

- Stopping a field keeps its answers, which stay visible (and exported) on the records that have them.
- A new required field or rule applies to what's submitted from now on. Items already submitted
  or approved aren't re-judged (an old receipt can still be approved).
- Kinds and used choices can't change under saved answers.
- Every trip keeps the per-mile rate it was logged at.
- Turning a tool off hides; it never deletes.

## Performance

- Field definitions and rules are read once per request with the Space (`space_settings` is joined
  into the session query; `custom_fields` is one query with the other rows), never per record.
- Answers come with their records: no extra query per row, per field or per list.
- Reference checks run against rows already loaded for the request.
- GIN indexes on each `custom` column serve the in-use checks.

## Demo Mode

Business setup in Demo Mode is kept in its own cookie (`hyphy_demo_config`, compressed, one cookie,
`src/lib/data/demo/config.ts`), separate from the record journal so it never ages out. It holds
changes to spaces (words, accent, tools, rate, rules), field definitions and the recent setup log.
If a setup ever gets too big for the cookie, the change is refused with a plain message rather than
half-kept. **Reset** restores the canonical setup.

Because every persona in the browser reads the same cookie, the Phase 2C walk-through works as
it should: preview as **Dana** → add a required Cost Code → switch to **Mike** → his receipt form
asks for it immediately. See docs/DEMO-MODE.md.

## Where the code is

| Path                                                            | What                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/platform/business-settings.ts`                         | Rules: types, defaults, parsing, `needsApproval`, `formRules`, `submissionProblem`    |
| `src/lib/platform/custom-fields.ts`                             | The field engine: kinds, definitions, lifecycle, checking, formatting, export, search |
| `src/lib/platform/business-types.ts`                            | Presets and `presetAdditions` (what a new kind would add)                             |
| `src/lib/platform/terms.ts`, `brand.ts`                         | Words; accents and contrast                                                           |
| `src/app/(app)/[space]/actions.ts`                              | Every setup and form action (validated server-side)                                   |
| `src/app/(app)/[space]/settings/`                               | The settings pages; `load.ts` gathers what they need                                  |
| `src/components/settings/`                                      | Rules, field editor, previews, basics, approvers                                      |
| `src/components/fields/`                                        | Field inputs in forms, facts on detail pages, the "Edit details" sheet                |
| `src/lib/data/demo/config*.ts`                                  | Demo Mode's setup cookie                                                              |
| `supabase/migrations/20260930000000_business_customization.sql` | Tables, checks, triggers, policies                                                    |
| `supabase/migrations/20260930010000_mileage_rate_snapshot.sql`  | Each trip keeps the rate it was logged at                                             |
| `supabase/migrations/20260930020000_setup_rule_fixes.sql`       | The job rule asks only people with a job to pick; words and accent checked apart      |
| `supabase/tests/customization.sql`                              | 86 database checks, always rolled back                                                |
