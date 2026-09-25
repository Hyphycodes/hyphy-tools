-- Hyphy Tools — real accounts (supabase/migrations/20260928000000_real_accounts.sql).
--
-- What happens when Supabase Auth creates someone, run against the database: they get exactly one
-- profile, one Personal Space and one owner membership, however many times it runs; nobody can
-- make or change anyone else's account; and the development personas are untouched.
--
-- Run as an administrator (the role Supabase Auth inserts users as has the same effect). One
-- transaction, always rolled back; the report is the final error message ("ACCOUNTS PASSED" or
-- "ACCOUNTS FAILED").

create or replace function pg_temp.as_person(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', person::text, true);
$$;

create or replace function pg_temp.did(key text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('hyphy-demo:' || key, 'UTF8')), 'hex') as h) x
$$;

do $accounts$
declare
  results text[] := '{}';
  failures text[] := '{}';
  ada uuid := gen_random_uuid();
  ben uuid := gen_random_uuid();
  jerry uuid := pg_temp.did('jerry');
  ada_space uuid;
  n bigint;
  txt text;
  demo_before text;
  demo_after text;
begin
  -- The development personas, before anything happens (empty on a database without them).
  select coalesce(string_agg(md5(row(p.*)::text), ',' order by p.id), '') into demo_before
  from profiles p where exists (select 1 from auth.users u where u.id = p.id);

  -- A new account, as Supabase Auth creates it.
  insert into auth.users (id, email, raw_user_meta_data)
  values (ada, 'ada.auth-test@hyphy-tools.example', '{"name": "  Ada   Test  "}');
  select count(*) into n from profiles where id = ada and email = 'ada.auth-test@hyphy-tools.example';
  if n <> 1 then failures := failures || 'A new account did not get one profile'::text; end if;
  select name into txt from profiles where id = ada;
  if txt is distinct from 'Ada   Test' then failures := failures || ('The profile name was not the typed name, tidied: ' || coalesce(txt, 'null'))::text; end if;
  select count(*) into n from spaces where owner_id = ada and kind = 'personal';
  if n <> 1 then failures := failures || 'A new account did not get one Personal Space'::text; end if;
  select id into ada_space from spaces where owner_id = ada and kind = 'personal';
  select count(*) into n from space_members
   where person_id = ada and space_id = ada_space and role = 'owner' and status = 'active';
  if n <> 1 then failures := failures || 'A new account is not the owner of their Personal Space'::text; end if;
  select count(*) into n from space_members where person_id = ada;
  if n <> 1 then failures := failures || 'A new account belongs to more than their Personal Space'::text; end if;
  results := results || 'ok: a new account gets one profile, one Personal Space, one owner membership'::text;

  -- No name typed: the part of the email before the @.
  insert into auth.users (id, email) values (ben, 'ben.auth-test@hyphy-tools.example');
  select name into txt from profiles where id = ben;
  if txt is distinct from 'ben.auth-test' then failures := failures || 'A nameless account did not get a name from its email'::text; end if;
  results := results || 'ok: an account without a name is named from its email'::text;

  -- Bootstrapping again, and again — repeated sign-ins, retries — changes nothing.
  perform private.ensure_person(ada, 'ada.auth-test@hyphy-tools.example', 'Someone Else');
  perform private.ensure_person(ada, 'ada.auth-test@hyphy-tools.example', null);
  perform private.ensure_personal_space(ada);
  select count(*) into n from profiles where id = ada;
  if n <> 1 then failures := failures || 'Bootstrapping twice made a second profile'::text; end if;
  select name into txt from profiles where id = ada;
  if txt <> 'Ada   Test' then failures := failures || 'Bootstrapping again renamed the person'::text; end if;
  select count(*) into n from spaces where owner_id = ada and kind = 'personal';
  if n <> 1 then failures := failures || 'Bootstrapping twice made a second Personal Space'::text; end if;
  select count(*) into n from space_members where person_id = ada;
  if n <> 1 then failures := failures || 'Bootstrapping twice made a second membership'::text; end if;
  results := results || 'ok: bootstrapping again leaves one profile, one Personal Space, one membership'::text;

  -- A second insert of the same user id is refused by Auth's own key, not duplicated.
  begin
    insert into auth.users (id, email) values (ada, 'ada.auth-test@hyphy-tools.example');
    failures := failures || 'The same account could be created twice'::text;
  exception when unique_violation then null;
  end;

  -- Ada, signed in, can't bootstrap, create or change anyone's account.
  perform pg_temp.as_person(ada);
  begin
    perform private.ensure_person(ben, 'x@hyphy-tools.example', 'Hijack');
    failures := failures || 'A person could call the bootstrap'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.ensure_personal_space(ben);
    failures := failures || 'A person could make a Personal Space for someone'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into profiles (id, name, email) values (gen_random_uuid(), 'Forged', 'forged@hyphy-tools.example');
    failures := failures || 'A person could insert a profile'::text;
  exception when insufficient_privilege then null;
  end;
  update profiles set name = 'Ben Renamed' where id = ben;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'A person could rename someone else'::text; end if;
  begin
    update profiles set email = 'ben.auth-test@hyphy-tools.example' where id = ada;
    failures := failures || 'A person could change the email on their profile'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    update profiles set id = gen_random_uuid() where id = ada;
    failures := failures || 'A person could change their profile id'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from profiles where id = ada;
    failures := failures || 'A person could delete their profile'::text;
  exception when insufficient_privilege then null;
  end;
  update profiles set name = 'Ada Lovelace-Test' where id = ada;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'A person could not rename themselves'::text; end if;
  begin
    update profiles set name = repeat('x', 81) where id = ada;
    failures := failures || 'A name over 80 characters was accepted'::text;
  exception when check_violation then null;
  end;
  results := results || 'ok: a person can rename only themselves; never bootstrap, insert, delete or change an id or email'::text;

  -- Ada's Personal Space is hers alone.
  begin
    insert into space_members (space_id, person_id, role, title, status)
    values (ada_space, ben, 'member', '', 'active');
    failures := failures || 'Someone was added to another person''s Personal Space'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    perform invite_member(ada_space, 'Ben', 'ben.auth-test@hyphy-tools.example', 'member', '', '{}');
    failures := failures || 'Someone was invited into a Personal Space'::text;
  exception when insufficient_privilege then null;
  end;
  begin
    update space_members set role = 'guest' where space_id = ada_space and person_id = ada;
    failures := failures || 'The owner of a Personal Space could stop owning it'::text;
  exception when insufficient_privilege then null;
  end;
  results := results || 'ok: a Personal Space holds only its owner, as owner'::text;

  -- Ada sees only herself and her own Space; nothing of the development world.
  select count(*) into n from spaces;
  if n <> 1 then failures := failures || ('A new account sees ' || n || ' Spaces')::text; end if;
  select count(*) into n from profiles;
  if n <> 1 then failures := failures || ('A new account sees ' || n || ' profiles')::text; end if;
  select count(*) into n from space_members;
  if n <> 1 then failures := failures || 'A new account sees other memberships'::text; end if;
  select (select count(*) from projects) + (select count(*) from vehicles) + (select count(*) from receipts)
       + (select count(*) from mileage_entries) + (select count(*) from files) + (select count(*) from activity)
       + (select count(*) from inbox_items) + (select count(*) from qr_codes) + (select count(*) from link_pages)
    into n;
  if n <> 0 then failures := failures || ('A new account sees ' || n || ' records that aren''t theirs')::text; end if;
  results := results || 'ok: a new account sees only itself and its Personal Space — no demo data'::text;

  -- And the development world can't see Ada.
  perform pg_temp.as_person(jerry);
  select count(*) into n from profiles where id in (ada, ben);
  if n <> 0 then failures := failures || 'A development persona can see a new account'::text; end if;
  select count(*) into n from spaces where id = ada_space;
  if n <> 0 then failures := failures || 'A development persona can see a new Personal Space'::text; end if;
  results := results || 'ok: other people can''t see a new account or its Space'::text;

  -- A changed login email follows onto the profile.
  perform set_config('role', 'none', true);
  update auth.users set email = 'ada.new-address@hyphy-tools.example' where id = ada;
  select email into txt from profiles where id = ada;
  if txt <> 'ada.new-address@hyphy-tools.example' then failures := failures || 'The profile email did not follow Auth'::text; end if;
  results := results || 'ok: the profile email follows the login email'::text;

  -- Seeding (development only) inserts identities without the bootstrap.
  perform set_config('hyphy.seeding', 'on', true);
  insert into auth.users (id, email) values (gen_random_uuid(), 'seeded.auth-test@hyphy-tools.example');
  perform set_config('hyphy.seeding', '', true);
  select count(*) into n from auth.users u where u.email = 'seeded.auth-test@hyphy-tools.example'
    and exists (select 1 from profiles p where p.id = u.id);
  if n <> 0 then failures := failures || 'The bootstrap ran while seeding'::text; end if;
  results := results || 'ok: seeding brings its own profiles'::text;

  -- The development personas are exactly as they were.
  select coalesce(string_agg(md5(row(p.*)::text), ',' order by p.id), '') into demo_after
  from profiles p where exists (select 1 from auth.users u where u.id = p.id)
    and p.id not in (ada, ben);
  if demo_before <> demo_after then failures := failures || 'Development personas changed'::text; end if;
  results := results || 'ok: existing profiles are untouched'::text;

  if array_length(failures, 1) > 0 then
    raise exception 'ACCOUNTS FAILED (rolled back): %', array_to_string(failures, '; ');
  end if;
  raise exception E'ACCOUNTS PASSED (rolled back)\n%', array_to_string(results, E'\n');
end;
$accounts$;
