-- Hyphy Tools — Business Spaces, teams and invitations (Phase 2B).
--
-- One person, one account, many Spaces. This migration lets a real person create a Business,
-- bring people into it and run it, with the database — not the interface — deciding every step:
--
--   1. Creating a Business: one transaction makes the Space and its owner membership. Retrying
--      with the same request key returns the same Business.
--   2. Invitations are not memberships. An invitation is an email address, a role and a secret
--      link (only its SHA-256 is stored). A membership exists only after the person, signed in
--      with a *confirmed* Supabase Auth email equal to the invited one, accepts it explicitly.
--      Pending invitations expire after 7 days; resending replaces the link; revoking ends it.
--      There is at most one pending invitation per address per Space.
--   3. Managing people: role changes, removal, leaving and ownership transfer each go through one
--      checked function. People can no longer write memberships directly.
--   4. Every Business has exactly one owner, always (checked at commit). Ownership moves only by
--      an explicit transfer from the owner to an active, non-guest member.
--   5. Removal keeps history: a removed membership stays as `removed`, so names on records still
--      resolve, but it grants nothing. Every Space-owned table now also requires a *current*
--      membership to read or write anything (a restrictive policy), so a former member can't
--      reach their old receipts, projects or activity by id.
--   6. The development-only placeholder invitation (`invite_member`) now refuses to run anywhere
--      but the development world, where Demo Mode still uses it.
--
-- Function conventions: security definer, `search_path = ''`, every name qualified, callers
-- identified by `auth.uid()` only, never by an id they pass in.

-- 1 ---------------------------------------------------------------------------------------------

alter table public.spaces
  add column business_type text check (business_type in (
    'construction', 'hospitality', 'real-estate', 'creative', 'field-services', 'professional',
    'retail', 'other')),
  -- The key of the request that created it, so a retried "Create" returns the same Business.
  add column creation_key uuid unique,
  -- When the owner finished (or skipped) the short setup after creating it.
  add column setup_done_at timestamptz;

-- The new pages' addresses join the reserved list (src/lib/auth/routes.ts).
alter table public.spaces drop constraint spaces_slug_not_reserved;
alter table public.spaces add constraint spaces_slug_not_reserved check (
  slug not in ('personal', 'auth', 'sign-in', 'sign-up', 'sign-out', 'forgot-password',
               'reset-password', 'welcome', 'account', 'api', 'platform', 'invite', 'invites',
               'create-business', 'new', 'dev', 'settings', 'help')
);

-- Businesses that exist already were set up before this flow existed.
update public.spaces set setup_done_at = created_at where kind = 'business' and setup_done_at is null;

-- Owners and admins can change the type and finish setup; the address (slug) stays fixed.
grant update (business_type, setup_done_at) on public.spaces to authenticated;

create or replace function public.create_business(
  business_name text, address text, kind text, exact_address boolean, request_key uuid,
  preset_modules text[], preset_work_style text, preset_labels jsonb, preset_brand jsonb,
  preset_descriptor text
) returns table (space_id uuid, space_slug text, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  clean_name text := btrim(regexp_replace(coalesce(business_name, ''), '\s+', ' ', 'g'));
  base text := lower(btrim(coalesce(address, '')));
  candidate text;
  new_space uuid;
  tz text;
  attempt int := 1;
  failed_constraint text;
begin
  if me is null then
    raise exception 'Sign in to create a business.' using errcode = '42501';
  end if;
  select timezone into tz from public.profiles where id = me;
  if not found then
    raise exception 'Your account isn’t set up yet.' using errcode = '42501';
  end if;

  -- The same request again (a double click, a retried network call): the same Business.
  if request_key is not null then
    select s.id, s.slug into new_space, candidate from public.spaces s where s.creation_key = request_key;
    if found then
      if exists (select 1 from public.space_members m where m.space_id = new_space
                 and m.person_id = me and m.role = 'owner' and m.status = 'active') then
        return query select new_space, candidate, false;
        return;
      end if;
      raise exception 'That request was already used.' using errcode = '42501';
    end if;
  end if;

  if char_length(clean_name) < 1 or char_length(clean_name) > 80 then
    raise exception 'Give the business a name (up to 80 characters).';
  end if;
  if base !~ '^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$' or base ~ '--' then
    raise exception 'Use 2–48 lowercase letters, numbers and single dashes for the address.';
  end if;
  if kind is null or kind not in ('construction', 'hospitality', 'real-estate', 'creative',
                                  'field-services', 'professional', 'retail', 'other') then
    raise exception 'Choose what kind of business this is.';
  end if;
  if preset_work_style not in ('jobs', 'events', 'engagements') then
    raise exception 'Unknown work style.';
  end if;
  if preset_modules is null or not preset_modules <@ array['projects', 'vehicles', 'people',
       'files', 'receipts', 'mileage', 'pdf', 'qr', 'images', 'links'] then
    raise exception 'Unknown tools.';
  end if;
  -- Enough for any real owner; a ceiling for scripts.
  if (select count(*) from public.space_members m join public.spaces s on s.id = m.space_id
      where m.person_id = me and m.role = 'owner' and m.status = 'active' and s.kind = 'business') >= 25 then
    raise exception 'You own 25 businesses already.';
  end if;

  candidate := base;
  loop
    begin
      insert into public.spaces (slug, kind, name, descriptor, plan, modules, labels, brand,
                                 timezone, work_style, business_type, creation_key)
      values (candidate, 'business', clean_name, left(coalesce(preset_descriptor, ''), 80),
              -- Billing isn't active: every new Business has the full preview plan.
              'business-pro',
              array(select distinct unnest(preset_modules || array['files', 'people'])),
              coalesce(preset_labels, '{}'::jsonb), coalesce(preset_brand, '{}'::jsonb),
              coalesce(tz, 'America/Chicago'), preset_work_style, kind, request_key)
      returning id into new_space;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics failed_constraint = constraint_name;
        if failed_constraint = 'spaces_creation_key_key' then
          -- The same request, a moment earlier, on another connection: it has committed by now,
          -- so answer with its business (if it's this person's).
          select s.id, s.slug into new_space, candidate from public.spaces s
           where s.creation_key = request_key;
          if exists (select 1 from public.space_members m where m.space_id = new_space
                     and m.person_id = me and m.role = 'owner' and m.status = 'active') then
            return query select new_space, candidate, false;
            return;
          end if;
          raise exception 'That request was already used.' using errcode = '42501';
        end if;
        if exact_address or attempt >= 30 then
          raise exception 'That address is taken. Try another.';
        end if;
        attempt := attempt + 1;
        candidate := left(base, 44) || '-' || attempt;
      when check_violation then
        get stacked diagnostics failed_constraint = constraint_name;
        if failed_constraint = 'spaces_slug_not_reserved' then
          raise exception 'That address is reserved. Try another.';
        end if;
        raise;
    end;
  end loop;

  insert into public.space_members (space_id, person_id, role, title, status)
  values (new_space, me, 'owner', 'Owner', 'active');
  return query select new_space, candidate, true;
end;
$$;

-- 2 ---------------------------------------------------------------------------------------------

create table public.space_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  -- Always stored lowercased and trimmed; compared with the confirmed Auth email the same way.
  email text not null check (
    email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  ),
  -- How the inviter refers to them until they join (their account's name takes over then).
  name text not null default '' check (char_length(name) <= 80),
  role public.space_role not null check (role <> 'owner'),
  title text not null default '' check (char_length(title) <= 80),
  project_ids uuid[] not null default '{}',
  note text check (char_length(note) <= 280),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  -- SHA-256 of the secret in the link. The secret itself is never stored.
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz not null default now(),
  send_count integer not null default 1,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  check ((status = 'accepted') = (accepted_at is not null and accepted_by is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);
-- One live invitation per address per Space: resending reuses it.
create unique index space_invitations_one_pending on public.space_invitations (space_id, email)
  where status = 'pending';
create index space_invitations_space on public.space_invitations (space_id, status, created_at desc);
create index space_invitations_invited_by on public.space_invitations (invited_by);
create index space_invitations_accepted_by on public.space_invitations (accepted_by)
  where accepted_by is not null;
alter table public.space_invitations enable row level security;

create policy "People managers see their Space's invitations" on public.space_invitations
  for select to authenticated using (public.can(space_id, 'people.manage'));

-- Read through the policy, never written directly, and never the link's hash.
revoke all on public.space_invitations from anon, authenticated;
grant select (id, space_id, email, name, role, title, project_ids, note, status, invited_by,
              created_at, sent_at, send_count, expires_at, accepted_at, accepted_by, revoked_at)
  on public.space_invitations to authenticated;

-- The hash of a link's secret. The secret is 32 random bytes, base64url, made by the server.
create or replace function private.invitation_hash(token text)
returns bytea language plpgsql immutable set search_path = '' as $$
begin
  if token is null or token !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise exception 'Not an invitation link.';
  end if;
  return pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8'));
end;
$$;

-- Who may hand out a role in this Space: people managers; only the owner adds admins; nobody
-- invites an owner (ownership moves by transfer).
create or replace function private.check_grantable(space uuid, grant_role public.space_role)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business') then
    raise exception 'Teams are for Business Spaces.' using errcode = '42501';
  end if;
  if not public.can(space, 'people.manage') then
    raise exception 'Your role in this business can’t manage people.' using errcode = '42501';
  end if;
  if grant_role = 'owner' then
    raise exception 'Ownership moves only by transferring it.' using errcode = '42501';
  end if;
  if grant_role = 'admin' and public.role_in(space) <> 'owner' then
    raise exception 'Only the owner can add admins.' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.check_projects(space uuid, projects uuid[])
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare wanted uuid[] := array(select distinct unnest(coalesce(projects, '{}'::uuid[])));
begin
  if (select count(*) from public.projects p where p.space_id = space and p.id = any (wanted))
     <> cardinality(wanted) then
    raise exception 'Something in that doesn’t match this business.';
  end if;
  return wanted;
end;
$$;

create or replace function public.create_invitation(
  space uuid, invitee_email text, invitee_role public.space_role, invitee_name text,
  invitee_title text, invitee_projects uuid[], invitee_note text, token text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(btrim(coalesce(invitee_email, '')));
  invitation uuid;
begin
  perform private.check_grantable(space, invitee_role);
  if address !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(address) > 254 then
    raise exception 'Check the email address.';
  end if;
  if exists (select 1 from public.space_members m join public.profiles p on p.id = m.person_id
             where m.space_id = space and m.status = 'active' and lower(p.email) = address) then
    raise exception 'They’re already part of this business.';
  end if;
  if exists (select 1 from public.space_invitations i where i.space_id = space
             and i.email = address and i.status = 'pending') then
    raise exception 'There’s already an invitation for that email. Resend it from People.';
  end if;
  if (select count(*) from public.space_invitations i where i.space_id = space
      and i.status = 'pending') >= 500 then
    raise exception 'This business has 500 open invitations. Revoke some first.';
  end if;
  insert into public.space_invitations (space_id, email, name, role, title, project_ids, note,
                                        token_hash, invited_by, expires_at)
  values (space, address, left(btrim(coalesce(invitee_name, '')), 80), invitee_role,
          left(btrim(coalesce(invitee_title, '')), 80),
          private.check_projects(space, invitee_projects),
          nullif(left(btrim(coalesce(invitee_note, '')), 280), ''),
          private.invitation_hash(token), auth.uid(), now() + interval '7 days')
  returning id into invitation;
  return invitation;
end;
$$;

-- A new link for a pending invitation (also renews an expired one). The old link stops working
-- at once. `deliver` marks an emailed resend, which is limited to one a minute.
create or replace function public.renew_invitation(invitation uuid, token text, deliver boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.space_invitations;
begin
  select * into inv from public.space_invitations where id = invitation for update;
  if not found or not public.can(inv.space_id, 'people.manage') then
    raise exception 'That invitation isn’t available to you.' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already %.', inv.status;
  end if;
  if deliver and inv.sent_at > now() - interval '1 minute' then
    raise exception 'It was just sent. Wait a minute before sending it again.';
  end if;
  update public.space_invitations
     set token_hash = private.invitation_hash(token), expires_at = now() + interval '7 days',
         sent_at = case when deliver then now() else sent_at end,
         send_count = send_count + case when deliver then 1 else 0 end
   where id = invitation;
end;
$$;

create or replace function public.revoke_invitation(invitation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.space_invitations;
begin
  select * into inv from public.space_invitations where id = invitation for update;
  if not found or not public.can(inv.space_id, 'people.manage') then
    raise exception 'That invitation isn’t available to you.' using errcode = '42501';
  end if;
  if inv.status = 'accepted' then
    raise exception 'They already joined. Remove them from People instead.';
  end if;
  if inv.status = 'pending' then
    update public.space_invitations
       set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
     where id = invitation;
  end if;
end;
$$;

-- The role (and, for guests, projects) an invitation will grant, changed before it's accepted.
-- The email never changes: revoke and invite again.
create or replace function public.set_invitation_role(
  invitation uuid, invitee_role public.space_role, invitee_projects uuid[]
) returns void language plpgsql security definer set search_path = '' as $$
declare inv public.space_invitations;
begin
  select * into inv from public.space_invitations where id = invitation for update;
  if not found or not public.can(inv.space_id, 'people.manage') then
    raise exception 'That invitation isn’t available to you.' using errcode = '42501';
  end if;
  if inv.status <> 'pending' then
    raise exception 'That invitation was already %.', inv.status;
  end if;
  perform private.check_grantable(inv.space_id, invitee_role);
  -- Changing an admin invitation is the owner's call too.
  if inv.role = 'admin' and public.role_in(inv.space_id) <> 'owner' then
    raise exception 'Only the owner can change an admin invitation.' using errcode = '42501';
  end if;
  update public.space_invitations
     set role = invitee_role,
         project_ids = private.check_projects(inv.space_id, coalesce(invitee_projects, inv.project_ids))
   where id = invitation;
end;
$$;

-- What an invitation link shows before anyone signs in: whose business, from whom, which role,
-- for which address. Only someone holding the link's secret can ask. Callable only by the app's
-- database role (hyphy_app), never through the Data API.
create or replace function private.invitation_preview(token text)
returns table (
  invitation_id uuid, space_id uuid, space_name text, space_brand jsonb, email text,
  role public.space_role, title text, note text, inviter_name text, status text,
  expires_at timestamptz
) language sql stable security definer set search_path = '' as $$
  select i.id, i.space_id, s.name, s.brand, i.email, i.role, i.title, i.note, p.name,
         case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
         i.expires_at
  from public.space_invitations i
  join public.spaces s on s.id = i.space_id
  join public.profiles p on p.id = i.invited_by
  where i.token_hash = private.invitation_hash(token)
$$;

-- Accepting: the one way into a Business. The person is `auth.uid()`; their address is the
-- confirmed email Supabase Auth holds for them (never the editable profile, never the browser).
-- Answers with an outcome instead of failing, so the page can say what happened:
--   joined · already_member · invalid · expired · revoked · used · wrong_account · unconfirmed
create or replace function public.accept_invitation(token text)
returns table (outcome text, space_id uuid, space_slug text)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  login_email text;
  confirmed timestamptz;
  inv public.space_invitations;
  membership public.space_members;
  target_slug text;
  hashed bytea;
begin
  if me is null then
    raise exception 'Sign in to accept an invitation.' using errcode = '42501';
  end if;
  begin
    hashed := private.invitation_hash(token);
  exception when others then
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end;
  select * into inv from public.space_invitations where token_hash = hashed for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end if;
  select s.slug into target_slug from public.spaces s where s.id = inv.space_id;
  if inv.status = 'accepted' then
    return query select case when inv.accepted_by = me then 'already_member' else 'used' end,
                        case when inv.accepted_by = me then inv.space_id end,
                        case when inv.accepted_by = me then target_slug end;
    return;
  end if;
  if inv.status = 'revoked' then
    return query select 'revoked'::text, null::uuid, null::text;
    return;
  end if;
  if inv.expires_at < now() then
    return query select 'expired'::text, null::uuid, null::text;
    return;
  end if;
  select u.email, u.email_confirmed_at into login_email, confirmed from auth.users u where u.id = me;
  if confirmed is null then
    return query select 'unconfirmed'::text, null::uuid, null::text;
    return;
  end if;
  if lower(btrim(coalesce(login_email, ''))) <> inv.email then
    return query select 'wrong_account'::text, null::uuid, null::text;
    return;
  end if;

  select * into membership from public.space_members m
   where m.space_id = inv.space_id and m.person_id = me for update;
  if found and membership.status = 'active' then
    -- Already in (joined some other way): nothing changes but the invitation is used up.
    update public.space_invitations set status = 'accepted', accepted_at = now(), accepted_by = me
     where id = inv.id;
    return query select 'already_member'::text, inv.space_id, target_slug;
    return;
  elsif found then
    -- A former member (or a development placeholder) comes back with the invited role.
    update public.space_members
       set role = inv.role, title = coalesce(nullif(inv.title, ''), membership.title),
           project_ids = inv.project_ids, status = 'active', removed_at = null, removed_by = null,
           joined_at = now()
     where id = membership.id;
  else
    insert into public.space_members (space_id, person_id, role, title, status, project_ids)
    values (inv.space_id, me, inv.role, inv.title, 'active', inv.project_ids);
  end if;
  update public.space_invitations set status = 'accepted', accepted_at = now(), accepted_by = me
   where id = inv.id;
  return query select 'joined'::text, inv.space_id, target_slug;
end;
$$;

-- 3 ---------------------------------------------------------------------------------------------

alter table public.space_members drop constraint space_members_status_check;
alter table public.space_members
  add constraint space_members_status_check check (status in ('invited', 'active', 'removed')),
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles (id);

-- Memberships change only through the functions below (and acceptance above).
drop policy "People managers invite" on public.space_members;
drop policy "People managers change roles" on public.space_members;
revoke insert, update, delete on public.space_members from authenticated;

create or replace function private.lock_member(space uuid, person uuid)
returns public.space_members language plpgsql security definer set search_path = '' as $$
declare membership public.space_members;
begin
  select * into membership from public.space_members m
   where m.space_id = space and m.person_id = person and m.status = 'active' for update;
  if not found then
    raise exception 'They aren’t an active member of this business.';
  end if;
  return membership;
end;
$$;

create or replace function public.set_member_role(space uuid, person uuid, member_role public.space_role)
returns void language plpgsql security definer set search_path = '' as $$
declare membership public.space_members;
begin
  perform private.check_grantable(space, member_role);
  if person = auth.uid() then
    raise exception 'You can’t change your own role.' using errcode = '42501';
  end if;
  membership := private.lock_member(space, person);
  if membership.role = 'owner' then
    raise exception 'The owner’s role changes only by transferring ownership.' using errcode = '42501';
  end if;
  if membership.role = 'admin' and public.role_in(space) <> 'owner' then
    raise exception 'Only the owner can change an admin’s role.' using errcode = '42501';
  end if;
  update public.space_members set role = member_role where id = membership.id;
end;
$$;

create or replace function public.remove_member(space uuid, person uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare membership public.space_members;
begin
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business')
     or not public.can(space, 'people.manage') then
    raise exception 'Your role in this business can’t remove people.' using errcode = '42501';
  end if;
  if person = auth.uid() then
    raise exception 'To leave, use Leave business.' using errcode = '42501';
  end if;
  membership := private.lock_member(space, person);
  if membership.role = 'owner' then
    raise exception 'The owner can’t be removed.' using errcode = '42501';
  end if;
  if membership.role = 'admin' and public.role_in(space) <> 'owner' then
    raise exception 'Only the owner can remove an admin.' using errcode = '42501';
  end if;
  update public.space_members
     set status = 'removed', removed_at = now(), removed_by = auth.uid()
   where id = membership.id;
end;
$$;

create or replace function public.leave_space(space uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare membership public.space_members;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business') then
    raise exception 'Your Personal Space is always yours.' using errcode = '42501';
  end if;
  membership := private.lock_member(space, auth.uid());
  if membership.role = 'owner' then
    raise exception 'Transfer ownership before leaving.' using errcode = '42501';
  end if;
  update public.space_members
     set status = 'removed', removed_at = now(), removed_by = auth.uid()
   where id = membership.id;
end;
$$;

-- The owner hands the Business to an active, non-guest member and becomes an admin.
create or replace function public.transfer_ownership(space uuid, person uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  mine public.space_members;
  theirs public.space_members;
begin
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business')
     or public.role_in(space) is distinct from 'owner' then
    raise exception 'Only the owner can transfer the business.' using errcode = '42501';
  end if;
  if person = auth.uid() then
    raise exception 'Choose someone else.';
  end if;
  -- Lock both memberships in a fixed order, so two transfers can't cross.
  perform 1 from public.space_members m
   where m.space_id = space and m.person_id in (auth.uid(), person)
   order by m.person_id for update;
  mine := private.lock_member(space, auth.uid());
  theirs := private.lock_member(space, person);
  if theirs.role = 'guest' then
    raise exception 'Guests can’t own a business. Change their role first.';
  end if;
  update public.space_members set role = 'owner', title = 'Owner' where id = theirs.id;
  update public.space_members
     set role = 'admin', title = case when mine.title in ('', 'Owner') then 'Admin' else mine.title end
   where id = mine.id;
end;
$$;

-- 4 ---------------------------------------------------------------------------------------------

create or replace function private.check_one_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  space uuid := coalesce(new.space_id, old.space_id);
  owners integer;
begin
  -- Personal Spaces have their own guard; a deleted Space has no memberships to check.
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business') then
    return null;
  end if;
  select count(*) into owners from public.space_members m
   where m.space_id = space and m.role = 'owner' and m.status = 'active';
  if owners <> 1 then
    raise exception 'A business always has exactly one owner.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger space_members_one_owner
  after insert or update or delete on public.space_members
  deferrable initially deferred
  for each row execute function private.check_one_owner();

-- What happened to a membership, in the Space's activity.
create or replace function public.log_membership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  who text := (select name from profiles where id = new.person_id);
  place text := (select name from spaces where id = new.space_id);
  role_label text := initcap(new.role::text);
begin
  if tg_op = 'INSERT' then
    if new.status = 'invited' then
      perform write_activity(new.space_id, coalesce(auth.uid(), new.person_id), 'invited', 'person',
        new.person_id, who, null, null, new.title);
    elsif new.status = 'active' and new.role <> 'owner' then
      -- "Sam joined ABC Construction · Member"
      perform write_activity(new.space_id, new.person_id, 'joined', 'space', new.space_id, place,
        null, null, role_label);
    end if;
    return new;
  end if;
  if new.status = 'active' and old.status <> 'active' then
    perform write_activity(new.space_id, new.person_id, 'joined', 'space', new.space_id, place,
      null, null, role_label);
  elsif new.status = 'removed' and old.status <> 'removed' then
    if new.removed_by = new.person_id then
      -- "Sam left ABC Construction"
      perform write_activity(new.space_id, new.person_id, 'left', 'space', new.space_id, place);
    else
      -- "Dana removed Sam Rivera"
      perform write_activity(new.space_id, coalesce(auth.uid(), new.removed_by), 'removed', 'person',
        new.person_id, who);
    end if;
  elsif new.status = 'active' and new.role <> old.role then
    -- "Dana updated Sam Rivera · Manager"
    perform write_activity(new.space_id, coalesce(auth.uid(), new.person_id), 'updated', 'person',
      new.person_id, who, null, null, role_label);
  end if;
  return new;
end;
$$;
drop trigger if exists space_members_logged on public.space_members;
create trigger space_members_logged after insert or update on public.space_members
  for each row execute function public.log_membership();

-- 5 ---------------------------------------------------------------------------------------------

-- Every Space-owned row needs a current membership in its Space, on top of each table's own
-- rules. (Those rules already imply it for most paths; "your own receipts", "projects you're on"
-- and "your own activity" didn't, so a removed member could still read them by id.)
do $$
declare t text;
begin
  foreach t in array array['projects', 'vehicles', 'receipts', 'mileage_entries', 'files',
                           'qr_codes', 'link_pages', 'activity', 'inbox_items',
                           'approval_events', 'pins'] loop
    execute format(
      'create policy "Only current members" on public.%I as restrictive for all to authenticated
         using (public.is_member(space_id)) with check (public.is_member(space_id))', t);
  end loop;
end $$;

-- 6 ---------------------------------------------------------------------------------------------

-- Demo Mode on the development database still invites its fictional people this way. Anywhere
-- else it would reserve a real address in Supabase Auth, so it refuses.
create or replace function public.invite_member(
  space uuid, invitee_name text, invitee_email text, invitee_role public.space_role,
  invitee_title text, invitee_projects uuid[]
) returns uuid language plpgsql security definer set search_path = public, auth as $$
declare
  person uuid;
  development boolean := false;
begin
  if to_regclass('dev.environment') is not null then
    execute 'select exists (select 1 from dev.environment where kind = ''development'')'
      into development;
  end if;
  if not development then
    raise exception 'Invite people with an invitation (create_invitation).' using errcode = '42501';
  end if;
  if not can(space, 'people.manage') then
    raise exception 'Your role in this Space can’t invite people.' using errcode = '42501';
  end if;
  if invitee_role in ('owner', 'admin') and role_in(space) <> 'owner' then
    raise exception 'Only an owner can add owners or admins.' using errcode = '42501';
  end if;
  if invitee_role = 'owner' then
    raise exception 'Ownership moves only by transferring it.' using errcode = '42501';
  end if;
  select id into person from public.profiles where lower(email) = lower(invitee_email);
  if person is null then
    person := gen_random_uuid();
    insert into auth.users (id, email) values (person, invitee_email);
    insert into public.profiles (id, name, email) values (person, invitee_name, invitee_email)
    on conflict (id) do update set name = excluded.name;
  end if;
  insert into space_members (space_id, person_id, role, title, status, project_ids)
  values (space, person, invitee_role, invitee_title, 'invited', coalesce(invitee_projects, '{}'));
  return person;
end;
$$;

-- Grants ----------------------------------------------------------------------------------------

revoke execute on function
  public.create_business(text, text, text, boolean, uuid, text[], text, jsonb, jsonb, text),
  public.create_invitation(uuid, text, public.space_role, text, text, uuid[], text, text),
  public.renew_invitation(uuid, text, boolean),
  public.revoke_invitation(uuid),
  public.set_invitation_role(uuid, public.space_role, uuid[]),
  public.accept_invitation(text),
  public.set_member_role(uuid, uuid, public.space_role),
  public.remove_member(uuid, uuid),
  public.leave_space(uuid),
  public.transfer_ownership(uuid, uuid)
  from public, anon;
grant execute on function
  public.create_business(text, text, text, boolean, uuid, text[], text, jsonb, jsonb, text),
  public.create_invitation(uuid, text, public.space_role, text, text, uuid[], text, text),
  public.renew_invitation(uuid, text, boolean),
  public.revoke_invitation(uuid),
  public.set_invitation_role(uuid, public.space_role, uuid[]),
  public.accept_invitation(text),
  public.set_member_role(uuid, uuid, public.space_role),
  public.remove_member(uuid, uuid),
  public.leave_space(uuid),
  public.transfer_ownership(uuid, uuid)
  to authenticated;
revoke execute on function public.log_membership() from public, anon, authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
-- The app's own role may look up an invitation by its link (to show it before sign-in); nothing
-- else in `private`.
grant usage on schema private to hyphy_app;
grant execute on function private.invitation_preview(text) to hyphy_app;
