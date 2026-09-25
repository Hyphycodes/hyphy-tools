-- Hyphy Tools — Row Level Security attack suite, for the seeded development world.
--
-- Every check acts as a real seeded person, exactly as the app does: `role authenticated` plus
-- that person's JWT claims, inside the transaction. Each one tries something the database must
-- refuse — by returning nothing, changing nothing, or raising. Runs unchanged on local Postgres
-- (psql -f) and on hosted Supabase (as one statement through the SQL editor or MCP). Changes
-- nothing: every attempt is rolled back. Ends by selecting a report; raises if anything got through.

create or replace function pg_temp.did(key text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('hyphy-demo:' || key, 'UTF8')), 'hex') as h) x
$$;

do $suite$
declare
  results text[] := '{}';
  failures text[] := '{}';
  n bigint;
  mike uuid := pg_temp.did('mike');
  dana uuid := pg_temp.did('dana');
  chris uuid := pg_temp.did('chris');
  jerry uuid := pg_temp.did('jerry');
  rosa uuid := pg_temp.did('rosa');
  luis uuid := pg_temp.did('luis');
  abc uuid := pg_temp.did('sp_abc');
  hyphy uuid := pg_temp.did('sp_hyphy');
  se uuid := pg_temp.did('sp_se');
  jerry_personal uuid := pg_temp.did('sp_personal_jerry');
  dana_personal uuid := pg_temp.did('sp_personal_dana');
  hyphy_receipt uuid;
  jerry_receipt uuid;
  se_project uuid := pg_temp.did('prj_se_keller');
  hyphy_project uuid := pg_temp.did('prj_hy_tools');
  truck uuid := pg_temp.did('veh_t24');
  westmont uuid := pg_temp.did('prj_westmont');
  oakbrook uuid := pg_temp.did('prj_oakbrook');
  submitted_receipt uuid := pg_temp.did('rc_abc_01');
  returned_trip uuid := pg_temp.did('mi_abc_08');
  space_tables text[] := array['projects', 'vehicles', 'receipts', 'mileage_entries', 'files',
    'qr_codes', 'link_pages', 'activity', 'inbox_items', 'space_members', 'approval_events', 'pins'];
  t text;
  target uuid;
  who uuid;
  total_members bigint;
begin
  if not exists (select 1 from spaces where id = abc) then
    raise exception 'Seed the development world first.';
  end if;
  select id into hyphy_receipt from receipts where space_id = hyphy limit 1;
  select id into jerry_receipt from receipts where space_id = jerry_personal limit 1;
  select count(*) into total_members from space_members where space_id = abc and status = 'active';

  -- Spaces a person isn't in: nothing, table by table, not even the Space itself.
  for who, target in
    select * from (values (mike, hyphy), (mike, se), (jerry, dana_personal), (dana, jerry_personal),
                          (rosa, abc), (chris, hyphy)) v(p, s)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', who::text, true);
    foreach t in array space_tables loop
      execute format('select count(*) from public.%I where space_id = $1', t) into n using target;
      if n > 0 then failures := failures || format('%s read %s rows of %s in %s', who, n, t, target); end if;
    end loop;
    select count(*) into n from spaces where id = target;
    if n > 0 then failures := failures || format('%s read Space %s', who, target); end if;
    select count(*) into n from space_directory(target);
    if n > 0 then failures := failures || format('%s listed the directory of %s', who, target); end if;
    perform set_config('role', 'none', true);
  end loop;
  results := results || 'ok: Mike sees nothing of Hyphy LLC or Salt & Ember; Rosa nothing of ABC; Chris nothing of Hyphy'::text
                     || 'ok: Personal Spaces are private (Jerry ↔ Dana)'::text;

  -- Knowing an id is not access: another Space's receipt, by id, can't be read, changed or removed.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', mike, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mike::text, true);
  select count(*) into n from receipts where id in (hyphy_receipt, jerry_receipt);
  if n > 0 then failures := failures || 'Mike read a receipt by id in another Space'::text; end if;
  update receipts set total = 1 where id in (hyphy_receipt, jerry_receipt);
  get diagnostics n = row_count;
  if n > 0 then failures := failures || 'Mike changed a receipt in another Space'::text; end if;
  delete from receipts where id in (hyphy_receipt, jerry_receipt);
  get diagnostics n = row_count;
  if n > 0 then failures := failures || 'Mike deleted a receipt in another Space'::text; end if;
  select count(*) into n from approval_events where submission_id in (hyphy_receipt, jerry_receipt);
  if n > 0 then failures := failures || 'Mike read approval history in another Space'::text; end if;
  select count(*) into n from projects where id in (hyphy_project, se_project);
  if n > 0 then failures := failures || 'Mike read a project by id in another Space'::text; end if;
  results := results || 'ok: ids from other Spaces read, update and delete nothing'::text;

  -- A valid uuid from another Space can't be attached to your own records.
  begin
    insert into mileage_entries (space_id, created_by, date, "from", "to", miles, purpose, project_id, status)
    values (abc, mike, now(), 'Shop', 'Keller', 5, 'test', se_project, 'submitted');
    failures := failures || 'Mike logged a trip against a Salt & Ember project'::text;
  exception when others then null;
  end;
  begin
    insert into receipts (space_id, created_by, vendor, category, total, date, project_id, status)
    values (abc, mike, 'Menards', 'materials', 10, now(), hyphy_project, 'submitted');
    failures := failures || 'Mike filed a receipt against a Hyphy project'::text;
  exception when others then null;
  end;
  begin
    insert into projects (space_id, created_by, name, status) values (hyphy, mike, 'Pirate', 'active');
    failures := failures || 'Mike created a project in Hyphy LLC'::text;
  exception when others then null;
  end;
  results := results || 'ok: another Space’s ids can’t be used in your records, nor its Space written to'::text;

  -- Approvals: nobody approves their own; a submitted row can't be flipped to approved directly.
  update receipts set status = 'approved' where id = submitted_receipt;
  get diagnostics n = row_count;
  if n > 0 then failures := failures || 'Mike approved his own submitted receipt directly'::text; end if;
  begin
    update mileage_entries set status = 'approved' where id = returned_trip;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || 'Mike approved his own returned trip'::text; end if;
  exception when others then null;
  end;
  begin
    insert into receipts (space_id, created_by, vendor, category, total, date, status)
    values (abc, mike, 'Menards', 'materials', 10, now(), 'approved');
    failures := failures || 'Mike inserted an already-approved receipt'::text;
  exception when others then null;
  end;
  begin
    perform set_config('hyphy.seeding', 'on', true);
    update mileage_entries set status = 'approved' where id = returned_trip;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || 'Seeding mode let Mike approve his own trip'::text; end if;
  exception when others then null;
  end;
  perform set_config('hyphy.seeding', '', true);
  begin
    insert into approval_events (space_id, submission_type, submission_id, action, actor_id)
    values (abc, 'receipt', submitted_receipt, 'approved', dana);
    failures := failures || 'Mike forged an approval event'::text;
  exception when others then null;
  end;
  begin
    truncate table public.receipts cascade;
    failures := failures || 'Mike truncated every Space''s receipts'::text;
  exception when others then null;
  end;
  select count(*) into n from pins where person_id <> mike;
  if n > 0 then failures := failures || 'Mike read someone else''s pins'::text; end if;
  results := results || 'ok: no self-approval, no direct flip to approved, no seeding bypass, no forged history, no truncate'::text;

  -- Internal helpers and development tools are not callable by a person.
  begin perform ref_label('project', hyphy_project);
    failures := failures || 'ref_label is callable by a person'::text;
  exception when others then null; end;
  begin perform write_activity(abc, mike, 'x', 'project', oakbrook, 'x');
    failures := failures || 'write_activity is callable by a person'::text;
  exception when others then null; end;
  begin perform dev.reset_world('{}'::jsonb);
    failures := failures || 'dev.reset_world is callable by a person'::text;
  exception when others then null; end;
  begin perform count(*) from dev.personas;
    failures := failures || 'dev.personas is readable by a person'::text;
  exception when others then null; end;
  perform set_config('role', 'none', true);
  results := results || 'ok: ref_label, write_activity and the dev tools refuse people'::text;

  -- Chris, an ABC guest on two projects: no vehicles, no other projects, no company list.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', chris, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', chris::text, true);
  select count(*) into n from vehicles where space_id = abc;
  if n > 0 then failures := failures || format('Chris read %s ABC vehicles', n); end if;
  select count(*) into n from vehicles where id = truck;
  if n > 0 then failures := failures || 'Chris read Truck 24 by id'::text; end if;
  update vehicles set odometer = 1 where id = truck;
  get diagnostics n = row_count;
  if n > 0 then failures := failures || 'Chris changed Truck 24'::text; end if;
  select count(*) into n from projects where id = westmont;
  if n > 0 then failures := failures || 'Chris read a project he was never given'::text; end if;
  select count(*) into n from projects where space_id = abc;
  if n <> 2 then failures := failures || format('Chris sees %s ABC projects, not his 2', n); end if;
  select count(*) into n from receipts where space_id = abc and created_by <> chris;
  if n > 0 then failures := failures || 'Chris read other people''s receipts'::text; end if;
  select count(*) into n from space_members where space_id = abc;
  if n >= total_members then failures := failures || 'Chris enumerated ABC''s membership'::text; end if;
  select count(*) into n from space_directory(abc);
  if n >= total_members then failures := failures || 'Chris enumerated ABC''s directory'::text; end if;
  select count(*) into n from profiles p
   where p.id <> chris and not exists (
     select 1 from projects pr where pr.lead_id = p.id or p.id = any (pr.team_ids));
  if n > 0 then failures := failures || format('Chris read %s profiles outside his projects', n); end if;
  perform set_config('role', 'none', true);
  results := results || 'ok: guest sees no vehicles, no other projects, no money, no company directory'::text;

  -- Plans and senior roles can't be granted from inside.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', dana, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', dana::text, true);
  begin
    update spaces set plan = 'free' where id = abc;
    failures := failures || 'An owner changed the plan from the app'::text;
  exception when others then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', luis, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', luis::text, true);
  begin
    perform invite_member(abc, 'Test Owner', 'test-owner@abc.example', 'owner', 'Owner', '{}');
    failures := failures || 'An admin granted owner'::text;
  exception when others then null;
  end;
  perform set_config('role', 'none', true);
  results := results || 'ok: the plan can’t be changed and admins can’t grant owner'::text;

  -- Nobody at all: the anon role (the public API with only a publishable key) gets nothing.
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  foreach t in array space_tables || array['spaces', 'profiles'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then failures := failures || format('anon read %s rows of %s', n, t); end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin perform space_directory(abc);
    failures := failures || 'anon called space_directory'::text;
  exception when others then null; end;
  begin perform ref_label('project', oakbrook);
    failures := failures || 'anon called ref_label'::text;
  exception when others then null; end;
  begin perform invite_member(abc, 'x', 'x@x.example', 'member', 'x', '{}');
    failures := failures || 'anon called invite_member'::text;
  exception when others then null; end;
  perform set_config('role', 'none', true);
  results := results || 'ok: anon reads nothing and calls nothing'::text;

  if array_length(failures, 1) > 0 then
    raise exception 'RLS attack suite: % got through: %', array_length(failures, 1),
      array_to_string(failures, '; ');
  end if;
  perform set_config('hyphy.report', array_to_string(results, E'\n'), false);
end;
$suite$;

select current_setting('hyphy.report') as report;
