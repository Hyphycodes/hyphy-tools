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
lib/identity             IdentitySource: demo-source.ts (now) | supabase-source.ts (later)
lib/data                 Repository:     demo/repository.ts (now) | supabase repository (later)
lib/platform             pure rules shared by server and client: roles, plans, registries
components/*             UI; client components read the Workspace through useWorkspace()
```

- **Identity.** `getSession()` returns the person and all their memberships. `getWorkspace(slug)`
  picks the membership for the Space in the URL (`/personal` resolves to the viewer's own personal
  Space). Pages 404 when the viewer isn't a member. The client shell receives a serializable
  `ShellModel` built from the Workspace, exposed as `useWorkspace()` — the `currentUser`,
  `currentSpace` and membership abstraction.
- **Data.** `Repository` (`lib/data/repository.ts`) is the only way to read or write. Its contract:
  results only contain this Space's records that this person may see. The demo repository applies
  those rules in code; `supabase/migrations` applies the same rules as Row Level Security.
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
  filters and orders them per perspective. The + button, the phone's Create sheet, dashboard quick
  actions, `C` and ⌘K all use it; `useCreate().start(id, { attachTo })` opens any action from
  anywhere (a project's "Add expense" is the receipt action attached to that project).
- **Navigation** — `lib/platform/navigation.ts` builds nav from module readiness and permissions.
- **Dashboards** — `lib/platform/dashboard.ts`. Widgets declare when they apply; a role's
  dashboard is simply the widgets that apply. There are no per-person dashboards.

## Activity and Inbox

`ActivityEvent` (actor, verb, object, context, detail) is one feed rendered by one component
(`ActivityList`) with different filters: dashboard, project, vehicle, person, `/activity`.
`InboxItem` is "needs attention": either for an audience (everyone with a permission, e.g.
`expenses.approve`) or a recipient. In the demo, events for your own changes are derived when the
journal is applied; in production the database writes them with triggers
(`log_submission()` in the migration), so the interface doesn't change.

## Files

Files attach to records (`attachedTo: [{ type: 'project' | 'vehicle' | 'person' | 'receipt', id }]`)
and carry an access level (`team`, `managers`, `private`, `shared`). A certificate of insurance can
belong to a subcontractor and two projects at once. The file panel answers "Who can open it?" in
plain words. In the preview, uploads record name, type and size; bytes stay on the device.

## Custom fields (architecture only)

`FieldDefinition` lives on the Space per module (`space.customFields.projects`), values on the
record (`project.custom`, or `membership.custom` for per-Space facts about a person). Ten types
including references (`person`, `project`, `vehicle`, `file`), validation and formatting in
`lib/platform/custom-fields.ts`. The demo shows definitions in Settings and values on project,
vehicle and person pages; editing comes later.

## Search

The command bar (⌘K, `/`) searches an index built on the server from the same scoped repository,
so it only finds what the person can see: actions, tools, projects, vehicles, people, files, other
Spaces and (in Demo Mode) people to preview as. At production scale this becomes a search query
with the same result shape (`SearchItem` in `lib/search.ts`).

## Functional vs mocked

| Works for real                                                               | Simulated in the preview                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| PDF merge and page extract, QR PNG/SVG, image resize/convert (all on-device) | Identity (Demo Mode instead of sign-in)              |
| Every create flow, approvals, inbox actions, turning tools on/off            | Storage: files record metadata only                  |
| Role-scoped reads everywhere, server-side permission checks on every change  | Receipt auto-reading (sample receipt shows the flow) |
| Mileage CSV export, link page editing, saving QR codes                       | Link page publishing, email invitations, billing     |

Changes persist per browser in the Demo Mode journal until Reset (see DEMO-MODE.md).

## PWA readiness

`app/manifest.ts` (standalone display, icons), `apple-icon.png`, `viewport-fit=cover` with safe-area
padding on the phone bars, and 16px inputs so iOS doesn't zoom. No service worker yet; nothing in
the app assumes a browser tab, so adding one later is additive.
