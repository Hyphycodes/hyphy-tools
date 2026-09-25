-- Hyphy Tools — DEVELOPMENT ONLY. Never apply to a production database.
--
-- Marks a database as the shared development world and records which seeded people Demo Mode
-- may act as. The app refuses to impersonate anyone, or to reset anything, unless this schema
-- exists and says `development`. Nothing here is visible to the anon or authenticated roles.

create schema if not exists dev;
revoke all on schema dev from public;

create table if not exists dev.environment (
  kind text primary key check (kind = 'development'),
  seeded_at timestamptz
);
insert into dev.environment (kind) values ('development') on conflict do nothing;

-- The seeded people Preview As can switch between: a persona key ("mike") and their identity.
create table if not exists dev.personas (
  key text primary key,
  person_id uuid not null unique
);

revoke all on all tables in schema dev from public;

-- ---------------------------------------------------------------------------------------------
-- What the app's database role (hyphy_app) may do here. It has no write access of its own: the
-- two functions below do the privileged work, check the marker first, and accept only data.
-- ---------------------------------------------------------------------------------------------

grant usage on schema dev to hyphy_app;
grant select on dev.environment, dev.personas to hyphy_app;

-- How many things were done since the last reset: the count on Demo Mode's Reset control.
create or replace function dev.changes_since_seed() returns bigint
language sql stable security definer set search_path = public, dev as $$
  select coalesce((
    select (select count(*) from public.activity a where a.at > e.seeded_at)
         + (select count(*) from public.approval_events x
            where x.at > e.seeded_at and x.action in ('returned', 'approved'))
    from dev.environment e where e.kind = 'development' and e.seeded_at is not null), 0)
$$;

-- Puts the development world back to its seeded story, in one transaction. `world` is rows
-- (src/lib/data/supabase/world.ts): table → [{column: value}]. Tables come from the fixed list
-- below, never from the input; column names are quoted; values are typed by the table's own row
-- type. Every lock is taken before anything is touched, so pages being read wait for it.
create or replace function dev.reset_world(world jsonb) returns void
language plpgsql security definer set search_path = public, dev as $$
declare
  target text;
  cols text;
  seeded uuid[];
begin
  if not exists (select 1 from dev.environment where kind = 'development') then
    raise exception 'Refusing to seed: this database is not the Hyphy Tools development world.';
  end if;
  -- Never empty the world by accident: a malformed call is refused before anything is touched.
  if jsonb_typeof(world -> 'tables') is distinct from 'object'
     or coalesce(jsonb_array_length(world -> 'tables' -> 'public.spaces'), 0) = 0
     or coalesce(jsonb_array_length(world -> 'tables' -> 'auth.users'), 0) = 0
     or (world ->> 'seededAt') is null then
    raise exception 'Refusing to seed: that isn''t a Hyphy Tools world.';
  end if;
  perform set_config('hyphy.seeding', 'on', true);
  perform set_config('lock_timeout', '10s', true);
  lock table public.pins, public.approval_events, public.activity, public.inbox_items,
    public.file_attachments, public.qr_codes, public.link_pages, public.receipts,
    public.mileage_entries, public.files, public.vehicles, public.projects, public.space_members,
    public.spaces, public.profiles, dev.personas in access exclusive mode;
  truncate table public.pins, public.approval_events, public.activity, public.inbox_items,
    public.file_attachments, public.qr_codes, public.link_pages, public.receipts,
    public.mileage_entries, public.files, public.vehicles, public.projects, public.space_members,
    public.spaces, public.profiles cascade;
  delete from dev.personas;
  seeded := array(select (row ->> 'id')::uuid from jsonb_array_elements(world -> 'tables' -> 'auth.users') row);
  -- Identities made during the session (invitations) go; the seeded people stay.
  delete from auth.users where id <> all (seeded);
  foreach target in array array[
    'auth.users', 'public.profiles', 'public.spaces', 'public.space_members', 'public.projects',
    'public.vehicles', 'public.files', 'public.file_attachments', 'public.receipts',
    'public.mileage_entries', 'public.link_pages', 'public.qr_codes', 'public.activity',
    'public.inbox_items', 'public.approval_events', 'public.pins', 'dev.personas'
  ] loop
    if coalesce(jsonb_array_length(world -> 'tables' -> target), 0) = 0 then continue; end if;
    select string_agg(quote_ident(key), ', ') into cols
    from jsonb_object_keys(world -> 'tables' -> target -> 0) key;
    execute format(
      'insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) %s',
      target, cols, cols, target,
      case when target = 'auth.users' then 'on conflict (id) do nothing' else '' end
    ) using world -> 'tables' -> target;
  end loop;
  update dev.environment set seeded_at = (world ->> 'seededAt')::timestamptz;
end;
$$;

revoke all on function dev.changes_since_seed(), dev.reset_world(jsonb) from public, anon, authenticated;
grant execute on function dev.changes_since_seed(), dev.reset_world(jsonb) to hyphy_app;
