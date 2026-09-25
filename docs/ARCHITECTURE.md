# Architecture

Hyphy Tools is one product for people and the businesses they work in. Everything below serves
one idea: **a person has one identity; what they see depends on the Space they're in.**

## The model

| Concept        | Where                          | Decides                                                       |
| -------------- | ------------------------------ | ------------------------------------------------------------- |
| **Person**     | `Person` (`profiles`)          | Who you are. The same everywhere.                             |
| **Space**      | `Space` (`spaces`)             | Personal or business. Owns every record.                      |
| **Membership** | `Membership` (`space_members`) | Joins a person to a Space with a role and a job title.        |
| **Role**       | `lib/platform/roles.ts`        | What _you_ can do here: owner, admin, manager, member, guest. |
| **Plan**       | `lib/platform/plans.ts`        | What _this Space_ can turn on: Free … Business Pro.           |
| **Modules**    | `space.modules`                | What _is_ on in this Space right now.                         |

Role, plan and modules are separate on purpose. Changing a plan never changes anyone's role;
turning a tool off never downgrades a plan. `availability()` in `lib/platform/tools.ts` asks the
questions in order — does the tool exist yet, does it belong in this kind of Space, does the plan
include it, is it on here, does this role allow it — and returns the honest reason when the answer
is no. The Tools library shows those reasons ("Included with Business Pro", "Off in ABC
Construction", "Not part of your role").

Every record (`projects`, `vehicles`, `receipts`, `mileage`, `files`, `qrCodes`, `linkPages`,
`activity`, `inbox`) carries `spaceId` and `createdBy`. The term is **Space** everywhere — the
URL, the code (`space_id`) and the interface.

Jerry demonstrates the model: Owner of his Personal Space and Hyphy LLC, Manager at Salt &
Ember, Guest at ABC Construction (Hyphy is building their website).

## Layers

```
app/(app)/[space]/…      pages (server components) and actions.ts (server actions)
        │  requireWorkspace(slug) → Workspace { person, space, membership, permissions }
        │  getRepository(workspace) → Repository (scoped to that Space and person)
        ▼
lib/identity             IdentitySource: demo-source.ts | dev-source.ts (personas on the dev
                         database) | supabase-source.ts (real accounts); mode.ts is the switch
lib/supabase, lib/auth   Supabase Auth clients, the session-refreshing proxy, account actions
lib/business, lib/teams  creating a Business; its team (invitations, roles, removal, ownership):
                         teamFor(workspace) → real (database functions) or Demo Mode's story
lib/email                one EmailProvider (capture | resend | none) and the invitation email
lib/data                 Repository = core.ts (shared rules) over a DataSource:
                           demo/source.ts      seed + journal, visibility in code (demo/visibility.ts)
                           supabase/source.ts  the database, queried as the person; RLS decides
lib/platform             pure rules shared by server and client: roles, plans, registries
components/*             UI; client components read the Workspace through useWorkspace()
```

- **Identity.** `HYPHY_IDENTITY` (`lib/identity/mode.ts`) picks the source: Demo Mode (default)
  or real accounts, where `src/proxy.ts` refreshes and verifies the Supabase Auth session and the
  person is the verified token's `sub` (docs/AUTH.md). `getSession()` returns the person and all
  their memberships. `getWorkspace(slug)`
  picks the membership for the Space in the URL (`/personal` resolves to the viewer's own personal
  Space). Pages 404 when the viewer isn't a member. The client shell receives a serializable
  `ShellModel` built from the Workspace, exposed as `useWorkspace()` — the `currentUser`,
  `currentSpace` and membership abstraction.
- **Data.** `Repository` (`lib/data/repository.ts`) is the only way to read or write. Its contract:
  results only contain this Space's records that this person may see. Everything above the rows —
  approvals, the derived inbox, names, filters — lives once in `core.ts`; a `DataSource` supplies
  the visible rows and applies changes. `HYPHY_DATA` picks the source (`lib/data/index.ts`). The
  demo source applies the visibility rules in code; the Supabase source runs every query in a
  transaction as the person, so `supabase/migrations`' Row Level Security applies them.
  `tests/data.spec.ts` checks both give every persona identical rows.
- **Performance.** One repository per Workspace per request (React `cache`). The Supabase source
  reads each kind of row once per request, scoped to the Space, and everything a render asks for
  in the same tick goes to the database as one statement — one round trip, with the person's
  claims in the same message. A page is 3–5 round trips in total (session, then data and the
  Demo Mode count in parallel); at a 40 ms round trip pages render in ~0.15–0.25 s. Set
  `HYPHY_DB_DEBUG=1` to log statements with timestamps — development only: it also makes failed
  queries' parameters (which can include an invitation link's secret) visible in logged errors.
- **Changes.** Every server action in `actions.ts` resolves the Workspace from the URL, calls
  `requirePermission`, validates input, checks that referenced projects and vehicles are visible,
  and writes through the repository. The UI hides what a role can't do; the server refuses it.

## Registries

Nothing about tools, actions or navigation is scattered across pages.

- **Tools** — `lib/platform/tools.ts`. Each entry: id, module, name, tagline, description, icon,
  color, category, kind (utility / tracker / module), status (Available / Beta / Coming soon),
  Space kinds, permission or roles, tier, best-for, path, highlights, privacy note, origin. The
  sidebar, Tools library, command bar and dashboards read it.
- **Universal Create** — `lib/platform/actions.ts`. Each action names its tool (for availability,
  color and glyph), a label that can vary by perspective ("Scan receipt" / "Submit receipt"), a
  permission and a target (a sheet form or a tool route). `createActionsFor(space, membership)`
  filters and orders them per perspective; `groupActions()` sorts them into Capture, Set up and
  Make for the menu. The + button, the phone's Create sheet, dashboard quick
  actions, `C` and ⌘K all use it; `useCreate().start(id, { attachTo })` opens any action from
  anywhere (a project's "Add expense" is the receipt action attached to that project).
- **Navigation** — `lib/platform/navigation.ts` builds nav from module readiness and permissions.
- **Dashboards** — `lib/platform/dashboard.ts`. Widgets declare when they apply and where
  (`top`, `main`, `side`); a role's dashboard is simply the widgets that apply. There are no
  per-person dashboards. Each perspective answers one question first: Personal “what can I do
  right now?” (a launcher of tools with what's in them), members “what do I need to do?” (big
  actions, their project, their submissions), operators “what needs me and how are we doing?”
  (a pulse, then attention, projects and what happened), guests “what's shared with me?”.
  `currentProjectFor()` in `lib/insights.ts` decides what someone is working on, so the
  dashboard, their profile and new receipts and trips always agree.

## Connected records (Phase 1.75)

Capture once, connect everywhere: a record carries ids (`createdBy`, `projectId`, `vehicleId`,
`attachedTo`, `linkPageId`), never copies of names, so a trip Mike logs on Oak Brook in Truck 24
shows up on his profile, the project, the truck, Mileage, Dana's queue and the weekly summary
without anyone filing it twice. The repository resolves labels on activity and inbox items from
the live records, so a rename follows everywhere.

- **Approvals** — `lib/platform/approvals.ts`. Every submission carries one `Review` shape
  (`status`, `reviewedBy`, `reviewedAt`, `returnReason`, `resubmittedAt`). `Submission` normalizes
  receipts and trips (future kinds — form entries, expense reports — add a `submissionKinds`
  entry). Lifecycle: draft → submitted → approved, or returned with an optional reason → edited
  and resubmitted by the submitter. Batch approval exists; bulk return deliberately doesn't. The
  server refuses deciding your own submission or one already decided (`RuleError`).
- **Inbox** — approvals, returned items and unfinished drafts are **derived** from the records
  (`repo.inbox()`), not stored, so a decision can't leave a stale row. Stored items are
  notifications (documents, access requests, mentions). `lib/platform/inbox.ts` gives look and
  grouping (To fix, Approvals, Documents, People, Mentions). `?from=personId` filters the queue.
- **Work styles** — `space.workStyle` (`jobs`, `events`, `engagements`) and `lib/platform/work.ts`:
  one Projects module; the profile decides words (Events, Room, Host), schedule (due vs. on a
  day), whether progress means anything, and what the customer's money is called.
- **Project money** — `value` (contract/booking), optional `costAllowance` (an internal target,
  only where the business set one), and tracked costs computed by `projectMoney()` in
  `lib/insights.ts`: receipts plus personal-vehicle miles × `space.mileageRate`. Never shown as
  the job's full cost.
- **Pins** — `repo.pins()` / `setPinned()`: a person's tools and projects in one Space. Home,
  the sidebar and project lists read them.
- **Owner views** — `exceptionsFor()` (plain rules: unassigned receipts, personal-vehicle trips by
  someone with a truck, expiring documents, allowances ≥85%, returns waiting) and
  `weekSummary()` (a preview card; nothing is emailed). `toolUsage()` orders Personal Home by
  what someone actually made.
- **Relationship chips** — `components/records/relations.tsx` is the one way a record shows what
  it belongs to (person, vehicle, project, category), in detail views; list rows say the same in
  their second line.

## Activity and Inbox

`ActivityEvent` (actor, verb, object, context, detail) is one feed rendered by one component
(`ActivityList`) with different filters: dashboard, project, vehicle, person, `/activity`.
`InboxItem` is "needs attention": either for an audience (everyone with a permission, e.g.
`expenses.approve`) or a recipient. In the demo, events for your own changes are derived when the
journal is applied; on the database, triggers write them as the person acting (`log_submission`,
`log_review`, `log_record`, `log_file`, …), along with each submission's approval history in
`approval_events` (submitted, returned with its reason, resubmitted, approved — actor and time).

## Files

Files attach to records (`attachedTo: [{ type: 'project' | 'vehicle' | 'person' | 'receipt', id }]`)
and carry an access level (`team`, `managers`, `private`, `shared`). A certificate of insurance can
belong to a subcontractor and two projects at once. The file panel answers "Who can open it?" in
plain words. Uploads record name, type, size and attachments (on the database, as real rows); the
bytes stay on the device — there is no Storage bucket yet, and Download is disabled.

## Business customization (Phase 2C)

A business's setup lives in three places (docs/CUSTOMIZATION.md): identity and words as columns on
`spaces` (`labels`, `brand`, `modules`, `mileage_rate`), rules in `space_settings` (one validated
document: receipts, mileage, approvals, read through `resolveSettings()` in
`lib/platform/business-settings.ts`), and field definitions in `custom_fields` (one row per field;
`repo.fields()`). Answers stay on the record (`custom` on projects, vehicles, receipts, trips and
memberships), so a record's access is its answers' access. One field engine
(`lib/platform/custom-fields.ts`) builds forms, checks answers, formats facts, exports and search
for every record type; the database checks the same things again. Rules flow into the product
through a few functions — `formRules()` shapes the forms, `needsApproval()` decides filing,
`permissionsFor(membership, space)` drops approval from managers when only owners and admins
approve — never through `if` checks for a kind of business. Presets (`lib/platform/business-types.ts`)
are a starting setup, applied only when a business is created or when its owner accepts
"Apply recommended additions".

## Search

The command bar (⌘K, `/`) searches an index built on the server from the same scoped repository,
so it only finds what the person can see: actions, tools, projects, vehicles, people, files, other
Spaces and (in Demo Mode) people to preview as. At production scale this becomes a search query
with the same result shape (`SearchItem` in `lib/search.ts`).

## Functional vs mocked

| Works for real                                                                                                                                  | Simulated in the preview                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| PDF merge and page extract with page thumbnails (pdf-lib + PDF.js), QR PNG/SVG for links, Wi-Fi and email, image resize/convert (all on-device) | Real accounts are built but off (Demo Mode is live)  |
| Every create flow, approvals, inbox actions, turning tools on/off — persisted in Postgres with `HYPHY_DATA=supabase`                            | Storage: files record metadata only                  |
| Role-scoped reads everywhere, server-side permission checks on every change                                                                     | Receipt auto-reading (sample receipt shows the flow) |
| Mileage CSV export, link page editing, saving QR codes                                                                                          | Link page publishing, email invitations, billing     |

With `HYPHY_DATA=demo`, changes persist per browser in the Demo Mode journal until Reset; with
`HYPHY_DATA=supabase`, in the development database (see DEMO-MODE.md and supabase/README.md).

## PWA readiness

`app/manifest.ts` (standalone display, icons), `apple-icon.png`, `viewport-fit=cover` with safe-area
padding on the phone bars, and 16px inputs so iOS doesn't zoom. No service worker yet; nothing in
the app assumes a browser tab, so adding one later is additive.
