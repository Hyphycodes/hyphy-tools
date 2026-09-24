-- RLS smoke test: an owner, a member and a guest each query as themselves. Expected counts are in the labels.
\set ON_ERROR_STOP 1
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, delete on public.activity, public.inbox_items from authenticated;
insert into auth.users values ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e'), ('00000000-0000-0000-0000-00000000000c');
insert into profiles (id, name, email) values
  ('00000000-0000-0000-0000-00000000000d', 'Dana', 'dana@x.example'),
  ('00000000-0000-0000-0000-00000000000e', 'Mike', 'mike@x.example'),
  ('00000000-0000-0000-0000-00000000000c', 'Chris', 'chris@x.example');
insert into spaces (id, slug, kind, name, plan) values ('10000000-0000-0000-0000-000000000001', 'abc', 'business', 'ABC', 'business-pro');
insert into projects (id, space_id, created_by, name, team_ids) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Oak Brook', array['00000000-0000-0000-0000-00000000000e']::uuid[]),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Westmont', '{}');
insert into space_members (space_id, person_id, role, status, project_ids) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'owner', 'active', '{}'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'member', 'active', '{}'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'guest', 'active', array['20000000-0000-0000-0000-000000000001']::uuid[]);
insert into vehicles (space_id, created_by, name, assigned_to) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Truck 24', '00000000-0000-0000-0000-00000000000e'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Truck 17', null);
insert into receipts (space_id, created_by, vendor, category, total, date, status) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000d', 'Staples', 'supplies', 37.18, now(), 'approved');

set role authenticated;

-- Mike, member
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
insert into receipts (space_id, created_by, vendor, category, total, date, status, project_id)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'Shell', 'fuel', 71.42, now(), 'submitted', '20000000-0000-0000-0000-000000000001');
select 'mike spaces' as check, count(*) from spaces
union all select 'mike projects (1)', count(*) from projects
union all select 'mike vehicles (1)', count(*) from vehicles
union all select 'mike receipts (1, own)', count(*) from receipts
union all select 'mike inbox (0)', count(*) from inbox_items
union all select 'mike activity (1, own)', count(*) from activity;
do $$ begin
  insert into receipts (space_id, created_by, vendor, category, total, date, status)
    values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000e', 'Sneaky', 'other', 1, now(), 'approved');
  raise notice 'FAIL: member self-approved';
exception when insufficient_privilege or check_violation then raise notice 'ok: member cannot self-approve';
end $$;
do $$ begin
  update receipts set status = 'approved' where vendor = 'Shell';
  if found then raise notice 'FAIL: member approved own submitted receipt'; else raise notice 'ok: member cannot approve'; end if;
end $$;

-- Chris, guest on Oak Brook only
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select 'chris projects (1)' as check, count(*) from projects
union all select 'chris vehicles (0)', count(*) from vehicles
union all select 'chris receipts (0)', count(*) from receipts
union all select 'chris members (1, own row)', count(*) from space_members where space_id = '10000000-0000-0000-0000-000000000001';

-- Dana, owner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select 'dana projects (2)' as check, count(*) from projects
union all select 'dana vehicles (2)', count(*) from vehicles
union all select 'dana receipts (2)', count(*) from receipts
union all select 'dana inbox (1 approval)', count(*) from inbox_items;
update receipts set status = 'approved', reviewed_by = auth.uid() where vendor = 'Shell';
select 'dana approved', status from receipts where vendor = 'Shell';
