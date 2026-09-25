-- Hyphy Tools — real files (Phase 2D).
--
-- A file is two things that must agree: its record in `public.files` (who and what it is, which
-- Space it belongs to, what it's attached to) and its bytes in the private Storage bucket
-- `hyphy-files`. The record is the authority. Storage's own Row Level Security asks the record —
-- never the path's shape, never `storage.objects.owner` — so a file belongs to its Space, not to
-- whoever happened to upload it, and a valid path alone opens nothing. docs/FILES.md.
--
--   1. The record: original name, type, bytes' location, status (pending → ready | failed),
--      checksum, dimensions, Trash. Its identity and location never change after it's made.
--   2. Who may see a file: current members only; receipt photos follow their receipt; every
--      member sees the business logo.
--   3. Attachments: one file, many records, all in its own Space and visible to whoever attaches.
--   4. The bucket and the Storage policies.
--   5. Finishing an upload: the database checks the bytes really arrived, at the size and type
--      the record says, before anyone else can see the file.
--   6. Trash, delete for good (never while the bytes are still stored), rename, activity.
--   7. Receipt photos: attached with the receipt, only the submitter's own, one receipt each; a
--      business can require one.
--   8. The business logo: owners and admins only; the old one leaves with it.
--   9. Storage used by a Space, and an operator's reconciliation view.

-- 1 ---------------------------------------------------------------------------------------------

alter table public.files
  add column original_name text check (char_length(original_name) between 1 and 255),
  add column mime_type text,
  add column storage_bucket text check (storage_bucket in ('hyphy-files', 'device')),
  add column status text not null default 'ready' check (status in ('pending', 'ready', 'failed')),
  add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  add column width integer check (width between 1 and 100000),
  add column height integer check (height between 1 and 100000),
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles (id);

comment on column public.files.storage_bucket is
  'Where the bytes are: hyphy-files (Supabase Storage), device (Demo Mode: the uploader''s browser), or null for records made before Phase 2D, which have no bytes.';

alter table public.files
  add constraint files_name_length check (char_length(name) between 1 and 140),
  -- A file with bytes knows where they are and what they were; a record without bytes has none.
  add constraint files_bytes_described check (
    (storage_bucket is null) = (storage_path is null)
    and (storage_bucket is null or (original_name is not null and mime_type is not null))
  ),
  -- The path is made by Hyphy from the file's own Space and id, so no record can point at
  -- another file's bytes, in its Space or anyone else's, and no name can climb out of it.
  add constraint files_path_is_its_own check (
    storage_path is null
    or storage_path ~ ('^spaces/' || space_id::text || '/files/' || id::text || '/[a-z0-9][a-z0-9._-]{0,99}$')
  );

-- A business's logo is one of its files (section 8).
alter table public.spaces add column logo_file_id uuid references public.files (id) on delete set null;
create index spaces_logo on public.spaces (logo_file_id) where logo_file_id is not null;

create unique index files_stored_at on public.files (storage_bucket, storage_path)
  where storage_path is not null;
create index files_deleted_by on public.files (deleted_by) where deleted_by is not null;
create index files_unfinished on public.files (created_by, created_at) where status <> 'ready';

-- What Hyphy accepts, and how big. Mirrors src/lib/files/rules.ts.
create or replace function private.file_allowed(mime text, bytes bigint)
returns boolean language sql immutable set search_path = '' as $$
  select bytes between 1 and case
    when mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif')
      then 20971520
    when mime = 'application/pdf' then 52428800
    when mime in ('application/msword', 'application/vnd.ms-excel',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      then 26214400
    when mime in ('text/plain', 'text/csv') then 5242880
    when mime = 'application/zip' then 52428800
    else 0
  end
$$;

-- 2 ---------------------------------------------------------------------------------------------

-- Every branch now needs a current membership (a removed member who uploaded something no longer
-- reaches it); files still uploading are only their uploader's; a receipt photo is visible exactly
-- when its receipt is; the business logo is every member's.
create or replace function public.can_see_file(file uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from files f
    where f.id = file and is_member(f.space_id) and (
      f.created_by = auth.uid()
      or (f.status = 'ready' and (
        (f.access <> 'private' and can(f.space_id, 'files.view_all'))
        or exists (select 1 from spaces s where s.id = f.space_id and s.logo_file_id = f.id)
        or exists (
          select 1 from file_attachments a join receipts r on r.id = a.record_id
          where a.file_id = f.id and a.record_type = 'receipt' and r.space_id = f.space_id
            and (r.created_by = auth.uid() or can(r.space_id, 'expenses.view_all'))
        )
        or (f.access in ('team', 'shared') and (
          (not exists (select 1 from file_attachments a where a.file_id = f.id)
            and f.access = 'team' and role_in(f.space_id) in ('owner', 'admin', 'manager', 'member'))
          or exists (
            select 1 from file_attachments a where a.file_id = f.id and (
              (a.record_type = 'project' and can_see_project(a.record_id))
              or (a.record_type = 'person' and a.record_id = auth.uid())
              or (a.record_type = 'vehicle' and exists (
                select 1 from vehicles v where v.id = a.record_id and v.assigned_to = auth.uid()))
            )
          )
        ))
      ))
    )
  )
$$;

-- 3 ---------------------------------------------------------------------------------------------

-- Attaching needs the file (your own, or any you can see if you manage files) and the record, in
-- the same Space, visible to you. People: yourself, or anyone if you manage people. Receipts:
-- your own receipt and your own photo (usually written by the receipt itself, section 7).
drop policy "Attach your uploads to what you can see" on public.file_attachments;
create policy "Attach files to records you can see" on public.file_attachments
  for insert to authenticated with check (
    exists (
      select 1 from files f
      where f.id = file_id and f.deleted_at is null and is_member(f.space_id)
        -- A new upload is attached as it starts (by its uploader); others only once it's ready.
        and (f.status = 'ready' or (f.status = 'pending' and f.created_by = auth.uid()))
        and (f.created_by = auth.uid() or (can(f.space_id, 'files.manage') and can_see_file(f.id)))
        and (
          (record_type = 'project' and can_see_project(record_id)
            and exists (select 1 from projects p where p.id = record_id and p.space_id = f.space_id))
          or (record_type = 'vehicle'
            and exists (select 1 from vehicles v where v.id = record_id and v.space_id = f.space_id))
          or (record_type = 'person' and (record_id = auth.uid() or can(f.space_id, 'people.manage'))
            and exists (select 1 from space_members m where m.space_id = f.space_id
                        and m.person_id = record_id and m.status = 'active'))
          or (record_type = 'receipt' and f.created_by = auth.uid()
            and exists (select 1 from receipts r where r.id = record_id and r.space_id = f.space_id
                        and r.created_by = auth.uid()))
        )
    )
  );

-- 4 ---------------------------------------------------------------------------------------------

-- One private bucket for every Space's files. Receipts, plans, photos, logos and tool results are
-- relationships in the database, not buckets. The limits here are the outer wall; each kind of
-- file has its own, lower limit (private.file_allowed).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hyphy-files', 'hyphy-files', false, 52428800, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip'
])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading bytes: the record must exist and be yours to open right now. An upload in progress (or
-- one that failed) is only its uploader's; Trash is its uploader's and file managers'. (Storage
-- also reads through this before it removes anything, so whoever may remove bytes may read them.)
create or replace function public.can_read_file_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.storage_bucket = 'hyphy-files' and f.storage_path = object_name
      and public.is_member(f.space_id)
      and (
        (f.status in ('pending', 'failed') and f.created_by = (select auth.uid()))
        or (f.status = 'ready' and f.deleted_at is null and public.can_see_file(f.id))
        or (f.status = 'ready' and f.deleted_at is not null and public.can_see_file(f.id)
            and (f.created_by = (select auth.uid()) or public.can(f.space_id, 'files.manage')))
      )
  )
$$;

-- Writing bytes: only into the exact path of a record you started, still waiting for its bytes,
-- in a Space where you may upload. (Storage checks this when it signs the upload; the signed
-- upload itself never overwrites — Hyphy grants no UPDATE, so no upsert and no move.)
create or replace function public.can_upload_file_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.storage_bucket = 'hyphy-files' and f.storage_path = object_name
      and f.status = 'pending' and f.created_by = (select auth.uid())
      and f.created_at > now() - interval '1 day'
      and public.is_member(f.space_id) and public.can(f.space_id, 'files.upload')
  )
$$;

-- Removing bytes: an upload of yours that didn't finish, or a file in Trash you may delete.
create or replace function public.can_remove_file_object(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.files f
    where f.storage_bucket = 'hyphy-files' and f.storage_path = object_name
      and public.is_member(f.space_id)
      and (
        (f.status in ('pending', 'failed') and f.created_by = (select auth.uid()))
        or (f.deleted_at is not null
            and (f.created_by = (select auth.uid()) or public.can(f.space_id, 'files.manage')))
      )
  )
$$;

create policy "Hyphy files: open what your file record lets you open" on storage.objects
  for select to authenticated
  using (bucket_id = 'hyphy-files' and public.can_read_file_object(name));
create policy "Hyphy files: upload into a file you just started" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'hyphy-files' and public.can_upload_file_object(name));
create policy "Hyphy files: remove what your file record lets you remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'hyphy-files' and public.can_remove_file_object(name));

-- 5 ---------------------------------------------------------------------------------------------

-- What a person may write about a file: it's made pending, with bytes Hyphy will receive, of a
-- kind Hyphy accepts; afterwards only its name, folder, expiry and Trash change — never its
-- Space, owner, bytes' location or what the bytes were.
create or replace function private.guard_file()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.seeding() then return new; end if;
  new.name := btrim(regexp_replace(new.name, '[[:cntrl:]]', '', 'g'));
  if tg_op = 'INSERT' then
    if new.storage_bucket is null or new.status <> 'pending' or new.deleted_at is not null then
      raise exception 'Files are added by uploading them.' using errcode = '42501';
    end if;
    if not private.file_allowed(new.mime_type, new.size) then
      raise exception 'Hyphy doesn’t accept that kind or size of file.';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.space_id <> old.space_id or new.created_by <> old.created_by
     or new.created_at <> old.created_at
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.original_name is distinct from old.original_name
     or new.mime_type is distinct from old.mime_type or new.size <> old.size
     or new.sha256 is distinct from old.sha256 or new.kind <> old.kind then
    raise exception 'A file keeps its Space, owner and bytes.' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    if old.status <> 'ready' then
      raise exception 'That upload didn’t finish, so there’s nothing to move.';
    end if;
    if new.deleted_at is not null then
      if exists (select 1 from public.receipts r where r.file_id = old.id) then
        raise exception 'This photo belongs to a receipt, so it stays with the receipt.';
      end if;
      if exists (select 1 from public.spaces s where s.logo_file_id = old.id) then
        raise exception 'This is the business logo. Change it in Settings.';
      end if;
      new.deleted_at := now();
      new.deleted_by := auth.uid();
    else
      new.deleted_by := null;
    end if;
  end if;
  return new;
end;
$$;
create trigger files_guarded before insert or update on public.files
  for each row execute function private.guard_file();

-- Name, folder, expiry and Trash are all a person changes. Status changes only in finish_upload.
revoke update on public.files from authenticated;
grant update (name, folder, expires_at, deleted_at) on public.files to authenticated;

-- Activity is written when a file is finished (not when its upload starts), moved to Trash,
-- brought back or renamed.
drop trigger files_logged on public.files;
drop function public.log_file();

create or replace function private.file_context(file uuid)
returns table (kind text, ref uuid) language sql stable security definer set search_path = '' as $$
  select a.record_type, a.record_id from public.file_attachments a
  where a.file_id = file and a.record_type in ('project', 'vehicle')
  order by a.record_type limit 1
$$;

create or replace function private.log_file_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  place record;
begin
  if public.seeding() or new.source = 'brand' then return new; end if;
  select * into place from private.file_context(new.id);
  if new.deleted_at is distinct from old.deleted_at then
    perform public.write_activity(new.space_id, coalesce(auth.uid(), new.created_by),
      case when new.deleted_at is null then 'restored' else 'deleted' end, 'file', new.id, new.name,
      place.kind, place.ref);
  elsif new.name <> old.name then
    perform public.write_activity(new.space_id, coalesce(auth.uid(), new.created_by), 'renamed',
      'file', new.id, new.name, place.kind, place.ref, 'was ' || old.name);
  end if;
  return new;
end;
$$;
create trigger files_changes_logged after update of name, deleted_at on public.files
  for each row execute function private.log_file_change();

-- Finishing an upload, as its uploader. For Storage, the bytes must be there at exactly the size
-- and type the record was made with; anything else fails the file (its bytes are then removed by
-- the app, as its uploader). Answers 'ready', 'missing' (nothing arrived yet — try again) or
-- 'mismatch' (failed). Calling it again on a finished file changes nothing.
create or replace function public.finish_upload(file uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  f public.files;
  meta jsonb;
  place record;
begin
  select * into f from public.files where id = file for update;
  if not found or f.created_by is distinct from auth.uid() or not public.is_member(f.space_id) then
    raise exception 'That upload isn’t yours to finish.' using errcode = '42501';
  end if;
  if f.status = 'ready' then return 'ready'; end if;
  if f.status = 'failed' then return 'mismatch'; end if;
  if f.storage_bucket = 'hyphy-files' then
    select o.metadata into meta from storage.objects o
    where o.bucket_id = 'hyphy-files' and o.name = f.storage_path;
    if not found then return 'missing'; end if;
    if (meta ->> 'size')::bigint is distinct from f.size
       or lower(split_part(meta ->> 'mimetype', ';', 1)) is distinct from f.mime_type then
      update public.files set status = 'failed' where id = f.id;
      return 'mismatch';
    end if;
  end if;
  update public.files set status = 'ready' where id = f.id;
  -- "Dana uploaded Oak Brook Plans.pdf · Oak Brook Remodel"; tools' results were generated.
  -- Receipt photos and logos are told by their receipt and their Space.
  if coalesce(f.source, '') not in ('receipts', 'brand') then
    select * into place from private.file_context(f.id);
    perform public.write_activity(f.space_id, f.created_by,
      case when f.source is null then 'uploaded' else 'generated' end, 'file', f.id, f.name,
      place.kind, place.ref);
  end if;
  return 'ready';
end;
$$;

-- 6 ---------------------------------------------------------------------------------------------

-- Deleting for good: from Trash (its uploader or a file manager), or an upload of yours that
-- never finished. Never while its bytes are still in Storage — the app removes them first, so a
-- record can't vanish and leave bytes nobody can find.
create policy "Delete files for good" on public.files
  for delete to authenticated using (
    (deleted_at is not null and (created_by = auth.uid() or can(space_id, 'files.manage')))
    or (status in ('pending', 'failed') and created_by = auth.uid())
  );

create or replace function private.guard_file_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.seeding() then return old; end if;
  if old.storage_bucket = 'hyphy-files' and exists (
    select 1 from storage.objects o where o.bucket_id = 'hyphy-files' and o.name = old.storage_path
  ) then
    raise exception 'Remove the file’s bytes before its record.' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger files_delete_guarded before delete on public.files
  for each row execute function private.guard_file_delete();

-- 7 ---------------------------------------------------------------------------------------------

-- A receipt's photo is a real, finished file of the submitter's own, in the receipt's Space, an
-- image or a PDF, on one receipt only. The attachment follows the receipt's photo, so the photo is
-- visible exactly when the receipt is (can_see_file).
create or replace function private.check_receipt_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.seeding() or new.file_id is null
     or (tg_op = 'UPDATE' and new.file_id is not distinct from old.file_id) then
    return new;
  end if;
  if not exists (
    select 1 from public.files f
    where f.id = new.file_id and f.space_id = new.space_id and f.created_by = new.created_by
      and f.status = 'ready' and f.deleted_at is null
      and (f.mime_type like 'image/%' or f.mime_type = 'application/pdf')
  ) then
    raise exception 'That receipt photo isn’t available. Add it again.';
  end if;
  if exists (select 1 from public.receipts r where r.file_id = new.file_id and r.id <> new.id) then
    raise exception 'That photo is already on another receipt.';
  end if;
  return new;
end;
$$;
create trigger receipts_photo_checked before insert or update of file_id on public.receipts
  for each row execute function private.check_receipt_photo();

create or replace function private.attach_receipt_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  photo text;
begin
  if public.seeding() then return new; end if;
  if tg_op = 'UPDATE' and old.file_id is not null and old.file_id is distinct from new.file_id then
    delete from public.file_attachments
     where file_id = old.file_id and record_type = 'receipt' and record_id = new.id;
  end if;
  if new.file_id is not null and (tg_op = 'INSERT' or new.file_id is distinct from old.file_id) then
    insert into public.file_attachments (file_id, record_type, record_id)
    values (new.file_id, 'receipt', new.id) on conflict do nothing;
    select f.name into photo from public.files f where f.id = new.file_id;
    -- "Mike attached Shell receipt.jpg · Shell receipt"
    perform public.write_activity(new.space_id, coalesce(auth.uid(), new.created_by), 'attached',
      'file', new.file_id, photo, 'receipt', new.id);
  end if;
  return new;
end;
$$;
create trigger receipts_photo_attached after insert or update of file_id on public.receipts
  for each row execute function private.attach_receipt_photo();

-- "A photo on every receipt" (receipts.requirePhoto), checked with the business's other rules
-- when something is sent. Mirrors submissionProblem in src/lib/platform/business-settings.ts.
create or replace function private.check_submission_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := to_jsonb(new);
  receipt boolean := tg_table_name = 'receipts';
  rules jsonb;
  space_row public.spaces;
  word text;
begin
  if public.seeding() then return new; end if;
  if not ((tg_op = 'INSERT' and (f ->> 'status') <> 'draft')
          or (tg_op = 'UPDATE' and (to_jsonb(old) ->> 'status') in ('draft', 'returned')
              and (f ->> 'status') in ('submitted', 'approved') and new.created_by = auth.uid())) then
    return new;
  end if;
  select * into space_row from public.spaces s where s.id = new.space_id;
  if space_row.kind <> 'business' then return new; end if;
  select ss.settings -> (case when receipt then 'receipts' else 'mileage' end) into rules
  from public.space_settings ss where ss.space_id = new.space_id;
  rules := coalesce(rules, '{}'::jsonb);
  word := lower(coalesce(space_row.labels -> 'projects' ->> 'singular',
                         case space_row.work_style when 'events' then 'event' else 'project' end));
  if (rules ->> 'requireProject')::boolean and 'projects' = any (space_row.modules)
     and new.project_id is null
     and exists (select 1 from public.projects p
                 where p.space_id = new.space_id and public.can_see_project(p.id)) then
    raise exception 'Choose the % this % is for.', word, case when receipt then 'receipt' else 'trip' end;
  end if;
  if receipt then
    if (rules ->> 'requireVehicle')::boolean and 'vehicles' = any (space_row.modules)
       and new.vehicle_id is null
       and exists (select 1 from public.vehicles v where v.space_id = new.space_id
                   and (v.assigned_to = new.created_by or public.can(new.space_id, 'vehicles.view_all'))) then
      raise exception 'Choose the vehicle this receipt is for.';
    end if;
    if (rules ->> 'allowPersonal')::boolean is false and (f ->> 'payment_method') ~* '^\s*personal\M' then
      raise exception 'This business doesn’t pay back personal expenses. Use a company card.';
    end if;
    if (rules ->> 'requirePhoto')::boolean and new.file_id is null then
      raise exception 'Add a photo of the receipt.';
    end if;
  else
    if (rules ->> 'requirePurpose')::boolean and btrim(coalesce(f ->> 'purpose', '')) = '' then
      raise exception 'Add what the trip was for.';
    end if;
    if (rules ->> 'allowPersonalVehicles')::boolean is false and 'vehicles' = any (space_row.modules)
       and new.vehicle_id is null then
      raise exception 'Trips here are logged in a company vehicle.';
    end if;
  end if;
  return new;
end;
$$;

-- The settings document may now say whether a photo is required.
create or replace function private.check_space_settings()
returns trigger language plpgsql set search_path = '' as $$
declare
  doc jsonb := new.settings;
  section text;
  item text;
  rule jsonb;
  over numeric;
begin
  if tg_op = 'UPDATE' and new.space_id <> old.space_id then
    raise exception 'A business keeps its own rules.' using errcode = '42501';
  end if;
  if (select s.kind from public.spaces s where s.id = new.space_id) is distinct from 'business' then
    raise exception 'Only businesses have these rules.';
  end if;
  if jsonb_typeof(doc) is distinct from 'object' then
    raise exception 'Unknown settings.';
  end if;
  for section in select jsonb_object_keys(doc) loop
    if section not in ('receipts', 'mileage', 'approvals')
       or jsonb_typeof(doc -> section) <> 'object' then
      raise exception 'Unknown settings.';
    end if;
    for item in select jsonb_object_keys(doc -> section) loop
      case section || '.' || item
        when 'receipts.requireProject', 'receipts.requireVehicle', 'receipts.allowPersonal',
             'receipts.requirePhoto',
             'mileage.requireProject', 'mileage.requirePurpose', 'mileage.allowPersonalVehicles' then
          if jsonb_typeof(doc -> section -> item) <> 'boolean' then
            raise exception 'Choose yes or no.';
          end if;
        when 'receipts.defaultCategory' then
          if jsonb_typeof(doc -> section -> item) <> 'string'
             or (doc -> section ->> item) not in ('fuel', 'materials', 'meals', 'supplies', 'equipment', 'other') then
            raise exception 'Choose one of the categories.';
          end if;
        when 'receipts.approval', 'mileage.approval' then
          rule := doc -> section -> item;
          if jsonb_typeof(rule) <> 'object'
             or exists (select 1 from jsonb_object_keys(rule) k where k not in ('mode', 'over')) then
            raise exception 'Choose when approval is needed.';
          end if;
          if rule ->> 'mode' in ('always', 'never') and not rule ? 'over' then
            null;
          elsif rule ->> 'mode' = 'over' and section = 'receipts' and jsonb_typeof(rule -> 'over') = 'number' then
            over := (rule ->> 'over')::numeric;
            if over <= 0 or over > 100000 then
              raise exception 'Choose an amount between $1 and $100,000.';
            end if;
          else
            raise exception 'Choose when approval is needed.';
          end if;
        when 'approvals.approvers' then
          if (doc -> section ->> item) is null or (doc -> section ->> item) not in ('managers', 'admins')
             or jsonb_typeof(doc -> section -> item) <> 'string' then
            raise exception 'Choose who approves.';
          end if;
        else
          raise exception 'Unknown settings.';
      end case;
    end loop;
  end loop;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- 8 ---------------------------------------------------------------------------------------------

-- The business's logo: owners and admins, a finished image of their own upload in this Space,
-- small. The previous logo goes to Trash with it (the app then deletes it for good). Null
-- removes the logo; the mark goes back to initials.
create or replace function public.set_space_logo(space uuid, file uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  previous uuid;
begin
  if not exists (select 1 from public.spaces s where s.id = space and s.kind = 'business')
     or not public.can(space, 'space.manage') then
    raise exception 'Only owners and admins change the logo.' using errcode = '42501';
  end if;
  if file is not null and not exists (
    select 1 from public.files f
    where f.id = file and f.space_id = space and f.created_by = auth.uid()
      and f.status = 'ready' and f.deleted_at is null and f.source = 'brand'
      and f.mime_type in ('image/png', 'image/jpeg', 'image/webp') and f.size <= 2097152
  ) then
    raise exception 'That image can’t be the logo. Use a PNG, JPG or WebP under 2 MB.';
  end if;
  select s.logo_file_id into previous from public.spaces s where s.id = space for update;
  update public.spaces set logo_file_id = file where id = space;
  if previous is not null and previous is distinct from file then
    update public.files set deleted_at = now() where id = previous;
  end if;
  perform public.write_activity(space, auth.uid(),
    case when file is null then 'removed' else 'updated' end, 'space', space, 'the business logo');
  return case when previous is distinct from file then previous end;
end;
$$;

-- 9 ---------------------------------------------------------------------------------------------

-- Bytes a Space keeps in Storage (Trash included — it's still stored), for the people who run it.
-- Nothing is limited by it yet; plans may later.
create or replace function public.space_storage_bytes(space uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select case when public.can(space, 'space.manage') then coalesce((
    select sum(f.size) from public.files f
    where f.space_id = space and f.storage_bucket = 'hyphy-files' and f.status <> 'failed'
  ), 0)::bigint end
$$;

-- For operators, in the SQL editor: what doesn't line up between records and bytes. Not exposed
-- to anyone (the `private` schema isn't published, and nobody is granted it). docs/FILES.md.
create or replace view private.file_storage_reconciliation as
  select 'bytes without a record' as problem, o.name as storage_path, null::uuid as file_id,
         o.created_at as since
  from storage.objects o
  where o.bucket_id = 'hyphy-files' and not exists (
    select 1 from public.files f where f.storage_bucket = 'hyphy-files' and f.storage_path = o.name)
  union all
  select 'record without its bytes', f.storage_path, f.id, f.created_at
  from public.files f
  where f.storage_bucket = 'hyphy-files' and f.status = 'ready' and not exists (
    select 1 from storage.objects o where o.bucket_id = 'hyphy-files' and o.name = f.storage_path)
  union all
  select case f.status when 'pending' then 'upload never finished' else 'failed upload' end,
         f.storage_path, f.id, f.created_at
  from public.files f
  where f.status = 'failed' or (f.status = 'pending' and f.created_at < now() - interval '1 day');
revoke all on private.file_storage_reconciliation from public, anon, authenticated;

-- Grants ----------------------------------------------------------------------------------------

revoke execute on function
  private.file_allowed(text, bigint), private.guard_file(), private.file_context(uuid),
  private.log_file_change(), private.guard_file_delete(), private.check_receipt_photo(),
  private.attach_receipt_photo()
  from public, anon, authenticated;
revoke execute on function
  public.can_read_file_object(text), public.can_upload_file_object(text),
  public.can_remove_file_object(text), public.finish_upload(uuid),
  public.set_space_logo(uuid, uuid), public.space_storage_bytes(uuid)
  from public, anon;
-- The three object checks run inside Storage's policies as the signed-in person; each only
-- answers about that person's own access.
grant execute on function
  public.can_read_file_object(text), public.can_upload_file_object(text),
  public.can_remove_file_object(text), public.finish_upload(uuid),
  public.set_space_logo(uuid, uuid), public.space_storage_bytes(uuid)
  to authenticated;
