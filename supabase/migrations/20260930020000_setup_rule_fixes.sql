-- Hyphy Tools — two fixes to the business-setup checks (Phase 2C review).
--
-- 1. "A job on every receipt / trip" only asks people who have a job to pick. Someone who can't
--    see any project (a new business, or a member on no project's team) has no picker in the
--    form; the rule no longer leaves them unable to send anything. The vehicle rule already
--    worked this way.
-- 2. The words and accent checks look only at what changes. Before, changing the words also
--    re-checked the accent (and the other way round), so a business whose accent predated the
--    curated list — or was set by a direct `create_business` call — couldn't save its words.
--    Words are now checked when a Space is created, too.

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
     and new.project_id is null
     and exists (select 1 from public.projects p
                 where p.space_id = new.space_id and public.can_see_project(p.id)) then
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

create or replace function private.check_space_identity()
returns trigger language plpgsql set search_path = '' as $$
declare
  term text;
begin
  if public.seeding() then return new; end if;
  if tg_op = 'INSERT' or new.labels is distinct from old.labels then
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
  end if;
  if tg_op = 'UPDATE' and new.brand is distinct from old.brand
     and (coalesce(new.brand ->> 'color', '') !~ '^#[0-9A-Fa-f]{6}$'
          or coalesce(new.brand ->> 'ink', '') not in ('light', 'dark')
          or char_length(coalesce(new.brand ->> 'monogram', '')) not between 1 and 3) then
    raise exception 'Choose one of the accent colors.';
  end if;
  return new;
end;
$$;
drop trigger spaces_identity_checked on public.spaces;
create trigger spaces_identity_checked before insert or update of labels, brand on public.spaces
  for each row execute function private.check_space_identity();

revoke execute on function private.check_submission_rules(), private.check_space_identity()
  from public, anon, authenticated;
