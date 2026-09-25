-- Hyphy Tools — real accounts (Phase 2A).
--
-- Supabase Auth says who someone is; this database says what they may do. A real account is a row
-- in `auth.users` whose id is also their Hyphy profile id (`profiles.id = auth.users.id`, already
-- the foreign key). This migration makes that relationship self-maintaining:
--
--   1. Bootstrap. When Supabase Auth creates a user, they get — exactly once — a profile, a
--      Personal Space and an owner membership of it. Idempotent by construction (primary key,
--      one-personal-Space index, one-membership-per-Space key), so a retry, a repeated sign-in or
--      a race can never make a second of anything.
--   2. Email. The login email belongs to Supabase Auth. The profile keeps a copy for names on
--      records and invitation lookups; it follows Auth when the email changes, and nobody can
--      edit it directly (so nobody can claim someone else's address to catch their invitations).
--   3. Personal Spaces hold one person: their owner. Nobody can be added to anyone's Personal
--      Space, and its owner stays its owner.
--   4. The sign-in pages' addresses can't be taken as a Space's address.
--
-- The privileged code lives in `private`, a schema the Data API doesn't expose and no request
-- role can use. The trigger functions are security definer with an empty search path and every
-- name qualified. Nothing here reads user metadata for access: the only thing taken from it is
-- the display name the person typed when signing up.
--
-- Demo Mode is unaffected: the development personas are seeded with `hyphy.seeding` on, which
-- the bootstrap ignores, and nothing here changes what anyone can see.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 1 ---------------------------------------------------------------------------------------------

-- The one Personal Space a person owns, made if missing. Safe to call any number of times.
create or replace function private.ensure_personal_space(person uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  personal uuid;
begin
  select * into me from public.profiles where id = person;
  if not found then
    raise exception 'No profile for that person.';
  end if;
  insert into public.spaces (kind, name, descriptor, plan, owner_id, brand)
  values ('personal', 'Personal', 'Just for you', 'free', person,
          jsonb_build_object('color', me.hue, 'ink', 'light',
                             'monogram', coalesce(nullif(upper(left(btrim(me.name), 1)), ''), 'H')))
  on conflict (owner_id) where kind = 'personal' do nothing
  returning id into personal;
  if personal is null then
    select id into personal from public.spaces where owner_id = person and kind = 'personal';
  end if;
  insert into public.space_members (space_id, person_id, role, title, status)
  values (personal, person, 'owner', 'Owner', 'active')
  on conflict (space_id, person_id) do nothing;
  return personal;
end;
$$;

-- A person's minimum identity in Hyphy: profile, Personal Space, owner membership.
create or replace function private.ensure_person(person uuid, person_email text, display_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  -- What they typed at sign-up, tidied; else the part of their email before the @.
  cleaned text := left(btrim(regexp_replace(coalesce(display_name, ''), '[[:cntrl:]]+', ' ', 'g')), 80);
begin
  if person is null then
    raise exception 'A person needs an id.';
  end if;
  if cleaned = '' then
    cleaned := left(split_part(coalesce(person_email, ''), '@', 1), 80);
  end if;
  insert into public.profiles (id, name, email)
  values (person, cleaned, coalesce(person_email, ''))
  on conflict (id) do nothing;
  perform private.ensure_personal_space(person);
end;
$$;

create or replace function private.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The development seed brings its own profiles and Spaces.
  if public.seeding() then
    return new;
  end if;
  perform private.ensure_person(new.id, new.email, new.raw_user_meta_data ->> 'name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.on_auth_user_created();

-- New profiles still get their Personal Space from the profile trigger (invitations make
-- profiles too); it now shares the one idempotent implementation above.
create or replace function public.handle_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if seeding() then
    return new;
  end if;
  perform private.ensure_personal_space(new.id);
  return new;
end;
$$;

-- Invitations create a profile for someone new; the auth trigger above now makes it first, so
-- the invitation only sets the name it was given.
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
    insert into public.profiles (id, name, email) values (person, invitee_name, invitee_email)
    on conflict (id) do update set name = excluded.name;
  end if;
  insert into space_members (space_id, person_id, role, title, status, project_ids)
  values (space, person, invitee_role, invitee_title, 'invited', coalesce(invitee_projects, '{}'));
  return person;
end;
$$;

-- Everyone Supabase Auth already knows gets the same start (no-op on a fresh project; on the
-- development project the seeded personas already have profiles and are left exactly as seeded).
do $$ begin
  perform private.ensure_person(u.id, u.email, u.raw_user_meta_data ->> 'name')
  from auth.users u
  where not exists (select 1 from public.profiles p where p.id = u.id);
end $$;

-- 2 ---------------------------------------------------------------------------------------------

create or replace function private.on_auth_user_email_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.on_auth_user_email_changed();

-- People edit their own name and details, never their id or email; profiles are made only by the
-- bootstrap and invitations, and never deleted from a request.
revoke insert, update, delete on public.profiles from authenticated;
grant update (name, hue, headline, phone, timezone) on public.profiles to authenticated;
alter table public.profiles
  add constraint profiles_name_length check (char_length(name) <= 80);

-- 3 ---------------------------------------------------------------------------------------------

create or replace function private.guard_personal_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.spaces s
    where s.id = new.space_id and s.kind = 'personal'
      and (s.owner_id <> new.person_id or new.role <> 'owner')
  ) then
    raise exception 'A Personal Space is just for the person it belongs to.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists space_members_personal on public.space_members;
create trigger space_members_personal before insert or update on public.space_members
  for each row execute function private.guard_personal_membership();

-- 4 ---------------------------------------------------------------------------------------------

-- Addresses the app itself uses can't become a Space's address (src/lib/auth/routes.ts).
alter table public.spaces add constraint spaces_slug_not_reserved check (
  slug not in ('personal', 'auth', 'sign-in', 'sign-up', 'sign-out', 'forgot-password',
               'reset-password', 'welcome', 'account', 'api', 'platform')
);

-- Nothing in `private` is callable from a request, by the app's role, or through the Data API.
revoke execute on all functions in schema private from public, anon, authenticated;
