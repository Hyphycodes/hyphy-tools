-- Hyphy Tools — Business Spaces, teams and invitations
-- (supabase/migrations/20260929000000_business_spaces.sql), against the database.
--
-- Real accounts (confirmed emails, as Supabase Auth makes them) create businesses, invite each
-- other and manage people — and try everything they shouldn't. One transaction, always rolled
-- back; the report is the final error message ("TEAMS PASSED" or "TEAMS FAILED").
-- Concurrent acceptance and revocation are tested with real parallel connections in
-- tests/data.spec.ts.

create or replace function pg_temp.as_person(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', person::text, true);
$$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', true);
$$;
-- A confirmed account, as Supabase Auth leaves it after the email link.
create or replace function pg_temp.account(who text) returns uuid language plpgsql as $$
declare id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
  values (id, who || '.teams-test@hyphy-tools.example', json_build_object('name', initcap(who) || ' Test'), now());
  return id;
end $$;
create or replace function pg_temp.token(seed text) returns text language sql as $$
  select rpad(seed, 43, 'x')
$$;
create or replace function pg_temp.fails(statement text) returns boolean language plpgsql as $$
begin
  execute statement;
  return false;
exception when others then
  return true;
end $$;
create or replace function pg_temp.biz(name text, address text) returns uuid language sql as $$
  select space_id from public.create_business(name, address, 'construction', false, null,
    array['projects', 'vehicles', 'receipts', 'mileage', 'files', 'qr'], 'jobs',
    '{}'::jsonb, '{"color":"#3240FF","ink":"light","monogram":"A"}'::jsonb, 'Construction')
$$;

do $teams$
declare
  results text[] := '{}';
  failures text[] := '{}';
  ada uuid := pg_temp.account('ada');
  ben uuid := pg_temp.account('ben');
  cam uuid := pg_temp.account('cam');
  dee uuid := pg_temp.account('dee');
  eve uuid := pg_temp.account('eve');
  una uuid;
  biz_a uuid;
  biz_b uuid;
  key uuid := gen_random_uuid();
  r record;
  inv uuid;
  n bigint;
  txt text;
  project uuid;
  receipt uuid;
begin
  -- Business creation ------------------------------------------------------------------------
  perform pg_temp.as_person(ada);
  select * into r from public.create_business('ABC Construction', 'abc-teams-test', 'construction',
    false, key, array['projects', 'vehicles'], 'jobs', '{}', '{"color":"#3240FF","ink":"light","monogram":"A"}',
    'Construction');
  biz_a := r.space_id;
  if not r.created or r.space_slug <> 'abc-teams-test' then failures := failures || 'Business was not created at its address'::text; end if;
  select count(*) into n from space_members where space_id = biz_a and person_id = ada and role = 'owner' and status = 'active';
  if n <> 1 then failures := failures || 'The creator is not the owner'::text; end if;
  select modules::text into txt from spaces where id = biz_a;
  if txt not like '%people%' or txt not like '%files%' then failures := failures || 'A business lacks People or Files'::text; end if;
  select count(*) into n from spaces s join space_members m on m.space_id = s.id
   where m.person_id = ada and s.kind = 'personal' and m.status = 'active';
  if n <> 1 then failures := failures || 'The creator lost their Personal Space'::text; end if;
  -- The same request again: the same business.
  select * into r from public.create_business('ABC Construction', 'abc-teams-test', 'construction',
    false, key, array['projects'], 'jobs', '{}', '{}', '');
  if r.created or r.space_id <> biz_a then failures := failures || 'A retried create made a second business'::text; end if;
  select count(*) into n from spaces where name = 'ABC Construction' and slug like 'abc-teams-test%';
  if n <> 1 then failures := failures || 'A retried create duplicated the business'::text; end if;
  -- The same address from a new request: a free variant, or refused when asked exactly.
  select * into r from public.create_business('ABC Two', 'abc-teams-test', 'construction',
    false, null, array['projects'], 'jobs', '{}', '{}', '');
  if r.space_slug <> 'abc-teams-test-2' then failures := failures || ('Collision gave ' || r.space_slug)::text; end if;
  if not pg_temp.fails($$select public.create_business('X', 'abc-teams-test', 'other', true, null,
        array['projects'], 'engagements', '{}', '{}', '')$$) then
    failures := failures || 'A taken address was accepted exactly'::text;
  end if;
  foreach txt in array array['sign-in', 'auth', 'welcome', 'personal', 'invite', 'create-business', 'Bad Address', 'a', '-x-', 'a--b'] loop
    if not pg_temp.fails(format($$select public.create_business('X', %L, 'other', true, null,
          array['projects'], 'engagements', '{}', '{}', '')$$, txt)) then
      failures := failures || ('A bad address was accepted: ' || txt);
    end if;
  end loop;
  if not pg_temp.fails($$select public.create_business('X', 'x-teams-test', 'other', false, null,
        array['payroll'], 'engagements', '{}', '{}', '')$$) then
    failures := failures || 'An unknown module was accepted'::text;
  end if;
  -- Someone else can't reuse Ada's request key to reach her business.
  perform pg_temp.as_person(ben);
  if not pg_temp.fails(format($$select public.create_business('Hijack', 'hijack-teams-test', 'other',
        false, %L, array['projects'], 'engagements', '{}', '{}', '')$$, key)) then
    failures := failures || 'Another person reused a creation key'::text;
  end if;
  biz_b := pg_temp.biz('Ben Builders', 'ben-teams-test');
  results := results || 'ok: create business → owner membership, Personal Space kept, retry-safe, addresses validated'::text;

  -- Invitations: who may invite --------------------------------------------------------------
  perform pg_temp.as_person(ada);
  inv := public.create_invitation(biz_a, ' Cam.Teams-Test@Hyphy-Tools.example ', 'member', 'Cam',
    'Carpenter', '{}', 'See you Monday', pg_temp.token('cam1'));
  select email into txt from space_invitations where id = inv;
  if txt <> 'cam.teams-test@hyphy-tools.example' then failures := failures || 'The invited email was not normalized'::text; end if;
  select count(*) into n from space_members where space_id = biz_a and person_id = cam;
  if n <> 0 then failures := failures || 'An invitation created a membership'::text; end if;
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'cam.teams-test@hyphy-tools.example',
        'member', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('cam-dup'))) then
    failures := failures || 'A second pending invitation for the same email was allowed'::text;
  end if;
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'x.teams-test@hyphy-tools.example',
        'owner', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('owner'))) then
    failures := failures || 'Someone was invited as owner'::text;
  end if;
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'not an email', 'member', '', '',
        '{}', null, %L)$$, biz_a, pg_temp.token('bad'))) then
    failures := failures || 'A malformed email was invited'::text;
  end if;
  -- Personal Spaces take no invitations.
  if not pg_temp.fails($$select public.create_invitation((select id from spaces where owner_id = auth.uid()
        and kind = 'personal'), 'x.teams-test@hyphy-tools.example', 'member', '', '', '{}', null,
        rpad('personal', 43, 'x'))$$) then
    failures := failures || 'A Personal Space accepted an invitation'::text;
  end if;
  -- Ben can't invite into Ada's business, or even see its invitations.
  perform pg_temp.as_person(ben);
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'x.teams-test@hyphy-tools.example',
        'member', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('ben-into-a'))) then
    failures := failures || 'An outsider invited into another business'::text;
  end if;
  select count(*) into n from space_invitations where space_id = biz_a;
  if n <> 0 then failures := failures || 'An outsider can see another business''s invitations'::text; end if;
  if not pg_temp.fails(format($$select public.revoke_invitation(%L)$$, inv)) then
    failures := failures || 'An outsider revoked an invitation'::text;
  end if;
  -- Nobody reads the link's hash, not even the inviter.
  perform pg_temp.as_person(ada);
  if not pg_temp.fails('select token_hash from space_invitations') then
    failures := failures || 'The link hash is readable'::text;
  end if;
  if not pg_temp.fails(format($$insert into space_invitations (space_id, email, role, token_hash,
        invited_by, expires_at) values (%L, 'z.teams-test@hyphy-tools.example', 'member',
        sha256('x'::bytea), %L, now() + interval '1 day')$$, biz_a, ada)) then
    failures := failures || 'Invitations can be inserted directly'::text;
  end if;
  if not pg_temp.fails(format($$update space_invitations set role = 'admin' where id = %L$$, inv)) then
    failures := failures || 'Invitations can be updated directly'::text;
  end if;
  results := results || 'ok: owners invite; no owner invites, duplicates, bad emails, Personal Space invites, outsiders or direct writes'::text;

  -- Acceptance ---------------------------------------------------------------------------------
  -- Dee (wrong account) holds Cam's link: refused.
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('cam1'));
  if txt <> 'wrong_account' then failures := failures || ('A different account got: ' || txt); end if;
  -- A made-up link, and a malformed one.
  select outcome into txt from public.accept_invitation(pg_temp.token('nope'));
  if txt <> 'invalid' then failures := failures || 'A made-up link was not invalid'::text; end if;
  select outcome into txt from public.accept_invitation('short');
  if txt <> 'invalid' then failures := failures || 'A malformed link was not invalid'::text; end if;
  -- Unconfirmed email: not yet.
  perform pg_temp.as_admin();
  update auth.users set email_confirmed_at = null where id = cam;
  perform pg_temp.as_person(cam);
  select outcome into txt from public.accept_invitation(pg_temp.token('cam1'));
  if txt <> 'unconfirmed' then failures := failures || 'An unconfirmed email could accept'::text; end if;
  perform pg_temp.as_admin();
  update auth.users set email_confirmed_at = now() where id = cam;
  -- The profile email is not proof: Dee's profile can't be made to match (not editable), and
  -- even an administrator changing it doesn't let Dee in.
  update profiles set email = 'cam.teams-test@hyphy-tools.example' where id = dee;
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('cam1'));
  if txt <> 'wrong_account' then failures := failures || 'A profile email was taken as proof'::text; end if;
  perform pg_temp.as_admin();
  update profiles set email = 'dee.teams-test@hyphy-tools.example' where id = dee;
  -- Cam, before joining, sees nothing of the business.
  perform pg_temp.as_person(cam);
  select count(*) into n from spaces where id = biz_a;
  if n <> 0 then failures := failures || 'An invitee sees the business before accepting'::text; end if;
  -- Ada changes the role before Cam accepts.
  perform pg_temp.as_person(ada);
  perform public.set_invitation_role(inv, 'manager', null);
  perform pg_temp.as_person(cam);
  select * into r from public.accept_invitation(pg_temp.token('cam1'));
  if r.outcome <> 'joined' or r.space_slug <> 'abc-teams-test' then failures := failures || ('Cam could not join: ' || r.outcome); end if;
  select role::text into txt from space_members where space_id = biz_a and person_id = cam and status = 'active';
  if txt is distinct from 'manager' then failures := failures || ('Cam joined as ' || coalesce(txt, 'nothing')); end if;
  perform pg_temp.as_admin();
  select count(*) into n from space_invitations where id = inv and status = 'accepted' and accepted_by = cam and accepted_at is not null;
  if n <> 1 then failures := failures || 'The invitation was not marked accepted by Cam'::text; end if;
  -- A manager doesn't see the business's invitations.
  perform pg_temp.as_person(cam);
  select count(*) into n from space_invitations where space_id = biz_a;
  if n <> 0 then failures := failures || 'A manager can see invitations'::text; end if;
  -- Twice: the same answer, no second membership.
  select outcome into txt from public.accept_invitation(pg_temp.token('cam1'));
  if txt <> 'already_member' then failures := failures || ('A repeat accept said ' || txt); end if;
  select count(*) into n from space_members where space_id = biz_a and person_id = cam;
  if n <> 1 then failures := failures || 'A repeat accept duplicated the membership'::text; end if;
  -- Someone else with the used link: used.
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('cam1'));
  if txt <> 'used' then failures := failures || 'A used link was not reported used'::text; end if;
  -- Cam now sees the business, as a manager.
  perform pg_temp.as_person(cam);
  select count(*) into n from spaces where id = biz_a;
  if n <> 1 then failures := failures || 'Cam cannot see the business after joining'::text; end if;
  results := results || 'ok: only the confirmed invited email accepts; role at acceptance is the invitation''s; once; used links stay used'::text;

  -- Expiry, revocation, resending --------------------------------------------------------------
  perform pg_temp.as_person(ada);
  inv := public.create_invitation(biz_a, 'dee.teams-test@hyphy-tools.example', 'member', '', '', '{}', null, pg_temp.token('dee1'));
  perform pg_temp.as_admin();
  update space_invitations set expires_at = now() - interval '1 minute', sent_at = now() - interval '8 days', created_at = now() - interval '8 days' where id = inv;
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('dee1'));
  if txt <> 'expired' then failures := failures || 'An expired invitation was accepted'::text; end if;
  -- Resending renews it and replaces the link.
  perform pg_temp.as_person(ada);
  perform public.renew_invitation(inv, pg_temp.token('dee2'), true);
  if not pg_temp.fails(format($$select public.renew_invitation(%L, %L, true)$$, inv, pg_temp.token('dee3'))) then
    failures := failures || 'Two emailed resends inside a minute were allowed'::text;
  end if;
  select count(*) into n from space_invitations where space_id = biz_a and email = 'dee.teams-test@hyphy-tools.example';
  if n <> 1 then failures := failures || 'Resending made another invitation'::text; end if;
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('dee1'));
  if txt <> 'invalid' then failures := failures || 'The old link still works after a resend'::text; end if;
  -- Revoked: refused.
  perform pg_temp.as_person(ada);
  perform public.revoke_invitation(inv);
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('dee2'));
  if txt <> 'revoked' then failures := failures || 'A revoked invitation was accepted'::text; end if;
  perform pg_temp.as_person(ada);
  if not pg_temp.fails(format($$select public.renew_invitation(%L, %L, false)$$, inv, pg_temp.token('dee4'))) then
    failures := failures || 'A revoked invitation was renewed'::text;
  end if;
  -- After a revoke, a fresh invitation for the same email is allowed.
  inv := public.create_invitation(biz_a, 'dee.teams-test@hyphy-tools.example', 'member', '', '', '{}', null, pg_temp.token('dee5'));
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('dee5'));
  if txt <> 'joined' then failures := failures || 'A fresh invitation after a revoke failed'::text; end if;
  results := results || 'ok: expired and revoked links refused; resend renews one invitation and kills the old link'::text;

  -- Who may invite: admin yes (not admins), manager / member / guest no --------------------------
  perform pg_temp.as_person(ada);
  inv := public.create_invitation(biz_a, 'eve.teams-test@hyphy-tools.example', 'admin', '', '', '{}', null, pg_temp.token('eve1'));
  perform pg_temp.as_person(eve);
  perform public.accept_invitation(pg_temp.token('eve1'));
  -- Eve (admin) invites a member; not an admin.
  perform public.create_invitation(biz_a, 'una.teams-test@hyphy-tools.example', 'member', '', '', '{}', null, pg_temp.token('una1'));
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'x2.teams-test@hyphy-tools.example',
        'admin', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('adm2'))) then
    failures := failures || 'An admin invited an admin'::text;
  end if;
  -- Cam (manager) and Dee (member) can't invite.
  perform pg_temp.as_person(cam);
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'x3.teams-test@hyphy-tools.example',
        'member', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('mgr'))) then
    failures := failures || 'A manager invited someone'::text;
  end if;
  perform pg_temp.as_person(dee);
  if not pg_temp.fails(format($$select public.create_invitation(%L, 'x4.teams-test@hyphy-tools.example',
        'member', '', '', '{}', null, %L)$$, biz_a, pg_temp.token('mem'))) then
    failures := failures || 'A member invited someone'::text;
  end if;
  results := results || 'ok: owner and admin invite (only the owner adds admins); managers and members can''t'::text;

  -- Member management ---------------------------------------------------------------------------
  -- Dee (member) can't promote herself or anyone.
  perform pg_temp.as_person(dee);
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'admin')$$, biz_a, dee)) then
    failures := failures || 'A member promoted themselves'::text;
  end if;
  if not pg_temp.fails(format($$update space_members set role = 'admin' where person_id = %L$$, dee)) then
    failures := failures || 'A member updated memberships directly'::text;
  end if;
  -- Eve (admin): can make Dee a guest and back, can't touch the owner, can't take ownership.
  perform pg_temp.as_person(eve);
  perform public.set_member_role(biz_a, dee, 'guest');
  perform public.set_member_role(biz_a, dee, 'member');
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'member')$$, biz_a, ada)) then
    failures := failures || 'An admin demoted the owner'::text;
  end if;
  if not pg_temp.fails(format($$select public.remove_member(%L, %L)$$, biz_a, ada)) then
    failures := failures || 'An admin removed the owner'::text;
  end if;
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'owner')$$, biz_a, eve)) then
    failures := failures || 'An admin made themselves owner'::text;
  end if;
  if not pg_temp.fails(format($$select public.transfer_ownership(%L, %L)$$, biz_a, eve)) then
    failures := failures || 'An admin transferred ownership'::text;
  end if;
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'admin')$$, biz_a, cam)) then
    failures := failures || 'An admin made someone an admin'::text;
  end if;
  -- Cam (manager) can't manage people.
  perform pg_temp.as_person(cam);
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'guest')$$, biz_a, dee)) then
    failures := failures || 'A manager changed a role'::text;
  end if;
  if not pg_temp.fails(format($$select public.remove_member(%L, %L)$$, biz_a, dee)) then
    failures := failures || 'A manager removed someone'::text;
  end if;
  -- The owner can't leave or be left ownerless.
  perform pg_temp.as_person(ada);
  if not pg_temp.fails(format($$select public.leave_space(%L)$$, biz_a)) then
    failures := failures || 'The owner left without transferring'::text;
  end if;
  if not pg_temp.fails(format($$select public.set_member_role(%L, %L, 'member')$$, biz_a, ada)) then
    failures := failures || 'The owner changed their own role'::text;
  end if;
  results := results || 'ok: role changes by owner/admin only; admins can''t touch the owner or ownership; owner can''t walk away'::text;

  -- Removal: access ends, history stays, Personal remains ----------------------------------------
  -- Dee files a receipt on a project first.
  perform pg_temp.as_person(ada);
  insert into projects (space_id, created_by, name, team_ids) values (biz_a, ada, 'Oak St', array[dee]) returning id into project;
  perform pg_temp.as_person(dee);
  insert into receipts (space_id, created_by, vendor, category, total, date, status, project_id)
  values (biz_a, dee, 'Lumber Yard', 'materials', 120, now(), 'submitted', project) returning id into receipt;
  perform pg_temp.as_person(eve);
  perform public.remove_member(biz_a, dee);
  perform pg_temp.as_person(dee);
  select count(*) into n from spaces where id = biz_a;
  if n <> 0 then failures := failures || 'A removed member still sees the business'::text; end if;
  select count(*) into n from receipts where id = receipt;
  if n <> 0 then failures := failures || 'A removed member still reads their receipt by id'::text; end if;
  select count(*) into n from projects where id = project;
  if n <> 0 then failures := failures || 'A removed member still reads a project they were on'::text; end if;
  select count(*) into n from activity where space_id = biz_a;
  if n <> 0 then failures := failures || 'A removed member still reads their activity'::text; end if;
  if not pg_temp.fails(format($$insert into receipts (space_id, created_by, vendor, category, total, date, status)
        values (%L, %L, 'x', 'other', 1, now(), 'submitted')$$, biz_a, dee)) then
    failures := failures || 'A removed member could still write'::text;
  end if;
  select count(*) into n from spaces s join space_members m on m.space_id = s.id
   where m.person_id = dee and s.kind = 'personal' and m.status = 'active';
  if n <> 1 then failures := failures || 'Removal touched the Personal Space'::text; end if;
  perform pg_temp.as_person(ada);
  select count(*) into n from receipts where id = receipt and created_by = dee;
  if n <> 1 then failures := failures || 'The removed member''s receipt is gone'::text; end if;
  select count(*) into n from space_directory(biz_a) where id = dee;
  if n <> 1 then failures := failures || 'The removed member''s name no longer resolves'::text; end if;
  select count(*) into n from activity where space_id = biz_a and verb = 'removed' and object_id = dee and actor_id = eve;
  if n <> 1 then failures := failures || 'The removal isn''t in the activity'::text; end if;
  perform pg_temp.as_admin();
  select count(*) into n from profiles where id = dee;
  if n <> 1 then failures := failures || 'Removal deleted the account'::text; end if;
  results := results || 'ok: removed → no access by id, no writes; records, names, account and Personal Space stay'::text;

  -- Invited back: the removed membership comes back with the new role.
  perform pg_temp.as_person(ada);
  perform public.create_invitation(biz_a, 'dee.teams-test@hyphy-tools.example', 'guest', '', '', array[project], null, pg_temp.token('dee6'));
  perform pg_temp.as_person(dee);
  select outcome into txt from public.accept_invitation(pg_temp.token('dee6'));
  select role::text into txt from space_members where space_id = biz_a and person_id = dee and status = 'active';
  if txt is distinct from 'guest' then failures := failures || 'Re-invited member came back wrong'::text; end if;
  -- Leaving.
  perform public.leave_space(biz_a);
  select count(*) into n from spaces where id = biz_a;
  if n <> 0 then failures := failures || 'Leaving didn''t end access'::text; end if;
  results := results || 'ok: a former member can be invited back; members can leave'::text;

  -- Ownership --------------------------------------------------------------------------------
  perform pg_temp.as_person(ada);
  if not pg_temp.fails(format($$select public.transfer_ownership(%L, %L)$$, biz_a, dee)) then
    failures := failures || 'Ownership went to someone who isn''t a member'::text;
  end if;
  if not pg_temp.fails(format($$select public.transfer_ownership(%L, %L)$$, biz_a, ben)) then
    failures := failures || 'Ownership went to an outsider'::text;
  end if;
  perform public.set_member_role(biz_a, cam, 'guest');
  if not pg_temp.fails(format($$select public.transfer_ownership(%L, %L)$$, biz_a, cam)) then
    failures := failures || 'Ownership went to a guest'::text;
  end if;
  perform public.set_member_role(biz_a, cam, 'manager');
  perform public.transfer_ownership(biz_a, cam);
  select string_agg(p.name || ':' || m.role, ',' order by p.name) into txt
    from space_members m join profiles p on p.id = m.person_id
   where m.space_id = biz_a and m.role in ('owner', 'admin') and m.status = 'active';
  if txt <> 'Ada Test:admin,Cam Test:owner,Eve Test:admin' then failures := failures || ('After transfer: ' || txt); end if;
  -- Ada is an admin now: she can't take it back.
  if not pg_temp.fails(format($$select public.transfer_ownership(%L, %L)$$, biz_a, ada)) then
    failures := failures || 'A former owner transferred it back'::text;
  end if;
  -- The one-owner rule holds even against the administrator.
  perform pg_temp.as_admin();
  if not pg_temp.fails(format($$update space_members set role = 'admin' where space_id = %L and person_id = %L;
        set constraints space_members_one_owner immediate$$, biz_a, cam)) then
    failures := failures || 'A business was left without an owner'::text;
  end if;
  set constraints space_members_one_owner deferred;
  results := results || 'ok: ownership transfers only from the owner to an active non-guest member; always one owner'::text;

  -- Cross-business isolation ---------------------------------------------------------------------
  perform pg_temp.as_person(ben);
  select count(*) into n from spaces where id = biz_a;
  if n <> 0 then failures := failures || 'Ben sees Ada''s business'::text; end if;
  select (select count(*) from projects where space_id = biz_a) + (select count(*) from receipts where space_id = biz_a)
       + (select count(*) from space_members where space_id = biz_a) + (select count(*) from space_invitations where space_id = biz_a)
       + (select count(*) from files where space_id = biz_a) + (select count(*) from vehicles where space_id = biz_a)
    into n;
  if n <> 0 then failures := failures || 'Ben reads Ada''s business by id'::text; end if;
  perform pg_temp.as_person(cam);
  select count(*) into n from spaces where id = biz_b;
  if n <> 0 then failures := failures || 'Cam sees Ben''s business'::text; end if;
  -- Ben is invited into A: nothing until he accepts, then exactly the invited role.
  perform pg_temp.as_person(cam);
  perform public.create_invitation(biz_a, 'ben.teams-test@hyphy-tools.example', 'member', '', '', '{}', null, pg_temp.token('ben1'));
  perform pg_temp.as_person(ben);
  select count(*) into n from spaces where id = biz_a;
  if n <> 0 then failures := failures || 'An invitation alone opened the business'::text; end if;
  perform public.accept_invitation(pg_temp.token('ben1'));
  select count(*) into n from projects where space_id = biz_a;
  if n <> 0 then failures := failures || 'A new member sees projects they aren''t on'::text; end if;
  select count(*) into n from spaces where id in (biz_a, biz_b);
  if n <> 2 then failures := failures || 'Ben doesn''t see both his businesses'::text; end if;
  results := results || 'ok: businesses are sealed from each other until an invitation is accepted'::text;

  -- The development placeholder refuses outside the development world (here it's allowed: this
  -- database is marked development, so check the marker path instead).
  perform pg_temp.as_admin();
  if to_regclass('dev.environment') is null then
    perform pg_temp.as_person(cam);
    if not pg_temp.fails(format($$select public.invite_member(%L, 'X', 'x5.teams-test@hyphy-tools.example',
          'member', '', '{}')$$, biz_a)) then
      failures := failures || 'The placeholder invitation ran outside development'::text;
    end if;
    results := results || 'ok: the placeholder invitation refuses outside the development world'::text;
  end if;

  perform pg_temp.as_admin();
  if array_length(failures, 1) > 0 then
    raise exception 'TEAMS FAILED (rolled back): %', array_to_string(failures, '; ');
  end if;
  raise exception E'TEAMS PASSED (rolled back)\n%', array_to_string(results, E'\n');
end;
$teams$;
