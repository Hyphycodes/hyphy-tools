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
