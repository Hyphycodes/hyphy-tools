-- Hyphy Tools — Business customization (supabase/migrations/20260930000000_business_customization.sql
-- and 20260930010000_mileage_rate_snapshot.sql),
-- against the seeded development world.
--
-- The ABC Construction people set their business up and try everything they shouldn't: another
-- business's fields, answers that aren't allowed, fields they stopped using, rules they don't own,
-- approving their own work. One transaction, always rolled back; the report is the final error
-- message ("CUSTOMIZATION PASSED" or "CUSTOMIZATION FAILED: …").

create or replace function pg_temp.did(key text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('hyphy-demo:' || key, 'UTF8')), 'hex') as h) x
$$;
create or replace function pg_temp.as_person(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', person::text, true);
$$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', true),
         set_config('request.jwt.claims', '', true),
         set_config('request.jwt.claim.sub', '', true);
$$;
-- The statement's error, or null when it ran.
create or replace function pg_temp.error_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlerrm;
end $$;
-- How many rows a statement changed (0 when Row Level Security quietly said no).
create or replace function pg_temp.changed(statement text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end $$;
create or replace function pg_temp.receipt(space uuid, person uuid, extra text) returns text language sql as $$
  select format($f$insert into public.receipts (space_id, created_by, vendor, category, total, date, status %s)
                   values (%L, %L, 'Menards', 'materials', 42.10, now(), 'submitted' %s)$f$,
                split_part(extra, '|', 1), space, person, split_part(extra, '|', 2))
$$;

do $customization$
declare
  failures text[] := '{}';
  checks int := 0;
  dana uuid := pg_temp.did('dana');
  luis uuid := pg_temp.did('luis');
  ray uuid := pg_temp.did('ray');
  mike uuid := pg_temp.did('mike');
  tasha uuid := pg_temp.did('tasha');
  andre uuid := pg_temp.did('andre');
  chris uuid := pg_temp.did('chris');
  jerry uuid := pg_temp.did('jerry');
  abc uuid := pg_temp.did('sp_abc');
  hyphy uuid := pg_temp.did('sp_hyphy');
  oakbrook uuid := pg_temp.did('prj_oakbrook');
  hyphy_project uuid := pg_temp.did('prj_hy_tools');
  truck24 uuid := pg_temp.did('veh_t24');
  truck17 uuid := pg_temp.did('veh_t17');
  old_receipt uuid := pg_temp.did('rc_abc_01');
  tasha_receipt uuid := pg_temp.did('rc_abc_03');
  n bigint;
  err text;
  waiting uuid;
  paid numeric;
begin
  -- A. Who configures ----------------------------------------------------------------------------
  perform pg_temp.as_person(dana);
  err := pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, options, required, position, created_by)
    values (%L, 'receipts', 'cost_code', 'Cost Code', 'select',
            '["100 — General", "200 — Materials", "300 — Equipment"]', true, 0, %L)$$, abc, dana));
  checks := checks + 1;
  if err is not null then failures := failures || ('Dana could not add Cost Code: ' || err); end if;
  select count(*) into n from activity where space_id = abc and actor_id = dana and verb = 'added'
    and object_type = 'setting' and object_label = 'required receipt field “Cost Code”';
  checks := checks + 1;
  if n <> 1 then failures := failures || 'Adding a required field wrote no activity line'::text; end if;
  err := pg_temp.error_of(format($$insert into space_settings (space_id, settings)
    values (%L, '{"receipts": {"requireProject": true, "requireVehicle": true}}')$$, abc));
  checks := checks + 1;
  if err is not null then failures := failures || ('Dana could not set receipt rules: ' || err); end if;

  perform pg_temp.as_person(luis);
  checks := checks + 1;
  if pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'projects', 'job_number', 'Job Number', 'text', 3, %L)$$, abc, luis)) is not null then
    failures := failures || 'An admin could not add a field'::text;
  end if;

  perform pg_temp.as_person(mike);
  select count(*) into n from custom_fields where space_id = abc and applies_to = 'receipts' and archived_at is null;
  checks := checks + 1;
  if n <> 1 then failures := failures || 'An employee can’t read the fields his receipts need'::text; end if;
  select count(*) into n from space_settings where space_id = abc;
  checks := checks + 1;
  if n <> 1 then failures := failures || 'An employee can’t read the rules his receipts follow'::text; end if;
  checks := checks + 4;
  if pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'receipts', 'tip', 'Tip', 'currency', 5, %L)$$, abc, mike)) is null then
    failures := failures || 'An employee added a field'::text;
  end if;
  if pg_temp.changed(format($$update custom_fields set required = false where space_id = %L and key = 'cost_code'$$, abc)) > 0 then
    failures := failures || 'An employee changed a field'::text;
  end if;
  if pg_temp.changed(format($$delete from custom_fields where space_id = %L and key = 'job_number'$$, abc)) > 0 then
    failures := failures || 'An employee removed a field'::text;
  end if;
  if pg_temp.changed(format($$update space_settings set settings = '{}' where space_id = %L$$, abc)) > 0 then
    failures := failures || 'An employee changed the business rules'::text;
  end if;

  perform pg_temp.as_person(ray);
  checks := checks + 2;
  if pg_temp.changed(format($$update custom_fields set label = 'Code' where space_id = %L and key = 'cost_code'$$, abc)) > 0 then
    failures := failures || 'A manager changed a field (configuring is for owners and admins)'::text;
  end if;
  if pg_temp.changed(format($$update space_settings set settings = '{}' where space_id = %L$$, abc)) > 0 then
    failures := failures || 'A manager changed the business rules'::text;
  end if;

  perform pg_temp.as_person(chris);
  select count(*) into n from custom_fields where space_id = abc and applies_to <> 'projects';
  checks := checks + 1;
  if n <> 0 then failures := failures || 'A guest read fields for records he can’t reach'::text; end if;
  select count(*) into n from custom_fields where space_id = abc and applies_to = 'projects';
  checks := checks + 1;
  if n = 0 then failures := failures || 'A guest can’t read the fields of his shared projects'::text; end if;
  select count(*) into n from space_settings where space_id = abc;
  checks := checks + 1;
  if n <> 0 then failures := failures || 'A guest read the business rules'::text; end if;

  -- B. Businesses are sealed ---------------------------------------------------------------------
  perform pg_temp.as_person(dana);
  select count(*) into n from custom_fields where space_id = hyphy;
  checks := checks + 1;
  if n <> 0 then failures := failures || 'ABC’s owner read Hyphy LLC’s fields'::text; end if;
  checks := checks + 2;
  if pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'receipts', 'sneaky', 'Sneaky', 'text', 0, %L)$$, hyphy, dana)) is null then
    failures := failures || 'ABC’s owner added a field to Hyphy LLC'::text;
  end if;
  if pg_temp.error_of(format($$insert into space_settings (space_id, settings) values (%L, '{}')$$, hyphy)) is null then
    failures := failures || 'ABC’s owner set Hyphy LLC’s rules'::text;
  end if;

  perform pg_temp.as_person(jerry);
  err := pg_temp.error_of(pg_temp.receipt(hyphy, jerry, ', custom|, ''{"cost_code": "200 — Materials"}'''));
  checks := checks + 1;
  if err is null or err not like '%isn’t part of this business%' then
    failures := failures || ('Hyphy LLC used ABC’s Cost Code: ' || coalesce(err, 'saved'));
  end if;
  select count(*) into n from space_settings where space_id = abc;
  checks := checks + 1;
  if n <> 0 then failures := failures || 'A guest of ABC (Jerry) read ABC’s rules'::text; end if;

  -- C. Answers are checked ------------------------------------------------------------------------
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(pg_temp.receipt(abc, mike,
    format(', project_id, vehicle_id|, %L, %L', oakbrook, truck24)));
  checks := checks + 1;
  if err is null or err not like '%Cost Code is required%' then
    failures := failures || ('A required field could be left blank: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike,
    format(', project_id, vehicle_id, custom|, %L, %L, ''{"cost_code": "400 — Snacks"}''', oakbrook, truck24)));
  checks := checks + 1;
  if err is null or err not like '%choose one of the options%' then
    failures := failures || ('A dropdown took a choice it doesn’t have: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike,
    format(', project_id, vehicle_id, custom|, %L, %L, ''{"cost_code": "200 — Materials", "made_up": "x"}''', oakbrook, truck24)));
  checks := checks + 1;
  if err is null then failures := failures || 'An answer to a field that doesn’t exist was saved'::text; end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike,
    format(', project_id, vehicle_id, custom|, %L, %L, ''{"cost_code": 200}''', oakbrook, truck24)));
  checks := checks + 1;
  if err is null then failures := failures || 'A dropdown took a number'::text; end if;
  -- The good one.
  err := pg_temp.error_of(pg_temp.receipt(abc, mike,
    format(', project_id, vehicle_id, custom|, %L, %L, ''{"cost_code": "200 — Materials"}''', oakbrook, truck24)));
  checks := checks + 1;
  if err is not null then failures := failures || ('Mike couldn’t submit a complete receipt: ' || err); end if;
  -- Drafts may be unfinished; sending one makes it complete.
  err := pg_temp.error_of(format($$insert into public.receipts (id, space_id, created_by, vendor, category, total, date, status)
    values ('00000000-0000-4000-8000-00000000d7af', %L, %L, 'Draft Co', 'other', 5, now(), 'draft')$$, abc, mike));
  checks := checks + 1;
  if err is not null then failures := failures || ('An unfinished draft was refused: ' || err); end if;
  err := pg_temp.error_of($$update receipts set status = 'submitted' where id = '00000000-0000-4000-8000-00000000d7af'$$);
  checks := checks + 1;
  if err is null then failures := failures || 'A draft was sent without its required answers'::text; end if;
  err := pg_temp.error_of(format($$update receipts set status = 'submitted', project_id = %L, vehicle_id = %L,
      custom = '{"cost_code": "100 — General"}' where id = '00000000-0000-4000-8000-00000000d7af'$$, oakbrook, truck24));
  checks := checks + 1;
  if err is not null then failures := failures || ('A finished draft couldn’t be sent: ' || err); end if;
  -- Someone else's receipt: Row Level Security doesn't let him touch it.
  checks := checks + 1;
  if pg_temp.changed(format($$update receipts set custom = '{"cost_code": "300 — Equipment"}' where id = %L$$, tasha_receipt)) > 0 then
    failures := failures || 'Mike changed an answer on Tasha’s receipt'::text;
  end if;
  checks := checks + 1;
  if pg_temp.changed(format($$update projects set custom = custom || '{"permit": "X"}' where id = %L$$, oakbrook)) > 0 then
    failures := failures || 'An employee changed a project’s answers'::text;
  end if;

  -- References: only this business's, only what the person can see.
  perform pg_temp.as_person(dana);
  perform pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'receipts', 'truck_used', 'Truck used', 'vehicle', 1, %L)$$, abc, dana));
  perform pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'projects', 'foreman', 'Foreman', 'person', 4, %L)$$, abc, dana));
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, vehicle_id, custom|, %L, %L, %L',
    oakbrook, truck24, json_build_object('cost_code', '200 — Materials', 'truck_used', truck17)::text)));
  checks := checks + 1;
  if err is null then failures := failures || 'Mike pointed at a truck he can’t see'::text; end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, vehicle_id, custom|, %L, %L, %L',
    oakbrook, truck24, json_build_object('cost_code', '200 — Materials', 'truck_used', gen_random_uuid())::text)));
  checks := checks + 1;
  if err is null then failures := failures || 'A made-up vehicle id was saved'::text; end if;
  perform pg_temp.as_person(luis);
  err := pg_temp.error_of(format($$update vehicles set custom = custom || %L where id = %L$$,
    json_build_object('home_site', hyphy_project)::text, truck24));
  checks := checks + 1;
  if err is null then failures := failures || 'A truck’s job site pointed at another business’s project'::text; end if;
  err := pg_temp.error_of(format($$update projects set custom = custom || %L where id = %L$$,
    json_build_object('foreman', pg_temp.did('rosa'))::text, oakbrook));
  checks := checks + 1;
  if err is null then failures := failures || 'A Foreman from another business was saved'::text; end if;
  err := pg_temp.error_of(format($$update projects set custom = custom || %L where id = %L$$,
    json_build_object('foreman', mike, 'job_number', '24-184')::text, oakbrook));
  checks := checks + 1;
  if err is not null then failures := failures || ('An admin couldn’t fill in Foreman and Job Number: ' || err); end if;

  -- D. The lifecycle keeps history safe ------------------------------------------------------------
  perform pg_temp.as_person(dana);
  checks := checks + 1;
  if pg_temp.error_of(format($$update custom_fields set type = 'text', options = '[]' where space_id = %L and key = 'cost_code'$$, abc)) is null then
    failures := failures || 'A used field changed its kind'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$update custom_fields set options = '["100 — General", "300 — Equipment"]' where space_id = %L and key = 'cost_code'$$, abc)) is null then
    failures := failures || 'A used choice was taken away'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$update custom_fields set options = '["100 — General", "200 — Materials", "300 — Equipment", "400 — Subs"]' where space_id = %L and key = 'cost_code'$$, abc)) is not null then
    failures := failures || 'A used dropdown couldn’t gain a choice'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$delete from custom_fields where space_id = %L and key = 'cost_code'$$, abc)) is null then
    failures := failures || 'A field with saved answers was deleted'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$update custom_fields set key = 'code' where space_id = %L and key = 'cost_code'$$, abc)) is null then
    failures := failures || 'A field’s key changed'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'receipts', 'cost_code_2', 'cost code', 'text', 9, %L)$$, abc, dana)) is null then
    failures := failures || 'Two fields got the same name'::text;
  end if;
  checks := checks + 1;
  if pg_temp.error_of(format($$insert into custom_fields (space_id, applies_to, key, label, type, position, created_by)
      values (%L, 'receipts', 'scan', 'Scan', 'file', 9, %L)$$, abc, dana)) is null then
    failures := failures || 'A file field was added before file storage exists'::text;
  end if;
  -- A field nothing used can go; one that was used can only stop being asked for.
  checks := checks + 1;
  if pg_temp.changed(format($$delete from custom_fields where space_id = %L and key = 'truck_used'$$, abc)) <> 1 then
    failures := failures || 'An unused field couldn’t be removed'::text;
  end if;
  checks := checks + 1;
  if pg_temp.changed(format($$update custom_fields set archived_at = now() where space_id = %L and key = 'cost_code'$$, abc)) <> 1 then
    failures := failures || 'A field couldn’t be stopped'::text;
  end if;
  select count(*) into n from activity where space_id = abc and verb = 'archived'
    and object_label = 'receipt field “Cost Code”';
  checks := checks + 1;
  if n <> 1 then failures := failures || 'Stopping a field wrote no activity line'::text; end if;
  select count(*) into n from receipts where space_id = abc and custom ? 'cost_code';
  checks := checks + 1;
  if n < 2 then failures := failures || 'Stopping a field lost saved answers'::text; end if;
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, vehicle_id, custom|, %L, %L, ''{"cost_code": "100 — General"}''',
    oakbrook, truck24)));
  checks := checks + 1;
  if err is null or err not like '%no longer used%' then
    failures := failures || ('An answer to a stopped field was saved: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, vehicle_id|, %L, %L', oakbrook, truck24)));
  checks := checks + 1;
  if err is not null then failures := failures || ('A stopped field was still required: ' || err); end if;

  -- History isn't re-judged: an old receipt is approved though a new required field exists.
  perform pg_temp.as_person(dana);
  perform pg_temp.error_of(format($$update custom_fields set archived_at = null where space_id = %L and key = 'cost_code'$$, abc));
  err := pg_temp.error_of(format($$update receipts set status = 'approved', reviewed_by = %L, reviewed_at = now() where id = %L$$, dana, old_receipt));
  checks := checks + 1;
  if err is not null then failures := failures || ('An old receipt couldn’t be approved after a field was added: ' || err); end if;

  -- E. The business's rules ---------------------------------------------------------------------
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', vehicle_id, custom|, %L, ''{"cost_code": "100 — General"}''', truck24)));
  checks := checks + 1;
  if err is null or err not like '%project this receipt is for%' then
    failures := failures || ('A receipt went in without the required project: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, custom|, %L, ''{"cost_code": "100 — General"}''', oakbrook)));
  checks := checks + 1;
  if err is null or err not like '%vehicle this receipt is for%' then
    failures := failures || ('A receipt went in without the required vehicle: ' || coalesce(err, 'saved'));
  end if;
  -- Andre has no vehicle to pick, so the vehicle rule doesn't stop him.
  perform pg_temp.as_person(andre);
  err := pg_temp.error_of(pg_temp.receipt(abc, andre, format(', project_id, custom|, %L, ''{"cost_code": "100 — General"}''',
    pg_temp.did('prj_oak1845'))));
  checks := checks + 1;
  if err is not null then failures := failures || ('Someone without a vehicle was asked for one: ' || err); end if;
  -- Nor does the project rule stop someone who can't see any project (their form has none).
  perform pg_temp.as_admin();
  update projects set team_ids = array_remove(team_ids, andre),
         lead_id = case when lead_id = andre then dana else lead_id end
   where space_id = abc;
  perform pg_temp.as_person(andre);
  select count(*) into n from projects where space_id = abc;
  err := pg_temp.error_of(pg_temp.receipt(abc, andre, ', custom|, ''{"cost_code": "100 — General"}'''));
  checks := checks + 2;
  if n <> 0 then failures := failures || 'Andre still sees a project after leaving every team'::text; end if;
  if err is not null then failures := failures || ('Someone who can see no project was asked for one: ' || err); end if;
  -- Words are checked on their own: a mark from before the accent list doesn't block them.
  perform pg_temp.as_admin();
  perform set_config('hyphy.seeding', 'on', true);
  update spaces set brand = '{"color": "teal"}' where id = abc;
  perform set_config('hyphy.seeding', '', true);
  perform pg_temp.as_person(dana);
  err := pg_temp.error_of(format($$update spaces set labels = '{"projects": {"singular": "Job", "plural": "Jobs"}}' where id = %L$$, abc));
  checks := checks + 2;
  if err is not null then failures := failures || ('An old accent blocked saving the words: ' || err); end if;
  if pg_temp.error_of(format($$update spaces set labels = '{"projects": {"singular": "Job"}}' where id = %L$$, abc)) is null then
    failures := failures || 'Words of the wrong shape were saved'::text;
  end if;
  perform pg_temp.error_of(format($$update spaces set brand = '{"color": "#13784A", "ink": "light", "monogram": "AB"}' where id = %L$$, abc));

  perform pg_temp.as_person(dana);
  checks := checks + 3;
  if pg_temp.error_of(format($$update space_settings set settings = '{"receipts": {"requireProject": "yes"}}' where space_id = %L$$, abc)) is null then
    failures := failures || 'A rule took an answer that isn’t yes or no'::text;
  end if;
  if pg_temp.error_of(format($$update space_settings set settings = '{"payroll": {}}' where space_id = %L$$, abc)) is null then
    failures := failures || 'An unknown setting was stored'::text;
  end if;
  if pg_temp.error_of(format($$update space_settings set settings = '{"receipts": {"approval": {"mode": "over", "over": -5}}}' where space_id = %L$$, abc)) is null then
    failures := failures || 'A negative approval amount was stored'::text;
  end if;
  err := pg_temp.error_of(format($$update space_settings set settings = '{
      "receipts": {"requireProject": true, "allowPersonal": false, "approval": {"mode": "over", "over": 250}},
      "mileage": {"requirePurpose": true, "allowPersonalVehicles": false, "approval": {"mode": "never"}}}' where space_id = %L$$, abc));
  checks := checks + 1;
  if err is not null then failures := failures || ('Dana couldn’t save her rules: ' || err); end if;

  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(pg_temp.receipt(abc, mike, format(', project_id, payment_method, custom|, %L, ''Personal card (reimburse me)'', ''{"cost_code": "100 — General"}''', oakbrook)));
  checks := checks + 1;
  if err is null or err not like '%personal expenses%' then
    failures := failures || ('A personal expense went in where they aren’t paid back: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(format($$insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status)
    values (%L, %L, now(), 'Shop', 'Oak Brook', 12, '', %L, 'approved')$$, abc, mike, truck24));
  checks := checks + 1;
  if err is null or err not like '%what the trip was for%' then
    failures := failures || ('A trip went in without its required purpose: ' || coalesce(err, 'saved'));
  end if;
  err := pg_temp.error_of(format($$insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, status)
    values (%L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', 'approved')$$, abc, mike));
  checks := checks + 1;
  if err is null or err not like '%company vehicle%' then
    failures := failures || ('A personal-car trip went in where only company vehicles count: ' || coalesce(err, 'saved'));
  end if;

  -- F. Approvals follow the rules, and nobody approves themselves ----------------------------------
  -- Trips need no approval now: filed as approved, with no reviewer.
  err := pg_temp.error_of(format($$insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status)
    values (%L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', %L, 'approved')$$, abc, mike, truck24));
  checks := checks + 1;
  if err is not null then failures := failures || ('A trip that needs no approval couldn’t be filed: ' || err); end if;
  err := pg_temp.error_of(format($$insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status, reviewed_by)
    values (%L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', %L, 'approved', %L)$$, abc, mike, truck24, mike));
  checks := checks + 1;
  if err is null then failures := failures || 'Mike filed a trip as its own approver'::text; end if;
  err := pg_temp.error_of(format($$insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status, reviewed_by)
    values (%L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', %L, 'approved', %L)$$, abc, mike, truck24, dana));
  checks := checks + 1;
  if err is null then failures := failures || 'Mike filed a trip as approved by Dana'::text; end if;
  -- Receipts: $42 is under $250 and files straight through; $300 still waits.
  err := pg_temp.error_of(format($$insert into receipts (space_id, created_by, vendor, category, total, date, status, project_id, vehicle_id, custom)
    values (%L, %L, 'Menards', 'materials', 42.10, now(), 'approved', %L, %L, '{"cost_code": "100 — General"}')$$, abc, mike, oakbrook, truck24));
  checks := checks + 1;
  if err is not null then failures := failures || ('A receipt under the approval amount couldn’t be filed: ' || err); end if;
  err := pg_temp.error_of(format($$insert into receipts (space_id, created_by, vendor, category, total, date, status, project_id, vehicle_id, custom)
    values (%L, %L, 'Menards', 'materials', 300, now(), 'approved', %L, %L, '{"cost_code": "100 — General"}')$$, abc, mike, oakbrook, truck24));
  checks := checks + 1;
  if err is null then failures := failures || 'A receipt over the approval amount skipped approval'::text; end if;
  -- His own waiting receipt can't be approved by him, whatever the rules.
  select r.id into waiting from receipts r where r.created_by = mike and r.status = 'submitted' and r.space_id = abc limit 1;
  checks := checks + 1;
  if pg_temp.changed(format($$update receipts set status = 'approved' where id = %L$$, waiting)) > 0 then
    failures := failures || 'Mike approved his own receipt'::text;
  end if;

  -- Only owners and admins approve: managers stop, in the database too.
  perform pg_temp.as_person(dana);
  perform pg_temp.error_of(format($$update space_settings set settings = settings || '{"approvals": {"approvers": "admins"}}' where space_id = %L$$, abc));
  perform pg_temp.as_person(ray);
  checks := checks + 2;
  if public.can(abc, 'expenses.approve') then
    failures := failures || 'A manager still approves when only owners and admins do'::text;
  end if;
  if pg_temp.changed(format($$update receipts set status = 'approved', reviewed_by = %L where id = %L$$, ray, waiting)) > 0 then
    failures := failures || 'A manager approved when only owners and admins do'::text;
  end if;
  perform pg_temp.as_person(dana);
  checks := checks + 1;
  if not public.can(abc, 'expenses.approve') then
    failures := failures || 'The owner stopped approving'::text;
  end if;
  perform pg_temp.error_of(format($$update space_settings set settings = settings || '{"approvals": {"approvers": "managers"}}' where space_id = %L$$, abc));
  perform pg_temp.as_person(ray);
  checks := checks + 1;
  if not public.can(abc, 'expenses.approve') then
    failures := failures || 'Managers didn’t approve again when allowed'::text;
  end if;

  -- G. People fields -------------------------------------------------------------------------------
  perform pg_temp.as_person(luis);
  err := pg_temp.error_of(format($$select public.set_member_fields(%L, %L, '{"crew": "Framing", "osha10": true}')$$, abc, mike));
  checks := checks + 1;
  if err is not null then failures := failures || ('An admin couldn’t fill in a person’s crew: ' || err); end if;
  err := pg_temp.error_of(format($$select public.set_member_fields(%L, %L, '{"crew": "Roofing"}')$$, abc, mike));
  checks := checks + 1;
  if err is null then failures := failures || 'A crew that isn’t a choice was saved'::text; end if;
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(format($$select public.set_member_fields(%L, %L, '{"crew": "Office"}')$$, abc, mike));
  checks := checks + 1;
  if err is null then failures := failures || 'An employee changed his own People fields'::text; end if;

  -- H. A trip keeps the rate it was logged at ---------------------------------------------------
  -- ABC pays $0.70 a mile. The database stamps it on the trip; nobody picks their own.
  perform pg_temp.as_person(mike);
  err := pg_temp.error_of(format($$insert into mileage_entries (id, space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status, rate)
    values ('00000000-0000-4000-8000-0000000017a7', %L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', %L, 'draft', 4.99)$$, abc, mike, truck24));
  checks := checks + 1;
  if err is not null then failures := failures || ('Mike couldn’t log a trip: ' || err); end if;
  select rate into paid from mileage_entries where id = '00000000-0000-4000-8000-0000000017a7';
  checks := checks + 1;
  if paid is distinct from 0.7 then failures := failures || ('A trip took a rate of ' || coalesce(paid::text, 'none') || ', not the business’s $0.70'); end if;
  perform pg_temp.changed($$update mileage_entries set rate = 5 where id = '00000000-0000-4000-8000-0000000017a7'$$);
  select rate into paid from mileage_entries where id = '00000000-0000-4000-8000-0000000017a7';
  checks := checks + 1;
  if paid is distinct from 0.7 then failures := failures || 'Mike changed the rate on his own trip'::text; end if;
  -- Dana raises the rate: the trip already logged keeps $0.70; the next one gets $0.80.
  perform pg_temp.as_person(dana);
  perform pg_temp.error_of(format($$update spaces set mileage_rate = 0.8 where id = %L$$, abc));
  perform pg_temp.as_person(mike);
  select rate into paid from mileage_entries where id = '00000000-0000-4000-8000-0000000017a7';
  checks := checks + 1;
  if paid is distinct from 0.7 then failures := failures || 'A new rate re-priced a trip already logged'::text; end if;
  perform pg_temp.error_of(format($$insert into mileage_entries (id, space_id, created_by, date, "from", "to", miles, purpose, vehicle_id, status)
    values ('00000000-0000-4000-8000-0000000017a8', %L, %L, now(), 'Shop', 'Oak Brook', 12, 'Site visit', %L, 'draft')$$, abc, mike, truck24));
  select rate into paid from mileage_entries where id = '00000000-0000-4000-8000-0000000017a8';
  checks := checks + 1;
  if paid is distinct from 0.8 then failures := failures || 'A new trip didn’t get the new rate'::text; end if;

  -- I. A removed member keeps nothing ------------------------------------------------------------
  perform pg_temp.as_person(dana);
  perform public.remove_member(abc, tasha);
  perform pg_temp.as_person(tasha);
  select count(*) into n from custom_fields where space_id = abc;
  checks := checks + 1;
  if n <> 0 then failures := failures || 'A removed member still reads the business’s fields'::text; end if;
  select count(*) into n from space_settings where space_id = abc;
  checks := checks + 1;
  if n <> 0 then failures := failures || 'A removed member still reads the business’s rules'::text; end if;
  checks := checks + 1;
  if public.can(abc, 'expenses.submit') then
    failures := failures || 'A removed member can still submit'::text;
  end if;

  -- J. Nobody from outside ------------------------------------------------------------------------
  perform set_config('role', 'anon', true);
  checks := checks + 2;
  if pg_temp.error_of('select count(*) from public.custom_fields') is null then
    failures := failures || 'anon read custom fields'::text;
  end if;
  if pg_temp.error_of('select count(*) from public.space_settings') is null then
    failures := failures || 'anon read business rules'::text;
  end if;
  perform pg_temp.as_admin();

  if array_length(failures, 1) > 0 then
    raise exception 'CUSTOMIZATION FAILED (% of % checks): %', array_length(failures, 1), checks,
      array_to_string(failures, E'\n  ');
  end if;
  raise exception 'CUSTOMIZATION PASSED (% checks, rolled back)', checks;
end $customization$;
