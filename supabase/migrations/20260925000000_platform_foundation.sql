-- Hyphy Tools — platform foundation (PROPOSED, NOT APPLIED)
--
-- The production shape of what Demo Mode simulates: one identity per person, Spaces, memberships
-- with roles, and records that each belong to a Space. Row Level Security enforces the same
-- visibility rules as src/lib/data/demo/repository.ts; keep the two in sync.
--
-- Apply only to the Hyphy Tools Supabase project, after review (see supabase/README.md). Never
-- apply it to Hyphy Studio's project or any other.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  hue text not null default '#3240FF',
  headline text,
  phone text,
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Spaces and memberships
-- ---------------------------------------------------------------------------------------------

create type public.space_kind as enum ('personal', 'business');
create type public.plan_id as enum ('free', 'personal-pro', 'business', 'business-pro');
create type public.space_role as enum ('owner', 'admin', 'manager', 'member', 'guest');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  -- Business Spaces have a unique slug; personal Spaces are addressed as /personal.
  slug text unique check (slug ~ '^[a-z0-9-]{2,48}$' and slug <> 'personal'),
  kind public.space_kind not null,
  name text not null,
  descriptor text not null default '',
  plan public.plan_id not null default 'free',
  modules text[] not null default array['pdf', 'qr', 'images', 'links', 'receipts', 'mileage', 'files'],
  labels jsonb not null default '{}',
  brand jsonb not null default '{"color":"#3240FF","ink":"light","monogram":"H"}',
  custom_fields jsonb not null default '{}',
  timezone text not null default 'America/Chicago',
  owner_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((kind = 'personal') = (owner_id is not null)),
  check (kind = 'personal' or slug is not null)
);
-- One personal Space per person.
create unique index spaces_one_personal on public.spaces (owner_id) where kind = 'personal';
alter table public.spaces enable row level security;

create table public.space_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  person_id uuid not null references public.profiles (id) on delete cascade,
  role public.space_role not null,
  title text not null default '',
  status text not null default 'invited' check (status in ('invited', 'active')),
  -- Guests (and optionally members) are limited to these projects.
  project_ids uuid[] not null default '{}',
  custom jsonb not null default '{}',
  joined_at timestamptz not null default now(),
  unique (space_id, person_id)
);
create index space_members_person on public.space_members (person_id);
alter table public.space_members enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Role → permission. Mirrors src/lib/platform/roles.ts.
-- ---------------------------------------------------------------------------------------------

create or replace function public.role_in(space uuid)
returns public.space_role
language sql stable security definer set search_path = public as $$
  select role from space_members
  where space_id = space and person_id = auth.uid() and status = 'active'
$$;

create or replace function public.can(space uuid, permission text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case role_in(space)
    when 'owner' then true
    when 'admin' then permission <> 'space.billing'
    when 'manager' then permission = any (array[
      'people.view', 'projects.view_all', 'projects.manage', 'vehicles.view_all',
      'vehicles.manage', 'expenses.submit', 'expenses.view_all', 'expenses.approve',
      'files.view_all', 'files.upload', 'files.manage', 'activity.view_all', 'tools.use'])
    when 'member' then permission = any (array['people.view', 'expenses.submit', 'files.upload', 'tools.use'])
    when 'guest' then permission = 'files.upload'
  end, false)
$$;

create or replace function public.is_member(space uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select role_in(space) is not null
$$;

-- ---------------------------------------------------------------------------------------------
-- Records. Every row belongs to one Space and records its creator.
-- ---------------------------------------------------------------------------------------------

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  name text not null,
  location text,
  client text,
  status text not null default 'planning' check (status in ('planning', 'active', 'on-hold', 'done')),
  summary text not null default '',
  lead_id uuid references public.profiles (id),
  team_ids uuid[] not null default '{}',
  start_date timestamptz not null default now(),
  due_date timestamptz,
  progress smallint not null default 0 check (progress between 0 and 100),
  budget numeric(12, 2),
  color text not null default '#3240FF',
  custom jsonb not null default '{}'
);
create index projects_space on public.projects (space_id);
alter table public.projects enable row level security;

create or replace function public.can_see_project(project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = project
      and (
        can(p.space_id, 'projects.view_all')
        or auth.uid() = any (p.team_ids)
        or exists (
          select 1 from space_members m
          where m.space_id = p.space_id and m.person_id = auth.uid()
            and m.status = 'active' and p.id = any (m.project_ids)
        )
      )
  )
$$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  name text not null,
  year smallint,
  make text,
  model text,
  plate text,
  vin_last6 text,
  odometer integer not null default 0,
  fuel text not null default 'gas' check (fuel in ('gas', 'diesel', 'electric')),
  status text not null default 'available' check (status in ('active', 'in-shop', 'available')),
  assigned_to uuid references public.profiles (id),
  fuel_card_last4 text,
  next_service_miles integer,
  color text not null default '#E8E4DA',
  custom jsonb not null default '{}'
);
create index vehicles_space on public.vehicles (space_id);
alter table public.vehicles enable row level security;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  vendor text not null,
  category text not null check (category in ('fuel', 'materials', 'meals', 'supplies', 'equipment', 'other')),
  total numeric(10, 2) not null default 0,
  date timestamptz not null,
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  payment_method text,
  gallons numeric(7, 3),
  odometer integer,
  vehicle_id uuid references public.vehicles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  file_id uuid,
  notes text,
  reviewed_by uuid references public.profiles (id)
);
create index receipts_space on public.receipts (space_id, date desc);
alter table public.receipts enable row level security;

create table public.mileage_entries (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  date timestamptz not null,
  "from" text not null,
  "to" text not null,
  miles numeric(8, 1) not null check (miles > 0),
  round_trip boolean not null default false,
  purpose text not null default '',
  vehicle_id uuid references public.vehicles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles (id)
);
create index mileage_space on public.mileage_entries (space_id, date desc);
alter table public.mileage_entries enable row level security;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  name text not null,
  kind text not null check (kind in ('pdf', 'image', 'doc', 'sheet', 'archive')),
  size bigint not null default 0,
  pages integer,
  folder text not null default 'Uploads',
  access text not null default 'team' check (access in ('team', 'managers', 'private', 'shared')),
  expires_at timestamptz,
  source text,
  -- Path in the private Storage bucket `space-files/<space_id>/<id>`.
  storage_path text
);
create index files_space on public.files (space_id, created_at desc);
alter table public.files enable row level security;

-- A file can belong to several records at once (a COI covers two projects and a person).
create table public.file_attachments (
  file_id uuid not null references public.files (id) on delete cascade,
  record_type text not null check (record_type in ('project', 'vehicle', 'person', 'receipt')),
  record_id uuid not null,
  primary key (file_id, record_type, record_id)
);
alter table public.file_attachments enable row level security;

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  label text not null,
  content text not null check (length(content) <= 1000),
  fg text not null default '#0F0F0E',
  bg text not null default '#FFFFFF',
  placement text
);
alter table public.qr_codes enable row level security;

create table public.link_pages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  handle text not null unique check (handle ~ '^[a-z0-9-]{2,30}$'),
  bio text not null default '',
  theme text not null default 'paper',
  links jsonb not null default '[]'
);
alter table public.link_pages enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Activity and Inbox. Written by triggers and trusted server code, never by browsers directly.
-- ---------------------------------------------------------------------------------------------

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  actor_id uuid not null references public.profiles (id),
  verb text not null,
  object_type text not null,
  object_id uuid not null,
  object_label text not null,
  context_type text,
  context_id uuid,
  context_label text,
  detail text,
  at timestamptz not null default now()
);
create index activity_space on public.activity (space_id, at desc);
alter table public.activity enable row level security;

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  kind text not null,
  title text not null,
  detail text not null default '',
  at timestamptz not null default now(),
  subject_type text not null,
  subject_id uuid not null,
  subject_label text not null,
  audience text,
  recipient_id uuid references public.profiles (id),
  from_id uuid references public.profiles (id),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  status text not null default 'open' check (status in ('open', 'done')),
  check (audience is not null or recipient_id is not null)
);
create index inbox_space on public.inbox_items (space_id, status, at desc);
alter table public.inbox_items enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------------------------

create policy "See your own profile and the people you share a Space with" on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from space_members mine join space_members theirs on theirs.space_id = mine.space_id
      where mine.person_id = auth.uid() and mine.status = 'active' and theirs.person_id = profiles.id
    )
  );
create policy "Edit your own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Members see their Spaces" on public.spaces
  for select to authenticated using (is_member(id));
create policy "Managers of a Space change its settings" on public.spaces
  for update to authenticated using (can(id, 'space.manage')) with check (can(id, 'space.manage'));

create policy "See your membership, and the directory if your role allows" on public.space_members
  for select to authenticated using (person_id = auth.uid() or can(space_id, 'people.view'));
create policy "People managers invite" on public.space_members
  for insert to authenticated with check (
    can(space_id, 'people.manage')
    and (role not in ('owner', 'admin') or role_in(space_id) = 'owner')
  );
create policy "People managers change roles" on public.space_members
  for update to authenticated using (can(space_id, 'people.manage'))
  with check (role not in ('owner', 'admin') or role_in(space_id) = 'owner');

create policy "Projects you can see" on public.projects
  for select to authenticated using (can_see_project(id));
create policy "Project managers create and edit" on public.projects
  for all to authenticated using (can(space_id, 'projects.manage')) with check (can(space_id, 'projects.manage'));

create policy "Vehicles you can see" on public.vehicles
  for select to authenticated using (
    role_in(space_id) <> 'guest' and (can(space_id, 'vehicles.view_all') or assigned_to = auth.uid())
  );
create policy "Vehicle managers create and edit" on public.vehicles
  for all to authenticated using (can(space_id, 'vehicles.manage')) with check (can(space_id, 'vehicles.manage'));

create policy "Your receipts, or all of them if you review" on public.receipts
  for select to authenticated using (created_by = auth.uid() or can(space_id, 'expenses.view_all'));
create policy "Submit your own receipts" on public.receipts
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve'))
    and (project_id is null or can_see_project(project_id))
  );
create policy "Edit your drafts; reviewers decide" on public.receipts
  for update to authenticated using (
    (created_by = auth.uid() and status = 'draft') or can(space_id, 'expenses.approve')
  );

create policy "Your trips, or all of them if you review" on public.mileage_entries
  for select to authenticated using (created_by = auth.uid() or can(space_id, 'expenses.view_all'));
create policy "Log your own trips" on public.mileage_entries
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve'))
  );
create policy "Reviewers decide on trips" on public.mileage_entries
  for update to authenticated using (can(space_id, 'expenses.approve'));

create or replace function public.can_see_file(file uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from files f
    where f.id = file and (
      f.created_by = auth.uid()
      or (f.access <> 'private' and can(f.space_id, 'files.view_all'))
      or (
        f.access in ('team', 'shared') and (
          (not exists (select 1 from file_attachments a where a.file_id = f.id)
            and f.access = 'team' and role_in(f.space_id) in ('owner', 'admin', 'manager', 'member'))
          or exists (
            select 1 from file_attachments a where a.file_id = f.id and (
              (a.record_type = 'project' and can_see_project(a.record_id))
              or (a.record_type = 'person' and a.record_id = auth.uid())
              or (a.record_type = 'vehicle' and exists (
                select 1 from vehicles v where v.id = a.record_id and v.assigned_to = auth.uid()))
            )
          )
        )
      )
    )
  )
$$;

create policy "Files you can see" on public.files
  for select to authenticated using (can_see_file(id));
create policy "Upload files" on public.files
  for insert to authenticated with check (created_by = auth.uid() and can(space_id, 'files.upload'));
create policy "File managers edit" on public.files
  for update to authenticated using (created_by = auth.uid() or can(space_id, 'files.manage'));
create policy "Attachments follow their file" on public.file_attachments
  for select to authenticated using (can_see_file(file_id));

create policy "Codes in your Spaces" on public.qr_codes
  for select to authenticated using (can(space_id, 'tools.use'));
create policy "Save codes" on public.qr_codes
  for insert to authenticated with check (created_by = auth.uid() and can(space_id, 'tools.use'));
create policy "Link pages in your Spaces" on public.link_pages
  for select to authenticated using (can(space_id, 'tools.use'));
create policy "Save link pages" on public.link_pages
  for all to authenticated using (can(space_id, 'tools.use')) with check (can(space_id, 'tools.use'));

create policy "Activity you can see" on public.activity
  for select to authenticated using (
    can(space_id, 'activity.view_all')
    or actor_id = auth.uid()
    or (
      object_type not in ('receipt', 'mileage') and (
        (object_type = 'project' and can_see_project(object_id))
        or (context_type = 'project' and can_see_project(context_id))
      )
    )
  );

create policy "Inbox items for you or your role" on public.inbox_items
  for select to authenticated using (
    recipient_id = auth.uid() or (audience is not null and can(space_id, audience))
  );
create policy "Clear your inbox items" on public.inbox_items
  for update to authenticated using (
    recipient_id = auth.uid() or (audience is not null and can(space_id, audience))
  ) with check (status in ('open', 'done'));

-- ---------------------------------------------------------------------------------------------
-- Triggers: every person gets a personal Space; submissions write activity and inbox items.
-- ---------------------------------------------------------------------------------------------

create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare personal uuid;
begin
  insert into spaces (kind, name, descriptor, plan, owner_id, brand)
  values ('personal', 'Personal', 'Just for you', 'free', new.id,
          jsonb_build_object('color', new.hue, 'ink', 'light', 'monogram', upper(left(new.name, 1))))
  returning id into personal;
  insert into space_members (space_id, person_id, role, title, status)
  values (personal, new.id, 'owner', 'Owner', 'active');
  return new;
end;
$$;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public.handle_new_profile();

create or replace function public.log_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Read table-specific columns through jsonb: both tables share this function.
  fields jsonb := to_jsonb(new);
  kind text := case tg_table_name when 'receipts' then 'receipt' else 'mileage' end;
  label text := case tg_table_name
    when 'receipts' then (fields ->> 'vendor') || ' receipt'
    else (fields ->> 'from') || ' → ' || (fields ->> 'to') end;
begin
  insert into activity (space_id, actor_id, verb, object_type, object_id, object_label)
  values (new.space_id, new.created_by, case kind when 'receipt' then 'submitted' else 'logged' end, kind, new.id, label);
  if new.status = 'submitted' then
    insert into inbox_items (space_id, kind, title, subject_type, subject_id, subject_label, audience, from_id)
    values (new.space_id,
            case kind when 'receipt' then 'receipt-approval' else 'mileage-review' end,
            case kind when 'receipt' then 'Receipt needs approval' else 'Mileage submitted' end,
            kind, new.id, label, 'expenses.approve', new.created_by);
  end if;
  return new;
end;
$$;
create trigger receipts_submitted after insert on public.receipts
  for each row execute function public.log_submission();
create trigger mileage_submitted after insert on public.mileage_entries
  for each row execute function public.log_submission();

-- Browsers never write activity or inbox items directly.
revoke insert, delete on public.activity, public.inbox_items from anon, authenticated;
revoke all on all tables in schema public from anon;
