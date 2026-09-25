-- Phase 2D follow-up, from the hosted advisors after the file storage migration.
--
-- 1. Two file policies asked auth.uid() once per row; `(select auth.uid())` asks once per query.
--    Same rules, word for word otherwise.
-- 2. receipts.file_id is now read whenever a file is deleted for good (the foreign key sets the
--    receipt's photo to null) and when a receipt's photo is checked, so it gets an index.

drop policy "Attach files to records you can see" on public.file_attachments;
create policy "Attach files to records you can see" on public.file_attachments
  for insert to authenticated with check (
    exists (
      select 1 from files f
      where f.id = file_id and f.deleted_at is null and is_member(f.space_id)
        -- A new upload is attached as it starts (by its uploader); others only once it's ready.
        and (f.status = 'ready' or (f.status = 'pending' and f.created_by = (select auth.uid())))
        and (f.created_by = (select auth.uid()) or (can(f.space_id, 'files.manage') and can_see_file(f.id)))
        and (
          (record_type = 'project' and can_see_project(record_id)
            and exists (select 1 from projects p where p.id = record_id and p.space_id = f.space_id))
          or (record_type = 'vehicle'
            and exists (select 1 from vehicles v where v.id = record_id and v.space_id = f.space_id))
          or (record_type = 'person' and (record_id = (select auth.uid()) or can(f.space_id, 'people.manage'))
            and exists (select 1 from space_members m where m.space_id = f.space_id
                        and m.person_id = record_id and m.status = 'active'))
          or (record_type = 'receipt' and f.created_by = (select auth.uid())
            and exists (select 1 from receipts r where r.id = record_id and r.space_id = f.space_id
                        and r.created_by = (select auth.uid())))
        )
    )
  );

drop policy "Delete files for good" on public.files;
create policy "Delete files for good" on public.files
  for delete to authenticated using (
    (deleted_at is not null and (created_by = (select auth.uid()) or can(space_id, 'files.manage')))
    or (status in ('pending', 'failed') and created_by = (select auth.uid()))
  );

create index if not exists receipts_file on public.receipts (file_id) where file_id is not null;
