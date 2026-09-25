-- Hyphy Tools — real files (Phase 2D), attacked from every side, as the seeded people.
--
-- The file record and its bytes' access, together: what may be started, finished, seen, opened,
-- renamed, moved to Trash and deleted; the Storage policies on `storage.objects` as each person
-- (select, insert, and whether they may remove); receipt photos, the business logo and the
-- "photo required" rule. Runs on plain Postgres (tests/prelude.sql stands in for Storage's schema)
-- and on a Supabase project, where it meets the real one.
--
-- Always rolled back: the report is the final error ("FILES PASSED" or "FILES FAILED").

create or replace function pg_temp.did(key text) returns uuid language sql immutable as $$
  select (substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-8'
          || substr(h, 18, 3) || '-' || substr(h, 21, 12))::uuid
  from (select encode(sha256(convert_to('hyphy-demo:' || key, 'UTF8')), 'hex') as h) x
$$;

create or replace function pg_temp.as_person(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', person, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', person::text, true);
$$;

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('role', 'none', true), set_config('request.jwt.claims', '', true),
         set_config('request.jwt.claim.sub', '', true);
$$;

do $files$
declare
  results text[] := '{}';
  failures text[] := '{}';
  dana uuid := pg_temp.did('dana');
  luis uuid := pg_temp.did('luis');
  ray uuid := pg_temp.did('ray');
  mike uuid := pg_temp.did('mike');
  tasha uuid := pg_temp.did('tasha');
  chris uuid := pg_temp.did('chris');
  rosa uuid := pg_temp.did('rosa');
  jerry uuid := pg_temp.did('jerry');
  abc uuid := pg_temp.did('sp_abc');
  salt uuid := pg_temp.did('sp_salt');
  oakbrook uuid := pg_temp.did('prj_oakbrook');
  plans uuid := gen_random_uuid();
  shared uuid := gen_random_uuid();
  photo uuid := gen_random_uuid();
  logo uuid := gen_random_uuid();
  bad uuid := gen_random_uuid();
  tashas uuid := gen_random_uuid();
  receipt uuid := gen_random_uuid();
  path text;
  n bigint;
  outcome text;
  refused boolean;
begin
  -- 1. Starting a file: pending, bytes described, accepted kind and size, its own path. ----------
  perform pg_temp.as_person(dana);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, storage_bucket, storage_path, status)
  values (plans, abc, dana, 'Oak Brook Plans.pdf', 'plans.pdf', 'pdf', 1000, 'application/pdf',
          'Plans', 'team', 'hyphy-files', format('spaces/%s/files/%s/plans.pdf', abc, plans), 'pending');

  refused := false;
  begin
    insert into files (space_id, created_by, name, kind, size, folder, access)
    values (abc, dana, 'No bytes.pdf', 'pdf', 10, 'Uploads', 'team');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A file with no bytes was made by a person'::text; end if;

  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, abc, dana, 'page.html', 'page.html', 'doc', 10, 'text/html', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/page.html', abc, bad), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'An HTML file was accepted'::text; end if;

  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, abc, dana, 'huge.jpg', 'huge.jpg', 'image', 30000000, 'image/jpeg', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/huge.jpg', abc, bad), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A 30 MB photo was accepted'::text; end if;

  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, abc, dana, 'ok.pdf', 'ok.pdf', 'pdf', 10, 'application/pdf', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/../../escape.pdf', abc, bad), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A path climbing out of its folder was accepted'::text; end if;

  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, abc, dana, 'ok.pdf', 'ok.pdf', 'pdf', 10, 'application/pdf', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/plans.pdf', abc, plans), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A record pointed at another file''s bytes'::text; end if;

  -- Another business can't start a file here, nor point its own record at this one's bytes.
  perform pg_temp.as_person(rosa);
  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, abc, rosa, 'x.pdf', 'x.pdf', 'pdf', 10, 'application/pdf', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/x.pdf', abc, bad), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'Rosa started a file in ABC'::text; end if;
  refused := false;
  begin
    insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                       access, storage_bucket, storage_path, status)
    values (bad, salt, rosa, 'x.pdf', 'x.pdf', 'pdf', 10, 'application/pdf', 'Uploads', 'team',
            'hyphy-files', format('spaces/%s/files/%s/plans.pdf', abc, plans), 'pending');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'Rosa''s record pointed at ABC''s bytes'::text; end if;
  results := results || 'ok: files start pending, of accepted kinds and sizes, at their own path only'::text;

  -- 2. Storage's policies while it uploads. ----------------------------------------------------
  path := format('spaces/%s/files/%s/plans.pdf', abc, plans);
  perform pg_temp.as_person(ray);
  if public.can_upload_file_object(path) then
    failures := failures || 'Ray may upload into Dana''s file'::text;
  end if;
  perform pg_temp.as_person(rosa);
  if public.can_upload_file_object(path)
     or public.can_upload_file_object(format('spaces/%s/files/%s/new.pdf', abc, gen_random_uuid())) then
    failures := failures || 'Rosa may upload into ABC'::text;
  end if;
  perform pg_temp.as_person(dana);
  if not public.can_upload_file_object(path) then
    failures := failures || 'Dana may not upload her own file''s bytes'::text;
  end if;
  -- What Storage writes as she uploads, under her policies.
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', path, dana::text, '{"size": 1000, "mimetype": "application/pdf"}');
  perform pg_temp.as_person(ray);
  select count(*) into n from storage.objects where name = path;
  if n <> 0 then failures := failures || 'Ray reads bytes still uploading'::text; end if;
  select count(*) into n from files where id = plans;
  if n <> 0 then failures := failures || 'Ray sees a file still uploading'::text; end if;
  refused := false;
  begin
    perform public.finish_upload(plans);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'Ray finished Dana''s upload'::text; end if;
  perform pg_temp.as_person(dana);
  outcome := public.finish_upload(plans);
  if outcome <> 'ready' then failures := failures || format('Finishing said %s', outcome); end if;
  if public.finish_upload(plans) <> 'ready' then
    failures := failures || 'Finishing twice changed something'::text;
  end if;
  select count(*) into n from activity where object_id = plans and verb = 'uploaded';
  if n <> 1 then failures := failures || format('%s upload lines, expected 1', n); end if;
  -- Once ready, no one writes its bytes again (no insert, and Hyphy grants no update at all).
  if public.can_upload_file_object(path) then
    failures := failures || 'A finished file''s bytes can be written again'::text;
  end if;
  results := results || 'ok: bytes go only into a file its uploader started; nobody sees it until it''s finished'::text;

  -- What arrived isn't what was promised: the file fails, and only its uploader may clear it.
  perform pg_temp.as_person(mike);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, storage_bucket, storage_path, status)
  values (bad, abc, mike, 'short.pdf', 'short.pdf', 'pdf', 5000, 'application/pdf', 'Uploads', 'team',
          'hyphy-files', format('spaces/%s/files/%s/short.pdf', abc, bad), 'pending');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', format('spaces/%s/files/%s/short.pdf', abc, bad), mike::text,
          '{"size": 12, "mimetype": "application/pdf"}');
  if public.finish_upload(bad) <> 'mismatch' then
    failures := failures || 'A short upload was finished'::text;
  end if;
  select count(*) into n from files where id = bad and status = 'failed';
  if n <> 1 then failures := failures || 'The short upload isn''t marked failed'::text; end if;
  if not public.can_remove_file_object(format('spaces/%s/files/%s/short.pdf', abc, bad)) then
    failures := failures || 'Mike can''t clear his failed upload'::text;
  end if;
  perform pg_temp.as_person(dana);
  if public.can_remove_file_object(format('spaces/%s/files/%s/short.pdf', abc, bad)) then
    failures := failures || 'Dana may remove Mike''s failed upload'::text;
  end if;
  results := results || 'ok: bytes that aren''t what was promised fail the file'::text;

  -- 3. Who sees and opens a finished file. ----------------------------------------------------
  perform pg_temp.as_person(dana);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, storage_bucket, storage_path, status)
  values (shared, abc, dana, 'Panel schedule.pdf', 'panel.pdf', 'pdf', 400, 'application/pdf',
          'Plans', 'shared', 'hyphy-files', format('spaces/%s/files/%s/panel.pdf', abc, shared), 'pending');
  insert into file_attachments (file_id, record_type, record_id) values (shared, 'project', oakbrook);
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', format('spaces/%s/files/%s/panel.pdf', abc, shared), dana::text,
          '{"size": 400, "mimetype": "application/pdf"}');
  perform public.finish_upload(shared);

  perform pg_temp.as_person(mike);
  if not public.can_read_file_object(path) then failures := failures || 'Mike can''t open a team file'::text; end if;
  perform pg_temp.as_person(chris);
  if public.can_read_file_object(path) then failures := failures || 'Chris (guest) opens an unshared team file'::text; end if;
  if not public.can_read_file_object(format('spaces/%s/files/%s/panel.pdf', abc, shared)) then
    failures := failures || 'Chris can''t open the file on his shared project'::text;
  end if;
  select count(*) into n from storage.objects where bucket_id = 'hyphy-files' and name like format('spaces/%s/%%', abc);
  if n <> 1 then failures := failures || format('Chris lists %s of ABC''s stored files, expected 1', n); end if;
  perform pg_temp.as_person(rosa);
  select count(*) into n from storage.objects where bucket_id = 'hyphy-files' and name like format('spaces/%s/%%', abc);
  if n <> 0 then failures := failures || 'Rosa lists ABC''s stored files'::text; end if;
  if public.can_read_file_object(path) then failures := failures || 'Rosa opens ABC''s file by its path'::text; end if;
  perform pg_temp.as_person(jerry);
  if public.can_read_file_object(path) then failures := failures || 'Jerry (guest elsewhere) opens ABC''s team file'::text; end if;
  results := results || 'ok: team files for members, guests only their shared projects'' files, other businesses nothing'::text;

  -- A removed member keeps nothing — not even what they uploaded; the business keeps it.
  perform pg_temp.as_person(tasha);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, storage_bucket, storage_path, status)
  values (tashas, abc, tasha, 'Cut list.pdf', 'cut.pdf', 'pdf', 300, 'application/pdf', 'Uploads',
          'team', 'hyphy-files', format('spaces/%s/files/%s/cut.pdf', abc, tashas), 'pending');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', format('spaces/%s/files/%s/cut.pdf', abc, tashas), tasha::text,
          '{"size": 300, "mimetype": "application/pdf"}');
  perform public.finish_upload(tashas);
  perform pg_temp.as_person(dana);
  perform public.remove_member(abc, tasha);
  perform pg_temp.as_person(tasha);
  select count(*) into n from files where id in (tashas, plans);
  if n <> 0 then failures := failures || 'A removed member still sees files'::text; end if;
  if public.can_read_file_object(format('spaces/%s/files/%s/cut.pdf', abc, tashas)) then
    failures := failures || 'A removed member opens what she uploaded'::text;
  end if;
  select count(*) into n from storage.objects where name like format('spaces/%s/%%', abc);
  if n <> 0 then failures := failures || 'A removed member lists stored files'::text; end if;
  perform pg_temp.as_person(dana);
  if not public.can_read_file_object(format('spaces/%s/files/%s/cut.pdf', abc, tashas)) then
    failures := failures || 'The business lost the removed member''s file'::text;
  end if;
  results := results || 'ok: a removed member loses every file, their own included; the business keeps them'::text;

  -- 4. A file keeps its Space, owner and bytes; only its name, folder, expiry and Trash change. --
  perform pg_temp.as_person(dana);
  refused := false;
  begin
    update files set storage_path = format('spaces/%s/files/%s/other.pdf', abc, plans) where id = plans;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A storage path was changed'::text; end if;
  refused := false;
  begin
    update files set space_id = salt where id = plans;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A file moved Spaces'::text; end if;
  refused := false;
  begin
    update files set status = 'pending' where id = plans;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A person changed a file''s status'::text; end if;
  update files set name = 'Oak Brook Plans v2.pdf' where id = plans;
  select count(*) into n from activity where object_id = plans and verb = 'renamed';
  if n <> 1 then failures := failures || 'Renaming wrote no activity'::text; end if;
  perform pg_temp.as_person(mike);
  update files set name = 'Mine now.pdf' where id = plans;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'Mike renamed Dana''s file'::text; end if;
  update files set deleted_at = now() where id = plans;
  get diagnostics n = row_count;
  if n <> 0 then failures := failures || 'Mike moved Dana''s file to Trash'::text; end if;
  results := results || 'ok: nobody moves a file''s bytes or Space; only its owner or a file manager renames it'::text;

  -- 5. Trash, then delete for good — never while bytes are stored, never by a member. --------
  perform pg_temp.as_person(ray);
  update files set deleted_at = now() where id = plans;
  select deleted_by::text into path from files where id = plans;
  if path is distinct from ray::text then failures := failures || 'Trash didn''t record who'::text; end if;
  perform pg_temp.as_person(mike);
  if public.can_read_file_object(format('spaces/%s/files/%s/plans.pdf', abc, plans))
     or public.can_remove_file_object(format('spaces/%s/files/%s/plans.pdf', abc, plans)) then
    failures := failures || 'Mike opens or removes a file in Trash'::text;
  end if;
  perform pg_temp.as_person(ray);
  if not public.can_remove_file_object(format('spaces/%s/files/%s/plans.pdf', abc, plans)) then
    failures := failures || 'A file manager can''t remove a file in Trash'::text;
  end if;
  refused := false;
  begin
    delete from files where id = plans;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A record was deleted while its bytes are stored'::text; end if;
  perform pg_temp.as_person(dana);
  update files set deleted_at = null where id = plans;
  select count(*) into n from activity where object_id = plans and verb in ('deleted', 'restored');
  if n <> 2 then failures := failures || format('%s Trash lines, expected 2', n); end if;
  -- Not in Trash: nobody may remove its bytes.
  if public.can_remove_file_object(format('spaces/%s/files/%s/plans.pdf', abc, plans)) then
    failures := failures || 'Bytes of a file not in Trash can be removed'::text;
  end if;
  results := results || 'ok: Trash and back by the right people; records never go before their bytes'::text;

  -- 6. Attachments stay inside the file's Space and what the person can see. ------------------
  perform pg_temp.as_person(dana);
  refused := false;
  begin
    insert into file_attachments (file_id, record_type, record_id)
    values (plans, 'project', (select id from projects where space_id = salt limit 1));
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A file was attached to another business''s project'::text; end if;
  perform pg_temp.as_person(mike);
  refused := false;
  begin
    insert into file_attachments (file_id, record_type, record_id) values (plans, 'project', oakbrook);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'Mike attached Dana''s file'::text; end if;
  results := results || 'ok: attachments stay in the Space, by the file''s owner or a file manager'::text;

  -- 7. Receipt photos follow their receipt; a business can require one. ------------------------
  perform pg_temp.as_person(mike);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, source, storage_bucket, storage_path, status)
  values (photo, abc, mike, 'Shell.jpg', 'IMG_2201.jpg', 'image', 800, 'image/jpeg', 'Receipts',
          'private', 'receipts', 'hyphy-files', format('spaces/%s/files/%s/shell.jpg', abc, photo), 'pending');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', format('spaces/%s/files/%s/shell.jpg', abc, photo), mike::text,
          '{"size": 800, "mimetype": "image/jpeg"}');
  perform public.finish_upload(photo);
  perform pg_temp.as_person(ray);
  if public.can_read_file_object(format('spaces/%s/files/%s/shell.jpg', abc, photo)) then
    failures := failures || 'Ray sees a receipt photo before it''s on a receipt'::text;
  end if;
  perform pg_temp.as_person(dana);
  refused := false;
  begin
    insert into receipts (id, space_id, created_by, vendor, category, total, date, status, file_id)
    values (gen_random_uuid(), abc, dana, 'Shell', 'fuel', 5, now(), 'approved', photo);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'Dana used Mike''s photo on her receipt'::text; end if;
  perform pg_temp.as_person(mike);
  insert into receipts (id, space_id, created_by, vendor, category, total, date, status, file_id)
  values (receipt, abc, mike, 'Shell', 'fuel', 64.18, now(), 'submitted', photo);
  select count(*) into n from file_attachments where file_id = photo and record_type = 'receipt' and record_id = receipt;
  if n <> 1 then failures := failures || 'The photo isn''t attached to its receipt'::text; end if;
  select count(*) into n from activity where object_id = photo and verb = 'attached';
  if n <> 1 then failures := failures || 'Attaching the photo wrote no activity'::text; end if;
  perform pg_temp.as_person(ray);
  if not public.can_read_file_object(format('spaces/%s/files/%s/shell.jpg', abc, photo)) then
    failures := failures || 'The approver can''t see the receipt''s photo'::text;
  end if;
  perform pg_temp.as_person(chris);
  if public.can_read_file_object(format('spaces/%s/files/%s/shell.jpg', abc, photo)) then
    failures := failures || 'A guest sees a receipt photo'::text;
  end if;
  perform pg_temp.as_person(mike);
  refused := false;
  begin
    update files set deleted_at = now() where id = photo;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A receipt''s photo went to Trash'::text; end if;
  refused := false;
  begin
    insert into receipts (space_id, created_by, vendor, category, total, date, status, file_id)
    values (abc, mike, 'Shell', 'fuel', 10, now(), 'submitted', photo);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'One photo went on two receipts'::text; end if;
  perform pg_temp.as_admin();
  insert into space_settings (space_id, settings) values (abc, '{"receipts":{"requirePhoto":true}}')
  on conflict (space_id) do update set settings = jsonb_set(space_settings.settings, '{receipts}',
    coalesce(space_settings.settings -> 'receipts', '{}'::jsonb) || '{"requirePhoto":true}');
  perform pg_temp.as_person(mike);
  refused := false;
  begin
    insert into receipts (space_id, created_by, vendor, category, total, date, status)
    values (abc, mike, 'Menards', 'materials', 12, now(), 'submitted');
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A receipt without a photo was sent when one is required'::text; end if;
  -- A draft may wait for its photo.
  insert into receipts (space_id, created_by, vendor, category, total, date, status)
  values (abc, mike, 'Menards', 'materials', 12, now(), 'draft');
  results := results || 'ok: receipt photos are the submitter''s own, one receipt each, seen with the receipt; they can be required'::text;

  -- 8. The logo: owners and admins, every member sees it. -------------------------------------
  perform pg_temp.as_person(luis);
  insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type, folder,
                     access, source, storage_bucket, storage_path, status)
  values (logo, abc, luis, 'ABC logo.png', 'logo.png', 'image', 900, 'image/png', 'Company', 'team',
          'brand', 'hyphy-files', format('spaces/%s/files/%s/logo.png', abc, logo), 'pending');
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('hyphy-files', format('spaces/%s/files/%s/logo.png', abc, logo), luis::text,
          '{"size": 900, "mimetype": "image/png"}');
  perform public.finish_upload(logo);
  perform pg_temp.as_person(ray);
  refused := false;
  begin
    perform public.set_space_logo(abc, logo);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A manager changed the logo'::text; end if;
  perform pg_temp.as_person(luis);
  perform public.set_space_logo(abc, logo);
  perform pg_temp.as_person(chris);
  if not public.can_read_file_object(format('spaces/%s/files/%s/logo.png', abc, logo)) then
    failures := failures || 'A guest can''t see the business logo'::text;
  end if;
  perform pg_temp.as_person(rosa);
  if public.can_read_file_object(format('spaces/%s/files/%s/logo.png', abc, logo)) then
    failures := failures || 'Another business sees the logo'::text;
  end if;
  perform pg_temp.as_person(dana);
  refused := false;
  begin
    perform public.set_space_logo(abc, plans);
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'A PDF became the logo'::text; end if;
  refused := false;
  begin
    update spaces set logo_file_id = null where id = abc;
  exception when others then refused := true;
  end;
  if not refused then failures := failures || 'The logo column was written directly'::text; end if;
  results := results || 'ok: owners and admins set the logo; every member, guests too, sees it'::text;

  -- 9. Storage used: for the people who run a Space only. -------------------------------------
  perform pg_temp.as_person(dana);
  if coalesce(public.space_storage_bytes(abc), 0) < 1000 then
    failures := failures || 'The owner doesn''t see what ABC stores'::text;
  end if;
  perform pg_temp.as_person(mike);
  if public.space_storage_bytes(abc) is not null then
    failures := failures || 'A member sees what the business stores'::text;
  end if;
  results := results || 'ok: storage used is told to owners and admins only'::text;

  perform pg_temp.as_admin();
  if array_length(failures, 1) > 0 then
    raise exception 'FILES FAILED (rolled back): %', array_to_string(failures, '; ');
  end if;
  raise exception E'FILES PASSED (rolled back)\n%', array_to_string(results, E'\n');
end;
$files$;
