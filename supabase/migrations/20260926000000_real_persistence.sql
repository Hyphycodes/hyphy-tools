-- Hyphy Tools — real persistence (Phase 1.9).
--
-- Follows 20260925000000_platform_foundation.sql and 20260925100000_connected_systems.sql, and
-- corrects what a review of both found before they were applied anywhere:
--
--   * approval history is its own table (approval_events), not reconstructed from status;
--   * owners could change their own plan and anyone could rewrite inbox titles — updates are now
--     limited to the columns people are meant to change;
--   * mileage inserts check the project and vehicle are visible, as receipts already did;
--   * guests can see the teammates on projects shared with them (their contacts);
--   * activity about a vehicle is visible to the person who drives it;
--   * every change the product records writes its activity line in the database, so the server
--     never inserts activity itself;
--   * seeding (dev only) can load a whole world without triggers writing duplicate rows;
--   * missing columns, indexes and a foreign key.
--
-- Nothing here is development-only. Demo tooling lives in supabase/dev/ and is never applied to
-- a production database.

-- ---------------------------------------------------------------------------------------------
-- Seeding guard: set `hyphy.seeding = on` in a transaction to load rows without side effects.
-- ---------------------------------------------------------------------------------------------

create or replace function public.seeding()
returns boolean
language sql stable as $$
  select coalesce(current_setting('hyphy.seeding', true), '') = 'on'
$$;

-- A personal Space for every new person — unless one exists or a seed is loading its own.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare personal uuid;
begin
  if seeding() or exists (select 1 from spaces where owner_id = new.id and kind = 'personal') then
    return new;
  end if;
  insert into spaces (kind, name, descriptor, plan, owner_id, brand)
  values ('personal', 'Personal', 'Just for you', 'free', new.id,
          jsonb_build_object('color', new.hue, 'ink', 'light', 'monogram', upper(left(new.name, 1))))
  returning id into personal;
  insert into space_members (space_id, person_id, role, title, status)
  values (personal, new.id, 'owner', 'Owner', 'active');
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Columns, keys and indexes the product needs
-- ---------------------------------------------------------------------------------------------

alter table public.space_members add column department text;
alter table public.files add column preview text;
alter table public.receipts
  add constraint receipts_file_fk foreign key (file_id) references public.files (id) on delete set null;

create index projects_lead on public.projects (lead_id);
create index vehicles_assigned on public.vehicles (assigned_to) where assigned_to is not null;
create index receipts_project on public.receipts (project_id) where project_id is not null;
create index receipts_vehicle on public.receipts (vehicle_id) where vehicle_id is not null;
create index receipts_waiting on public.receipts (space_id) where status = 'submitted';
create index mileage_project on public.mileage_entries (project_id) where project_id is not null;
create index mileage_vehicle on public.mileage_entries (vehicle_id) where vehicle_id is not null;
create index mileage_waiting on public.mileage_entries (space_id) where status = 'submitted';
create index file_attachments_record on public.file_attachments (record_type, record_id);
create index qr_codes_space on public.qr_codes (space_id, created_at desc);
create index link_pages_space on public.link_pages (space_id);
create index activity_object on public.activity (object_id);
create index activity_context on public.activity (context_id) where context_id is not null;

alter table public.inbox_items add constraint inbox_items_kind_check check (
  kind in ('document-uploaded', 'access-request', 'document-expiring', 'mention')
);

-- ---------------------------------------------------------------------------------------------
-- Approval history: every submission, return (with its reason), resubmission and approval.
-- ---------------------------------------------------------------------------------------------

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  submission_type text not null check (submission_type in ('receipt', 'mileage')),
  submission_id uuid not null,
  action text not null check (action in ('submitted', 'returned', 'resubmitted', 'approved')),
  actor_id uuid not null references public.profiles (id),
  reason text check (length(reason) <= 280),
  at timestamptz not null default now()
);
create index approval_events_submission on public.approval_events (submission_id, at);
alter table public.approval_events enable row level security;

-- Visible exactly when the submission is (the receipts and mileage policies decide).
create policy "History of submissions you can see" on public.approval_events
  for select to authenticated using (
    (submission_type = 'receipt' and exists (select 1 from receipts r where r.id = submission_id))
    or (submission_type = 'mileage' and exists (select 1 from mileage_entries m where m.id = submission_id))
  );

create or replace function public.log_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind text := case tg_table_name when 'receipts' then 'receipt' else 'mileage' end;
  action text;
begin
  if seeding() then return new; end if;
  if tg_op = 'INSERT' then
    if new.status = 'draft' then return new; end if;
    insert into approval_events (space_id, submission_type, submission_id, action, actor_id, at)
    values (new.space_id, kind, new.id, 'submitted', new.created_by, new.created_at);
    if new.status = 'approved' and new.reviewed_by is not null and new.reviewed_by <> new.created_by then
      insert into approval_events (space_id, submission_type, submission_id, action, actor_id)
      values (new.space_id, kind, new.id, 'approved', new.reviewed_by);
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  action := case
    when old.status = 'returned' and new.status in ('submitted', 'approved') then 'resubmitted'
    when old.status = 'draft' and new.status in ('submitted', 'approved') then 'submitted'
    when new.status in ('approved', 'returned') then new.status
  end;
  if action is null then return new; end if;
  insert into approval_events (space_id, submission_type, submission_id, action, actor_id, reason)
  values (new.space_id, kind, new.id, action, coalesce(auth.uid(), new.created_by),
          case when action = 'returned' then nullif(new.return_reason, '') end);
  return new;
end;
$$;
create trigger receipts_approval after insert or update of status on public.receipts
  for each row execute function public.log_approval();
create trigger mileage_approval after insert or update of status on public.mileage_entries
  for each row execute function public.log_approval();

-- ---------------------------------------------------------------------------------------------
-- Activity: written by the database for every change worth a line. Same lines Demo Mode derives
-- in src/lib/data/demo/journal-apply.ts.
-- ---------------------------------------------------------------------------------------------

create or replace function public.ref_label(kind text, ref uuid)
returns text language sql stable security definer set search_path = public as $$
  select case kind
    when 'project' then (select name from projects where id = ref)
    when 'vehicle' then (select name from vehicles where id = ref)
    when 'link' then (select '@' || handle from link_pages where id = ref)
  end
$$;

create or replace function public.write_activity(
  space uuid, actor uuid, verb text, object_type text, object_id uuid, object_label text,
  context_type text default null, context_id uuid default null, detail text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if seeding() then return; end if;
  insert into activity (space_id, actor_id, verb, object_type, object_id, object_label,
                        context_type, context_id, context_label, detail)
  values (space, actor, verb, object_type, object_id, object_label,
          case when context_id is not null then context_type end, context_id,
          case when context_id is not null then ref_label(context_type, context_id) end, detail);
end;
$$;
revoke execute on function public.write_activity from public, anon, authenticated;

-- Short place names, as the product says them ("Shop → Oak Brook Remodel").
create or replace function public.trip_label(origin text, destination text)
returns text language sql immutable as $$
  select split_part(origin, ',', 1) || ' → ' || split_part(destination, ',', 1)
$$;

create or replace function public.log_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f jsonb := to_jsonb(new);
  receipt boolean := tg_table_name = 'receipts';
  business boolean := (select kind = 'business' from spaces where id = new.space_id);
  context_type text := case when new.project_id is not null then 'project' when new.vehicle_id is not null then 'vehicle' end;
  context_id uuid := coalesce(new.project_id, new.vehicle_id);
begin
  if receipt then
    perform write_activity(new.space_id, new.created_by,
      case when business and new.status <> 'draft' then 'submitted' else 'uploaded' end,
      'receipt', new.id, (f ->> 'vendor') || ' receipt', context_type, context_id,
      case when (f ->> 'total')::numeric > 0 then to_char((f ->> 'total')::numeric, 'FM$999,999,990.00') else 'Needs a total' end);
  else
    perform write_activity(new.space_id, new.created_by, 'logged', 'mileage', new.id,
      trip_label(f ->> 'from', f ->> 'to'), context_type, context_id,
      rtrim(rtrim((f ->> 'miles'), '0'), '.') || ' mi');
  end if;
  return new;
end;
$$;

create or replace function public.log_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  f jsonb := to_jsonb(new);
  receipt boolean := tg_table_name = 'receipts';
  label text := case when receipt then (f ->> 'vendor') || ' receipt' else trip_label(f ->> 'from', f ->> 'to') end;
  amount text := case when receipt then to_char((f ->> 'total')::numeric, 'FM$999,999,990.00')
                      else rtrim(rtrim((f ->> 'miles'), '0'), '.') || ' mi' end;
  context_type text := case when new.project_id is not null then 'project' when new.vehicle_id is not null then 'vehicle' end;
  context_id uuid := coalesce(new.project_id, new.vehicle_id);
  actor uuid := coalesce(auth.uid(), new.created_by);
  verb text;
begin
  if new.status is not distinct from old.status then return new; end if;
  verb := case
    when old.status in ('returned', 'draft') and actor = new.created_by and new.status in ('submitted', 'approved')
      then case old.status when 'returned' then 'resubmitted' else 'submitted' end
    when new.status in ('approved', 'returned') then new.status
  end;
  if verb is null then return new; end if;
  perform write_activity(new.space_id, actor, verb, case when receipt then 'receipt' else 'mileage' end,
    new.id, label, context_type, context_id,
    case when verb = 'returned' and coalesce(new.return_reason, '') <> '' then '“' || new.return_reason || '”' else amount end);
  return new;
end;
$$;

-- The foundation's triggers fired on insert only and wrote inbox rows; approvals are now read
-- from the submissions, so both tables get one insert trigger and one review trigger.
drop trigger if exists receipts_reviewed on public.receipts;
drop trigger if exists mileage_reviewed on public.mileage_entries;
create trigger receipts_reviewed after update of status on public.receipts
  for each row execute function public.log_review();
create trigger mileage_reviewed after update of status on public.mileage_entries
  for each row execute function public.log_review();

create or replace function public.log_record()
returns trigger language plpgsql security definer set search_path = public as $$
declare f jsonb := to_jsonb(new);
begin
  case tg_table_name
    when 'projects' then
      perform write_activity(new.space_id, new.created_by, 'created', 'project', new.id, f ->> 'name');
    when 'vehicles' then
      perform write_activity(new.space_id, new.created_by, 'created', 'vehicle', new.id, f ->> 'name');
    when 'qr_codes' then
      perform write_activity(new.space_id, new.created_by, 'generated', 'qr', new.id, f ->> 'label',
        case when f ->> 'project_id' is not null then 'project' else 'link' end,
        coalesce((f ->> 'project_id')::uuid, (f ->> 'link_page_id')::uuid));
    when 'link_pages' then
      perform write_activity(new.space_id, coalesce(auth.uid(), new.created_by),
        case tg_op when 'INSERT' then 'created' else 'updated' end, 'link', new.id, f ->> 'title');
  end case;
  return new;
end;
$$;
create trigger projects_logged after insert on public.projects
  for each row execute function public.log_record();
create trigger vehicles_logged after insert on public.vehicles
  for each row execute function public.log_record();
create trigger qr_codes_logged after insert on public.qr_codes
  for each row execute function public.log_record();
create trigger link_pages_logged after insert or update on public.link_pages
  for each row execute function public.log_record();

-- A file's line is written at commit, once its attachments exist, so it can say where it went.
create or replace function public.log_file()
returns trigger language plpgsql security definer set search_path = public as $$
declare target record;
begin
  select record_type, record_id into target from file_attachments
  where file_id = new.id and record_type in ('project', 'vehicle')
  order by record_type limit 1;
  perform write_activity(new.space_id, new.created_by,
    case when new.source is not null then 'generated' else 'uploaded' end, 'file', new.id, new.name,
    target.record_type, target.record_id);
  return new;
end;
$$;
create constraint trigger files_logged after insert on public.files
  deferrable initially deferred
  for each row execute function public.log_file();

create or replace function public.log_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'invited' then return new; end if;
  perform write_activity(new.space_id, coalesce(auth.uid(), new.person_id), 'invited', 'person',
    new.person_id, (select name from profiles where id = new.person_id), null, null, new.title);
  return new;
end;
$$;
create trigger space_members_logged after insert on public.space_members
  for each row execute function public.log_membership();

create or replace function public.log_modules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.modules is distinct from old.modules then
    perform write_activity(new.id, coalesce(auth.uid(), new.owner_id), 'updated', 'space', new.id,
      'the tools in this Space');
  end if;
  return new;
end;
$$;
create trigger spaces_modules_logged after update of modules on public.spaces
  for each row execute function public.log_modules();

-- ---------------------------------------------------------------------------------------------
-- Policy corrections
-- ---------------------------------------------------------------------------------------------

-- Plans change through billing, never from the settings screen.
revoke update on public.spaces from authenticated;
grant update (name, descriptor, modules, labels, brand, custom_fields, timezone, work_style, mileage_rate)
  on public.spaces to authenticated;

-- Clearing an inbox item is the only change a person makes to it.
revoke update on public.inbox_items from authenticated;
grant update (status) on public.inbox_items to authenticated;

-- Guests see the teammates on the projects shared with them — their contacts — not the roster.
drop policy "See your membership, and the directory if your role allows" on public.space_members;
create policy "Your membership, your teammates, or the directory" on public.space_members
  for select to authenticated using (
    person_id = auth.uid()
    or can(space_id, 'people.view')
    or (
      role <> 'guest' and exists (
        select 1 from projects p
        where p.space_id = space_members.space_id and can_see_project(p.id)
          and space_members.person_id = any (p.team_ids)
      )
    )
  );

drop policy "Log your own trips" on public.mileage_entries;
create policy "Log your own trips" on public.mileage_entries
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve'))
    and (project_id is null or can_see_project(project_id))
    and (vehicle_id is null or exists (select 1 from vehicles v where v.id = vehicle_id))
  );

drop policy "Submit your own receipts" on public.receipts;
create policy "Submit your own receipts" on public.receipts
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve'))
    and (project_id is null or can_see_project(project_id))
    and (vehicle_id is null or exists (select 1 from vehicles v where v.id = vehicle_id))
  );

-- Activity about a vehicle is visible to its driver, as it is in the product.
drop policy "Activity you can see" on public.activity;
create policy "Activity you can see" on public.activity
  for select to authenticated using (
    can(space_id, 'activity.view_all')
    or actor_id = auth.uid()
    or (
      is_member(space_id)
      and object_type not in ('receipt', 'mileage')
      and (
        (object_type = 'project' and can_see_project(object_id))
        or (context_type = 'project' and can_see_project(context_id))
        or (object_type = 'vehicle' and exists (select 1 from vehicles v where v.id = object_id))
        or (context_type = 'vehicle' and exists (select 1 from vehicles v where v.id = context_id))
      )
    )
  );

-- Attachments are written with the file by whoever uploads it, into records they can see.
create policy "Attach your uploads to what you can see" on public.file_attachments
  for insert to authenticated with check (
    exists (select 1 from files f where f.id = file_id and f.created_by = auth.uid())
    and (
      (record_type = 'project' and can_see_project(record_id))
      or (record_type = 'vehicle' and exists (select 1 from vehicles v where v.id = record_id))
      or (record_type = 'person' and record_id = auth.uid())
    )
  );

-- Receipts and trips move through status only the ways the product allows. Policies decide who;
-- this decides what: no deciding your own, no skipping from draft to approved without the right.
create or replace function public.guard_review()
returns trigger language plpgsql set search_path = public as $$
begin
  if seeding() or auth.uid() is null then return new; end if;
  if new.created_by <> old.created_by or new.space_id <> old.space_id then
    raise exception 'A submission keeps its owner and Space.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'returned')
     and new.created_by = auth.uid() and not can(new.space_id, 'expenses.approve') then
    raise exception 'Someone else approves your own submissions.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'returned')
     and old.status <> 'submitted' and new.created_by <> auth.uid() then
    raise exception 'That one has already been decided.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger receipts_guard before update on public.receipts
  for each row execute function public.guard_review();
create trigger mileage_guard before update on public.mileage_entries
  for each row execute function public.guard_review();

-- ---------------------------------------------------------------------------------------------
-- Inviting someone who isn't in Hyphy yet: a placeholder identity their invitation will claim.
-- In production the invitation email (Supabase Auth admin API) creates the auth user instead;
-- this function is the database half of that flow.
-- ---------------------------------------------------------------------------------------------

create or replace function public.invite_member(
  space uuid, invitee_name text, invitee_email text, invitee_role public.space_role,
  invitee_title text, invitee_projects uuid[]
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare person uuid;
begin
  if not can(space, 'people.manage') then
    raise exception 'Your role in this Space can’t invite people.' using errcode = '42501';
  end if;
  if invitee_role in ('owner', 'admin') and role_in(space) <> 'owner' then
    raise exception 'Only an owner can add owners or admins.' using errcode = '42501';
  end if;
  select id into person from public.profiles where lower(email) = lower(invitee_email);
  if person is null then
    person := gen_random_uuid();
    insert into auth.users (id, email) values (person, invitee_email);
    insert into public.profiles (id, name, email) values (person, invitee_name, invitee_email);
  end if;
  insert into space_members (space_id, person_id, role, title, status, project_ids)
  values (space, person, invitee_role, invitee_title, 'invited', coalesce(invitee_projects, '{}'));
  return person;
end;
$$;
revoke execute on function public.invite_member from public, anon;
grant execute on function public.invite_member to authenticated;

-- Browsers and servers never write history or activity directly.
revoke insert, update, delete on public.approval_events from anon, authenticated;
grant select on public.approval_events to authenticated;
revoke all on public.approval_events from anon;

-- Names for everyone in a Space you belong to, for activity lines and file owners. Guests see
-- the same names on the records they can open, without reading the membership roster.
create or replace function public.space_directory(space uuid)
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from profiles p
  where is_member(space) and exists (
    select 1 from space_members m where m.space_id = space and m.person_id = p.id
  )
$$;
revoke execute on function public.space_directory from public, anon;
grant execute on function public.space_directory to authenticated;
