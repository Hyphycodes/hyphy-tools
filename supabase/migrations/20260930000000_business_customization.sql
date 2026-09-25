-- Hyphy Tools — Business customization (Phase 2C).
--
-- Hyphy supplies the structure; the business supplies the details. This migration lets a business
-- adapt Hyphy without being able to break it:
--
--   1. Rules. `space_settings` holds one small, validated document per business: what receipts
--      and trips must name, whether personal cards and cars are paid back, when approval is needed
--      (always, never, or receipts over an amount) and who approves (owners and admins, or managers
--      too). Guests never read it. Only owners and admins change it.
--   2. Fields. `custom_fields` holds what a business tracks beyond Hyphy's own fields (a Cost Code
--      on receipts, a Job Number on jobs), per record type, with a key that never changes. The
--      answers live on the record itself (`custom jsonb`), so they share the record's access:
--      whoever can see the receipt sees its Cost Code, and nobody else can. A field's type is fixed
--      once any record uses it, a used dropdown can only gain choices, a used field can only be
--      archived ("Stop using"), never deleted.
--   3. Enforcement. Every write of a receipt, trip, project or vehicle is checked here, whatever
--      sent it: each changed answer must belong to a field this business uses today, be the
--      field's kind, and point only at people, projects and vehicles of this business that the
--      person can see; required fields and the business's submission rules apply when something is
--      submitted. Drafts may be incomplete. History is never re-judged: approving an old receipt
--      doesn't fail because a field was made required later.
--   4. Approvals follow the settings. A member's receipt that needs no approval is filed as
--      approved with no reviewer (nobody approved it; nothing needed to). Nobody can approve their
--      own submission, and managers stop approving when the business says only owners and admins
--      do — `public.can` answers from the settings.
--   5. Setup writes activity: fields added, archived or made required; rules, words, the kind of
--      business and the mileage rate changed. Reordering and accents don't.
--   6. The fields that lived in `spaces.custom_fields` (Phase 1's read-only preview) move into
--      `custom_fields` unchanged — same keys, so every saved answer still finds its field.
--
-- Function conventions as in Phase 2B: security definer where the check must see past the
-- caller's own rows, `search_path = ''`, every name qualified, callers identified by auth.uid().

-- 1 ---------------------------------------------------------------------------------------------

create table public.space_settings (
  space_id uuid primary key references public.spaces (id) on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
create index space_settings_updated_by on public.space_settings (updated_by)
  where updated_by is not null;
alter table public.space_settings enable row level security;

create policy "People who work here read the rules" on public.space_settings
  for select to authenticated using (public.role_in(space_id) <> 'guest');
create policy "Owners and admins set the rules" on public.space_settings
  for insert to authenticated with check (public.can(space_id, 'space.manage'));
create policy "Owners and admins change the rules" on public.space_settings
  for update to authenticated using (public.can(space_id, 'space.manage'))
  with check (public.can(space_id, 'space.manage'));
create policy "Only current members" on public.space_settings as restrictive
  for all to authenticated using (public.is_member(space_id)) with check (public.is_member(space_id));

revoke all on public.space_settings from anon, authenticated;
grant select, insert on public.space_settings to authenticated;
grant update (settings) on public.space_settings to authenticated;

-- Only known questions with allowed answers; anything else is refused, never silently kept.
-- Mirrors parseSettings in src/lib/platform/business-settings.ts.
create or replace function private.check_space_settings()
returns trigger language plpgsql set search_path = '' as $$
declare
  doc jsonb := new.settings;
  section text;
  item text;
  rule jsonb;
  over numeric;
begin
  if tg_op = 'UPDATE' and new.space_id <> old.space_id then
    raise exception 'A business keeps its own rules.' using errcode = '42501';
  end if;
  if (select s.kind from public.spaces s where s.id = new.space_id) is distinct from 'business' then
    raise exception 'Only businesses have these rules.';
  end if;
  if jsonb_typeof(doc) is distinct from 'object' then
    raise exception 'Unknown settings.';
  end if;
  for section in select jsonb_object_keys(doc) loop
    if section not in ('receipts', 'mileage', 'approvals')
       or jsonb_typeof(doc -> section) <> 'object' then
      raise exception 'Unknown settings.';
    end if;
    for item in select jsonb_object_keys(doc -> section) loop
      case section || '.' || item
        when 'receipts.requireProject', 'receipts.requireVehicle', 'receipts.allowPersonal',
             'mileage.requireProject', 'mileage.requirePurpose', 'mileage.allowPersonalVehicles' then
          if jsonb_typeof(doc -> section -> item) <> 'boolean' then
            raise exception 'Choose yes or no.';
          end if;
        when 'receipts.defaultCategory' then
          if jsonb_typeof(doc -> section -> item) <> 'string'
             or (doc -> section ->> item) not in ('fuel', 'materials', 'meals', 'supplies', 'equipment', 'other') then
            raise exception 'Choose one of the categories.';
          end if;
        when 'receipts.approval', 'mileage.approval' then
          rule := doc -> section -> item;
          if jsonb_typeof(rule) <> 'object'
             or exists (select 1 from jsonb_object_keys(rule) k where k not in ('mode', 'over')) then
            raise exception 'Choose when approval is needed.';
          end if;
          if rule ->> 'mode' in ('always', 'never') and not rule ? 'over' then
            null;
          elsif rule ->> 'mode' = 'over' and section = 'receipts' and jsonb_typeof(rule -> 'over') = 'number' then
            over := (rule ->> 'over')::numeric;
            if over <= 0 or over > 100000 then
              raise exception 'Choose an amount between $1 and $100,000.';
            end if;
          else
            raise exception 'Choose when approval is needed.';
          end if;
        when 'approvals.approvers' then
          if (doc -> section ->> item) is null or (doc -> section ->> item) not in ('managers', 'admins')
             or jsonb_typeof(doc -> section -> item) <> 'string' then
            raise exception 'Choose who approves.';
          end if;
        else
          raise exception 'Unknown settings.';
      end case;
    end loop;
  end loop;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
create trigger space_settings_checked before insert or update on public.space_settings
  for each row execute function private.check_space_settings();

-- 2 ---------------------------------------------------------------------------------------------

create table public.custom_fields (
  space_id uuid not null references public.spaces (id) on delete cascade,
  applies_to text not null check (applies_to in ('projects', 'vehicles', 'receipts', 'mileage', 'people')),
  -- Made from the first name ("Cost Code" → cost_code) and never changed: answers are saved under it.
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  type text not null check (type in ('text', 'number', 'currency', 'date', 'boolean', 'select',
                                     'person', 'project', 'vehicle', 'file')),
  options jsonb not null default '[]' check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 50),
  required boolean not null default false,
  help text check (char_length(help) <= 120),
  position integer not null default 0 check (position between 0 and 1000),
  show_in_list boolean not null default false,
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (space_id, applies_to, key),
  check ((type = 'select') = (jsonb_array_length(options) > 0))
);
-- One name per record type, used or not (a field that was stopped can be brought back instead).
create unique index custom_fields_label on public.custom_fields (space_id, applies_to, lower(btrim(label)));
create index custom_fields_created_by on public.custom_fields (created_by) where created_by is not null;
alter table public.custom_fields enable row level security;

-- The fields a person needs for the records they can reach: everyone who works here reads them
-- all; a guest only reaches shared projects, so only project fields.
create policy "Fields for the records you can reach" on public.custom_fields
  for select to authenticated using (
    public.is_member(space_id) and (applies_to = 'projects' or public.role_in(space_id) <> 'guest')
  );
create policy "Owners and admins add fields" on public.custom_fields
  for insert to authenticated with check (
    public.can(space_id, 'space.manage') and created_by = auth.uid()
  );
create policy "Owners and admins change fields" on public.custom_fields
  for update to authenticated using (public.can(space_id, 'space.manage'))
  with check (public.can(space_id, 'space.manage'));
create policy "Owners and admins remove unused fields" on public.custom_fields
  for delete to authenticated using (public.can(space_id, 'space.manage'));
create policy "Only current members" on public.custom_fields as restrictive
  for all to authenticated using (public.is_member(space_id)) with check (public.is_member(space_id));

revoke all on public.custom_fields from anon, authenticated;
grant select, insert, delete on public.custom_fields to authenticated;
grant update (label, type, options, required, help, position, show_in_list, archived_at)
  on public.custom_fields to authenticated;

-- Phase 1's fields move over as they were: same keys, same order.
insert into public.custom_fields (space_id, applies_to, key, label, type, options, required, help, position, created_at)
select s.id, e.key, f ->> 'id', f ->> 'label', f ->> 'type', coalesce(f -> 'options', '[]'::jsonb),
       coalesce((f ->> 'required')::boolean, false), f ->> 'help', (x.ord - 1)::int, s.created_at
from public.spaces s
cross join lateral jsonb_each(s.custom_fields) e
cross join lateral jsonb_array_elements(e.value) with ordinality as x(f, ord)
where e.key in ('projects', 'vehicles', 'people') and jsonb_typeof(e.value) = 'array';
alter table public.spaces drop column custom_fields;

-- Answers on the records themselves.
alter table public.receipts add column custom jsonb not null default '{}';
alter table public.mileage_entries add column custom jsonb not null default '{}';
alter table public.projects add constraint projects_custom_object check (jsonb_typeof(custom) = 'object');
alter table public.vehicles add constraint vehicles_custom_object check (jsonb_typeof(custom) = 'object');
alter table public.receipts add constraint receipts_custom_object check (jsonb_typeof(custom) = 'object');
alter table public.mileage_entries add constraint mileage_custom_object check (jsonb_typeof(custom) = 'object');
alter table public.space_members add constraint space_members_custom_object check (jsonb_typeof(custom) = 'object');
-- For "which records use this field" and, later, filtering and reports ("Cost Code = 200").
create index projects_custom on public.projects using gin (custom);
create index vehicles_custom on public.vehicles using gin (custom);
create index receipts_custom on public.receipts using gin (custom);
create index mileage_custom on public.mileage_entries using gin (custom);

-- Whether any record of this business has an answer for a field — across every record, not only
-- the ones the caller can see.
create or replace function private.field_in_use(space uuid, applies text, field_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case applies
    when 'projects' then exists (select 1 from public.projects where space_id = space and custom ? field_key)
    when 'vehicles' then exists (select 1 from public.vehicles where space_id = space and custom ? field_key)
    when 'receipts' then exists (select 1 from public.receipts where space_id = space and custom ? field_key)
    when 'mileage' then exists (select 1 from public.mileage_entries where space_id = space and custom ? field_key)
    when 'people' then exists (select 1 from public.space_members where space_id = space and custom ? field_key)
    else false
  end
$$;

-- What a definition may become. Mirrors definitionProblem in src/lib/platform/custom-fields.ts.
create or replace function private.guard_custom_field()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  used boolean;
  option jsonb;
begin
  if tg_op = 'DELETE' then
    if private.field_in_use(old.space_id, old.applies_to, old.key) then
      raise exception 'Records already have answers for % — stop using it instead.', old.label;
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.space_id <> old.space_id or new.applies_to <> old.applies_to
                           or new.key <> old.key or new.created_by is distinct from old.created_by) then
    raise exception 'A field keeps its business, record and key.' using errcode = '42501';
  end if;
  if public.seeding() then return new; end if;
  if (select s.kind from public.spaces s where s.id = new.space_id) is distinct from 'business' then
    raise exception 'Only businesses add their own fields.';
  end if;
  new.label := btrim(regexp_replace(new.label, '\s+', ' ', 'g'));
  if new.type = 'select' then
    for option in select value from jsonb_array_elements(new.options) loop
      if jsonb_typeof(option) <> 'string' or char_length(btrim(option #>> '{}')) not between 1 and 60 then
        raise exception 'Keep each choice to a short line of text.';
      end if;
    end loop;
    if (select count(distinct lower(btrim(value #>> '{}'))) from jsonb_array_elements(new.options))
       <> jsonb_array_length(new.options) then
      raise exception 'Each choice can be listed once.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.type = 'file' then
      raise exception 'File fields arrive with file storage.';
    end if;
    if new.archived_at is null and (select count(*) from public.custom_fields f
        where f.space_id = new.space_id and f.applies_to = new.applies_to and f.archived_at is null) >= 20 then
      raise exception 'Up to 20 fields at a time. Stop using one to add another.';
    end if;
    return new;
  end if;
  used := private.field_in_use(new.space_id, new.applies_to, new.key);
  if new.type <> old.type and (used or new.type = 'file') then
    raise exception '% already has answers saved, so its kind can’t change.', old.label;
  end if;
  if used and old.type = 'select' and new.type = 'select'
     and not (new.options @> old.options) then
    raise exception 'Records already use the choices of %, so they stay. You can add choices.', old.label;
  end if;
  if old.archived_at is not null and new.archived_at is null and (select count(*) from public.custom_fields f
      where f.space_id = new.space_id and f.applies_to = new.applies_to and f.archived_at is null) >= 20 then
    raise exception 'Up to 20 fields at a time. Stop using one first.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger custom_fields_guarded before insert or update or delete on public.custom_fields
  for each row execute function private.guard_custom_field();

-- 3 ---------------------------------------------------------------------------------------------

-- Checks answers as the business defines them and returns what to store. Only answers that
-- changed are judged (history stays as it was); each must belong to a field in use today, be its
-- kind, and point only at this business's people, projects and vehicles that the caller can see.
-- With `must_answer`, every required field in use needs an answer.
create or replace function private.validate_custom(
  space uuid, applies text, before jsonb, after jsonb, must_answer boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  field public.custom_fields;
  answer jsonb;
  field_key text;
  ref uuid;
  txt text;
begin
  before := coalesce(before, '{}'::jsonb);
  if after is null then after := '{}'::jsonb; end if;
  if jsonb_typeof(after) <> 'object' then
    raise exception 'Those answers aren’t in a form Hyphy understands.';
  end if;
  -- An empty answer is no answer.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into after
  from jsonb_each(after) e where e.value not in ('null'::jsonb, '""'::jsonb);

  for field_key in select k from jsonb_object_keys(after) k union select k from jsonb_object_keys(before) k loop
    if (after -> field_key) is not distinct from (before -> field_key) then continue; end if;
    select * into field from public.custom_fields f
    where f.space_id = space and f.applies_to = applies and f.key = field_key;
    if not found then
      raise exception 'That field isn’t part of this business.';
    end if;
    if field.archived_at is not null then
      raise exception '% is no longer used here, so it can’t be changed.', field.label;
    end if;
    answer := after -> field_key;
    if answer is null then continue; end if; -- cleared
    txt := answer #>> '{}';
    case field.type
      when 'text' then
        if jsonb_typeof(answer) <> 'string' or char_length(txt) > 200 then
          raise exception '%: keep it under 200 characters.', field.label;
        end if;
      when 'number', 'currency' then
        if jsonb_typeof(answer) <> 'number' or abs(txt::numeric) >= 1e12 then
          raise exception '%: enter a number.', field.label;
        end if;
      when 'boolean' then
        if jsonb_typeof(answer) <> 'boolean' then
          raise exception '%: choose yes or no.', field.label;
        end if;
      when 'date' then
        if jsonb_typeof(answer) <> 'string' or txt !~ '^\d{4}-\d{2}-\d{2}' then
          raise exception '%: enter a date.', field.label;
        end if;
        begin
          perform txt::timestamptz;
        exception when others then
          raise exception '%: enter a date.', field.label;
        end;
      when 'select' then
        if jsonb_typeof(answer) <> 'string' or not field.options @> jsonb_build_array(txt) then
          raise exception '%: choose one of the options.', field.label;
        end if;
      when 'person', 'project', 'vehicle', 'file' then
        if jsonb_typeof(answer) <> 'string'
           or txt !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          raise exception '%: choose one from the list.', field.label;
        end if;
        ref := txt::uuid;
        if (field.type = 'person' and not exists (
              select 1 from public.space_members m
              where m.space_id = space and m.person_id = ref and m.status = 'active'))
           or (field.type = 'project' and not exists (
              select 1 from public.projects p where p.id = ref and p.space_id = space
                and (me is null or public.can_see_project(p.id))))
           or (field.type = 'vehicle' and not exists (
              select 1 from public.vehicles v where v.id = ref and v.space_id = space
                and (me is null or (public.role_in(space) <> 'guest'
                     and (public.can(space, 'vehicles.view_all') or v.assigned_to = me)))))
           or (field.type = 'file' and not exists (
              select 1 from public.files f where f.id = ref and f.space_id = space
                and (me is null or public.can_see_file(f.id)))) then
          raise exception '%: choose one from the list.', field.label;
        end if;
    end case;
  end loop;

  if must_answer then
    -- A field whose kind needs a tool that's off (a Truck field without Vehicles) isn't asked for.
    for field in select f.* from public.custom_fields f join public.spaces s on s.id = f.space_id
      where f.space_id = space and f.applies_to = applies and f.archived_at is null and f.required
        and (f.type <> 'project' or 'projects' = any (s.modules))
        and (f.type <> 'vehicle' or 'vehicles' = any (s.modules))
      order by f.position loop
      if not after ? field.key then
        raise exception '% is required.', field.label;
      end if;
    end loop;
  end if;
  return after;
end;
$$;

create or replace function private.guard_custom_values()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  applies text := case tg_table_name
    when 'projects' then 'projects' when 'vehicles' then 'vehicles'
    when 'receipts' then 'receipts' else 'mileage' end;
  submission boolean := tg_table_name in ('receipts', 'mileage_entries');
  f jsonb := to_jsonb(new);
  must boolean;
begin
  if public.seeding() then return new; end if;
  if tg_op = 'INSERT' then
    -- Drafts may be unfinished; anything sent, and every new project or vehicle, is complete.
    must := not submission or (f ->> 'status') <> 'draft';
    new.custom := private.validate_custom(new.space_id, applies, '{}'::jsonb, new.custom, must);
    return new;
  end if;
  -- Sent (again) by the person it belongs to: complete under today's fields. A reviewer's decision
  -- on an older submission is never re-judged against fields added since.
  must := case when submission
    then (to_jsonb(old) ->> 'status') in ('draft', 'returned') and (f ->> 'status') in ('submitted', 'approved')
         and new.created_by = auth.uid()
    else new.custom is distinct from old.custom end;
  if must or new.custom is distinct from old.custom then
    new.custom := private.validate_custom(new.space_id, applies, old.custom, new.custom, must);
  end if;
  return new;
end;
$$;
create trigger projects_custom_checked before insert or update on public.projects
  for each row execute function private.guard_custom_values();
create trigger vehicles_custom_checked before insert or update on public.vehicles
  for each row execute function private.guard_custom_values();
create trigger receipts_custom_checked before insert or update on public.receipts
  for each row execute function private.guard_custom_values();
create trigger mileage_custom_checked before insert or update on public.mileage_entries
  for each row execute function private.guard_custom_values();

-- The business's own rules for receipts and trips, when one is sent. Mirrors submissionProblem
-- in src/lib/platform/business-settings.ts. Rules about a tool that's off ask for nothing.
create or replace function private.check_submission_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := to_jsonb(new);
  receipt boolean := tg_table_name = 'receipts';
  rules jsonb;
  space_row public.spaces;
  word text;
begin
  if public.seeding() then return new; end if;
  if not ((tg_op = 'INSERT' and (f ->> 'status') <> 'draft')
          or (tg_op = 'UPDATE' and (to_jsonb(old) ->> 'status') in ('draft', 'returned')
              and (f ->> 'status') in ('submitted', 'approved') and new.created_by = auth.uid())) then
    return new;
  end if;
  select * into space_row from public.spaces s where s.id = new.space_id;
  if space_row.kind <> 'business' then return new; end if;
  select ss.settings -> (case when receipt then 'receipts' else 'mileage' end) into rules
  from public.space_settings ss where ss.space_id = new.space_id;
  rules := coalesce(rules, '{}'::jsonb);
  word := lower(coalesce(space_row.labels -> 'projects' ->> 'singular',
                         case space_row.work_style when 'events' then 'event' else 'project' end));
  if (rules ->> 'requireProject')::boolean and 'projects' = any (space_row.modules)
     and new.project_id is null then
    raise exception 'Choose the % this % is for.', word, case when receipt then 'receipt' else 'trip' end;
  end if;
  if receipt then
    if (rules ->> 'requireVehicle')::boolean and 'vehicles' = any (space_row.modules)
       and new.vehicle_id is null
       and exists (select 1 from public.vehicles v where v.space_id = new.space_id
                   and (v.assigned_to = new.created_by or public.can(new.space_id, 'vehicles.view_all'))) then
      raise exception 'Choose the vehicle this receipt is for.';
    end if;
    if (rules ->> 'allowPersonal')::boolean is false and (f ->> 'payment_method') ~* '^\s*personal\M' then
      raise exception 'This business doesn’t pay back personal expenses. Use a company card.';
    end if;
  else
    if (rules ->> 'requirePurpose')::boolean and btrim(coalesce(f ->> 'purpose', '')) = '' then
      raise exception 'Add what the trip was for.';
    end if;
    if (rules ->> 'allowPersonalVehicles')::boolean is false and 'vehicles' = any (space_row.modules)
       and new.vehicle_id is null then
      raise exception 'Trips here are logged in a company vehicle.';
    end if;
  end if;
  return new;
end;
$$;
create trigger receipts_rules_checked before insert or update on public.receipts
  for each row execute function private.check_submission_rules();
create trigger mileage_rules_checked before insert or update on public.mileage_entries
  for each row execute function private.check_submission_rules();

-- A person's answers to the business's People fields: people managers only, checked like any other.
create or replace function public.set_member_fields(space uuid, person uuid, answers jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current jsonb;
begin
  if not public.can(space, 'people.manage') then
    raise exception 'Your role in this Space can’t change that.' using errcode = '42501';
  end if;
  select m.custom into current from public.space_members m
  where m.space_id = space and m.person_id = person and m.status <> 'removed'
  for update;
  if not found then
    raise exception 'That person isn’t part of this business.';
  end if;
  update public.space_members
     set custom = private.validate_custom(space, 'people', current, answers, true)
   where space_id = space and person_id = person;
end;
$$;

-- 4 ---------------------------------------------------------------------------------------------

-- Managers approve unless the business says only owners and admins do. Mirrors roles.ts.
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
      and (permission <> 'expenses.approve' or coalesce((
        select ss.settings -> 'approvals' ->> 'approvers' from space_settings ss
        where ss.space_id = space), 'managers') <> 'admins')
    when 'member' then permission = any (array['people.view', 'expenses.submit', 'files.upload', 'tools.use'])
    when 'guest' then permission = 'files.upload'
  end, false)
$$;

-- Whether a receipt or trip needs a decision before it counts. Personal Spaces never do. Answers
-- "yes" to anyone who isn't a member, so it tells outsiders nothing.
create or replace function public.needs_approval(space uuid, kind text, amount numeric)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when not public.is_member(space) then true
    when (select s.kind from public.spaces s where s.id = space) <> 'business' then false
    else coalesce((
      select case rule ->> 'mode'
        when 'never' then false
        when 'over' then coalesce(amount, 0) > (rule ->> 'over')::numeric
        else true end
      from public.space_settings ss,
           lateral (select ss.settings -> (case kind when 'receipt' then 'receipts' else 'mileage' end)
                           -> 'approval' as rule) r
      where ss.space_id = space and r.rule is not null), true)
  end
$$;
revoke execute on function public.needs_approval(uuid, text, numeric) from public, anon;
grant execute on function public.needs_approval(uuid, text, numeric) to authenticated;

-- A member may file straight through only what needs no approval, and only with no reviewer.
drop policy "Submit your own receipts" on public.receipts;
create policy "Submit your own receipts" on public.receipts
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')
         or (status = 'approved' and reviewed_by is null and not needs_approval(space_id, 'receipt', total)))
    and (project_id is null or can_see_project(project_id))
    and (vehicle_id is null or exists (select 1 from vehicles v where v.id = vehicle_id))
  );
drop policy "Log your own trips" on public.mileage_entries;
create policy "Log your own trips" on public.mileage_entries
  for insert to authenticated with check (
    created_by = auth.uid() and can(space_id, 'expenses.submit')
    and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')
         or (status = 'approved' and reviewed_by is null and not needs_approval(space_id, 'mileage', miles)))
    and (project_id is null or can_see_project(project_id))
    and (vehicle_id is null or exists (select 1 from vehicles v where v.id = vehicle_id))
  );
drop policy "Fix and resend your own; reviewers decide on others'" on public.receipts;
create policy "Fix and resend your own; reviewers decide on others'" on public.receipts
  for update to authenticated using (
    (created_by = auth.uid() and status in ('draft', 'returned'))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  ) with check (
    (created_by = auth.uid() and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')
      or (status = 'approved' and reviewed_by is null and not needs_approval(space_id, 'receipt', total))))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  );
drop policy "Fix and resend your own trips; reviewers decide on others'" on public.mileage_entries;
create policy "Fix and resend your own trips; reviewers decide on others'" on public.mileage_entries
  for update to authenticated using (
    (created_by = auth.uid() and status in ('draft', 'returned'))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  ) with check (
    (created_by = auth.uid() and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')
      or (status = 'approved' and reviewed_by is null and not needs_approval(space_id, 'mileage', miles))))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  );

-- The review guard, with one addition: the submitter may file their own fix straight through when
-- the business needs no approval for it — never as their own approver.
create or replace function public.guard_review()
returns trigger language plpgsql set search_path = public as $$
declare
  amount numeric := case tg_table_name
    when 'receipts' then (to_jsonb(new) ->> 'total')::numeric
    else (to_jsonb(new) ->> 'miles')::numeric end;
begin
  if seeding() or auth.uid() is null then return new; end if;
  if new.created_by <> old.created_by or new.space_id <> old.space_id then
    raise exception 'A submission keeps its owner and Space.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'returned')
     and new.created_by = auth.uid() and not can(new.space_id, 'expenses.approve')
     and not (new.status = 'approved' and old.status in ('draft', 'returned')
              and new.reviewed_by is null
              and not needs_approval(new.space_id, case tg_table_name when 'receipts' then 'receipt' else 'mileage' end, amount)) then
    raise exception 'Someone else approves your own submissions.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status in ('approved', 'returned')
     and old.status <> 'submitted' and new.created_by <> auth.uid() then
    raise exception 'That one has already been decided.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 5 ---------------------------------------------------------------------------------------------

create or replace function private.field_noun(applies text) returns text
language sql immutable set search_path = '' as $$
  select case applies when 'projects' then 'project' when 'vehicles' then 'vehicle'
    when 'receipts' then 'receipt' when 'mileage' then 'trip' else 'person' end
$$;

-- "Dana added required receipt field “Cost Code”" — the same lines Demo Mode writes
-- (src/lib/data/demo/config-apply.ts).
create or replace function private.log_custom_field()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  name text := private.field_noun(new.applies_to) || ' field “' || new.label || '”';
  actor uuid := coalesce(auth.uid(), new.created_by);
begin
  if actor is null then return new; end if;
  if tg_op = 'INSERT' then
    perform public.write_activity(new.space_id, actor, 'added', 'setting', new.space_id,
      case when new.required then 'required ' else '' end || name);
  elsif (old.archived_at is null) <> (new.archived_at is null) then
    perform public.write_activity(new.space_id, actor,
      case when new.archived_at is null then 'added' else 'archived' end, 'setting', new.space_id, name);
  elsif old.required <> new.required then
    perform public.write_activity(new.space_id, actor, 'changed', 'setting', new.space_id, name,
      null, null, case when new.required then 'Now required' else 'Now optional' end);
  end if;
  return new;
end;
$$;
create trigger custom_fields_logged after insert or update on public.custom_fields
  for each row execute function private.log_custom_field();

create or replace function private.log_space_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  before jsonb := case when tg_op = 'UPDATE' then old.settings else '{}'::jsonb end;
  actor uuid := coalesce(auth.uid(), new.updated_by);
begin
  if actor is null then return new; end if;
  if coalesce(before -> 'receipts', '{}') is distinct from coalesce(new.settings -> 'receipts', '{}') then
    perform public.write_activity(new.space_id, actor, 'changed', 'setting', new.space_id, 'the receipt rules');
  end if;
  if coalesce(before -> 'mileage', '{}') is distinct from coalesce(new.settings -> 'mileage', '{}') then
    perform public.write_activity(new.space_id, actor, 'changed', 'setting', new.space_id, 'the mileage rules');
  end if;
  if coalesce(before -> 'approvals', '{}') is distinct from coalesce(new.settings -> 'approvals', '{}') then
    perform public.write_activity(new.space_id, actor, 'changed', 'setting', new.space_id, 'who approves');
  end if;
  return new;
end;
$$;
create trigger space_settings_logged after insert or update on public.space_settings
  for each row execute function private.log_space_settings();

create or replace function private.log_space_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then return new; end if;
  if new.mileage_rate is distinct from old.mileage_rate and new.mileage_rate is not null then
    perform public.write_activity(new.id, actor, 'changed', 'setting', new.id, 'the mileage rate',
      null, null, to_char(new.mileage_rate, 'FM$990.00') || ' a mile');
  end if;
  if new.labels is distinct from old.labels then
    perform public.write_activity(new.id, actor, 'changed', 'setting', new.id, 'the words this business uses');
  end if;
  if new.business_type is distinct from old.business_type then
    perform public.write_activity(new.id, actor, 'changed', 'setting', new.id, 'the kind of business');
  end if;
  return new;
end;
$$;
create trigger spaces_setup_logged after update of mileage_rate, labels, business_type on public.spaces
  for each row execute function private.log_space_setup();

-- The words and the mark a business chooses: a known shape, short words, a readable mark.
create or replace function private.check_space_identity()
returns trigger language plpgsql set search_path = '' as $$
declare
  term text;
begin
  if public.seeding() then return new; end if;
  if jsonb_typeof(new.labels) <> 'object' then
    raise exception 'Unknown words.';
  end if;
  for term in select jsonb_object_keys(new.labels) loop
    if term not in ('projects', 'vehicles', 'customer')
       or jsonb_typeof(new.labels -> term -> 'singular') <> 'string'
       or jsonb_typeof(new.labels -> term -> 'plural') <> 'string'
       or char_length(new.labels -> term ->> 'singular') not between 1 and 30
       or char_length(new.labels -> term ->> 'plural') not between 1 and 30
       or (select count(*) from jsonb_object_keys(new.labels -> term)) <> 2 then
      raise exception 'Choose the words from the list.';
    end if;
  end loop;
  if coalesce(new.brand ->> 'color', '') !~ '^#[0-9A-Fa-f]{6}$'
     or coalesce(new.brand ->> 'ink', '') not in ('light', 'dark')
     or char_length(coalesce(new.brand ->> 'monogram', '')) not between 1 and 3 then
    raise exception 'Choose one of the accent colors.';
  end if;
  return new;
end;
$$;
create trigger spaces_identity_checked before update of labels, brand on public.spaces
  for each row execute function private.check_space_identity();
alter table public.spaces add constraint spaces_mileage_rate_range
  check (mileage_rate is null or (mileage_rate > 0 and mileage_rate <= 5));

-- Grants ----------------------------------------------------------------------------------------

revoke execute on function public.set_member_fields(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_member_fields(uuid, uuid, jsonb) to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke truncate, trigger, references on public.space_settings, public.custom_fields from anon, authenticated;
