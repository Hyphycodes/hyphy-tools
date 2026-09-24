@AGENTS.md

# Repository scope — permanent rules

These rules apply to every Claude session in this repository, whatever the task says.

1. **This repository only.** A Hyphy Tools session may modify only Hyphy Tools
   (`github.com/Hyphycodes/hyphy-tools`) unless another repository is explicitly named and
   authorized by the user in that same request. That authorization covers only the request that
   gives it; it never carries over to later sessions. Before changing any file, run
   `git rev-parse --show-toplevel` and `git remote -v` and confirm the root is this repository and
   `origin` points at `Hyphycodes/hyphy-tools`. Check again before every commit and push.
2. **Hyphy Studio is a separate product.** `hyphy-studio` is the marketing site; this is the
   software. Never edit, commit in or push to Studio (or any other sibling folder) from a Hyphy
   Tools session unless rule 1's explicit authorization names it. Studio code may be read as source
   material when the user asks for it.
3. **No outside deployments.** Never deploy, reconfigure or change environment variables, domains or
   databases of any other Vercel project, Supabase project or external service.
4. **Portfolio and client projects are read-only.** G2 Construction, Chicago Testing Laboratory,
   Casa Aurelia, Oasis, the Gas Receipts portal and every other showcased project stay untouched
   unless the user names and authorizes a change to that specific project in that request.

# Product rules

- **Phase 1 is a demo environment.** There is no sign-in. Identity comes from Demo Mode
  (`src/lib/demo`, `src/lib/identity/demo-source.ts`); data comes from the seeded demo repository
  (`src/lib/data/demo`). Never add `if (demo)` checks to product components — swap the identity
  source or the repository instead (see `docs/ARCHITECTURE.md`).
- **Every saved object belongs to a Space** and carries `spaceId`; the creator is `createdBy`.
- **Role, plan and modules are separate concepts.** Role comes from the membership, plan from the
  Space, modules from the Space's enabled list. Never infer one from another.
- UI permission checks are presentation. Real enforcement belongs to the server (and, once the
  database is live, Row Level Security). Server actions must check permissions with `requirePermission`.
- Demo people, companies and numbers are fictional and must stay obviously fictional (`.example`
  emails, invented businesses). Never put a real client, real customer data or a real price in the
  seed data. Prices, when they exist, will come from Hyphy Studio's `src/data/engagements.ts`.
- Tool statuses are only Available, Beta and Coming soon (`src/lib/platform/tools.ts`).
- Vocabulary on the surface: Spaces, People, Projects, Files, Tools, Needs attention, Who can
  access this. Never: tenant, RBAC, schema, workflow engine.
