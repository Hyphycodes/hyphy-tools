-- Hyphy Tools — hardening for hosted Supabase, found deploying to hyphy-tools-dev.
--
-- 1. Hosted Supabase publishes the `public` schema through its Data API to anyone holding the
--    project's publishable key, as the `anon` role, and grants every new table and function to
--    `anon` and `authenticated` by default. Hyphy Tools never uses `anon`: take it all away, now
--    and for anything created later.
-- 2. `ref_label` is a security-definer helper for the activity triggers; callable directly, it
--    would name any project or vehicle by id, in any Space. Only the triggers may use it.
-- 3. Seeding mode (`public.seeding()`) silences the review guard and the activity triggers. It is
--    for `dev.reset_world` only, so it now ignores the flag for requests running as a person.
-- 4. `hyphy_app`: the role the app logs in as. It can do nothing itself — no table, no function —
--    except become `authenticated` for one transaction as a given person, so Row Level Security
--    decides every row even if the app's credentials leak. Its password is set outside
--    migrations, per environment (supabase/README.md).

-- 1 ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
-- Functions `authenticated` really calls: the policy helpers and the two RPC-style functions.
grant execute on function public.role_in(uuid), public.can(uuid, text), public.is_member(uuid),
  public.can_see_project(uuid), public.can_see_file(uuid), public.seeding(),
  public.trip_label(text, text), public.invite_member(uuid, text, text, public.space_role, text, uuid[]),
  public.space_directory(uuid) to authenticated;

-- 2 ---------------------------------------------------------------------------------------------
revoke execute on function public.ref_label(text, uuid) from authenticated;
revoke execute on function public.write_activity(uuid, uuid, text, text, uuid, text, text, uuid, text)
  from authenticated;

-- 3 ---------------------------------------------------------------------------------------------
create or replace function public.seeding() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('hyphy.seeding', true), '') = 'on'
     and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon')
$$;

-- 4 ---------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'hyphy_app') then
    create role hyphy_app nologin noinherit;
  end if;
end $$;
grant authenticated to hyphy_app;
comment on role hyphy_app is
  'Hyphy Tools app. Owns nothing, may only SET ROLE authenticated per transaction (RLS applies).';

-- 5 ---------------------------------------------------------------------------------------------
-- The Space directory named every member to every member — including guests, who could list a
-- whole company's staff with emails and phones. Guests now get themselves and the leads and teams
-- of the projects shared with them: every name those projects' records can show.
create or replace function public.space_directory(space uuid)
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from profiles p
  where is_member(space)
    and exists (select 1 from space_members m where m.space_id = space and m.person_id = p.id)
    and (
      role_in(space) is distinct from 'guest'
      or p.id = auth.uid()
      or exists (
        select 1 from projects pr
        where pr.space_id = space and can_see_project(pr.id)
          and (pr.lead_id = p.id or p.id = any (pr.team_ids))
      )
    )
$$;
