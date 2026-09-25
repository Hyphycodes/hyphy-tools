-- Hyphy Tools — what each persona can see, as a fingerprint.
--
-- For each persona in each of their Spaces: how many rows of every table they can read under
-- Row Level Security, and a hash of exactly which ids. Seeded ids are deterministic, so two
-- databases holding the development world must return identical output — local Postgres (whose
-- rows tests/data.spec.ts proves identical to Demo Mode's) and hosted Supabase. Read-only.

create or replace function pg_temp.did(key text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('hyphy-demo:' || key, 'UTF8')), 'hex') as h) x
$$;

create or replace function pg_temp.fingerprint()
returns table (persona text, space text, source text, rows bigint, ids text)
language plpgsql as $$
declare
  view record;
  t text;
begin
  for view in
    select * from (values
      ('jerry', 'sp_personal_jerry'), ('jerry', 'sp_hyphy'), ('jerry', 'sp_abc'), ('jerry', 'sp_se'),
      ('dana', 'sp_abc'), ('luis', 'sp_abc'), ('ray', 'sp_abc'), ('mike', 'sp_abc'),
      ('tasha', 'sp_abc'), ('chris', 'sp_abc'), ('sarah', 'sp_hyphy'), ('ava', 'sp_hyphy'),
      ('rosa', 'sp_se'), ('omar', 'sp_se')) v(p, s)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.did(view.p), 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', pg_temp.did(view.p)::text, true);
    foreach t in array array['projects', 'vehicles', 'receipts', 'mileage_entries', 'files',
      'qr_codes', 'link_pages', 'activity', 'inbox_items', 'space_members', 'approval_events',
      'approval_queue']
    loop
      persona := view.p; space := view.s; source := t;
      execute format(
        'select count(*), md5(coalesce(string_agg(id::text, '','' order by id::text), ''''))
         from public.%I where space_id = $1', t)
        into rows, ids using pg_temp.did(view.s);
      return next;
    end loop;
    persona := view.p; space := view.s; source := 'space_directory()';
    select count(*), md5(coalesce(string_agg(d.id::text, ',' order by d.id::text), ''))
      into rows, ids from public.space_directory(pg_temp.did(view.s)) d;
    return next;
    -- The business's own setup (Phase 2C): which fields and rules this persona can read.
    source := 'custom_fields';
    select count(*), md5(coalesce(string_agg(f.applies_to || ':' || f.key, ',' order by f.applies_to, f.key), ''))
      into rows, ids from public.custom_fields f where f.space_id = pg_temp.did(view.s);
    return next;
    source := 'space_settings';
    select count(*), md5(coalesce(string_agg(ss.settings::text, ','), ''))
      into rows, ids from public.space_settings ss where ss.space_id = pg_temp.did(view.s);
    return next;
    source := 'pins';
    select count(*), md5(coalesce(string_agg(p.target_type || ':' || p.target_id, ',' order by p.target_id), ''))
      into rows, ids from public.pins p where p.space_id = pg_temp.did(view.s);
    return next;
    perform set_config('role', 'none', true);
  end loop;
end;
$$;

select md5(string_agg(persona || '/' || space || '/' || source || '=' || rows || ':' || ids, E'\n'
                      order by persona, space, source)) as fingerprint,
       count(*) as checks, sum(rows) as rows_seen
from pg_temp.fingerprint();
