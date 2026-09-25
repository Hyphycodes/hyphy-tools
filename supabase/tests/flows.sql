-- Hyphy Tools — the product's write paths, run as the real seeded people, against the database.
--
-- The same writes the repository makes (src/lib/data/core.ts over supabase/source.ts), as
-- `authenticated` with each person's claims: a trip and a receipt through submit → return with a
-- reason → fix → approve, batch approval, pins, a file attached to a project, an invitation. It
-- checks what the triggers wrote (approval history, activity) and who they say did it.
--
-- Everything happens in one transaction that is always rolled back — the report arrives as the
-- final error message ("FLOWS PASSED" or "FLOWS FAILED"), so the seeded world is left untouched.

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

do $flows$
declare
  results text[] := '{}';
  failures text[] := '{}';
  mike uuid := pg_temp.did('mike');
  dana uuid := pg_temp.did('dana');
  ray uuid := pg_temp.did('ray');
  abc uuid := pg_temp.did('sp_abc');
  oakbrook uuid := pg_temp.did('prj_oakbrook');
  truck uuid := pg_temp.did('veh_t24');
  trip uuid := gen_random_uuid();
  receipt uuid := gen_random_uuid();
  file uuid := gen_random_uuid();
  history text;
  lines bigint;
  n bigint;
  waiting uuid[];
  invited uuid;
begin
  -- Mike logs a trip on Oak Brook Remodel and submits it.
  perform pg_temp.as_person(mike);
  insert into mileage_entries (id, space_id, created_by, date, "from", "to", miles, round_trip,
                               purpose, project_id, status)
  values (trip, abc, mike, now(), 'Shop, Oak Brook', 'Oak Brook Remodel', 18.4, true,
          'Tile pickup', oakbrook, 'submitted');

  -- Dana returns it with a reason.
  perform pg_temp.as_person(dana);
  update mileage_entries set status = 'returned', reviewed_by = dana, reviewed_at = now(),
         return_reason = 'Add the truck you drove.'
   where id = trip and space_id = abc;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'Dana could not return the trip'::text; end if;

  -- Mike sees the reason, fixes the trip and sends it again.
  perform pg_temp.as_person(mike);
  select count(*) into n from mileage_entries
   where id = trip and status = 'returned' and return_reason = 'Add the truck you drove.';
  if n <> 1 then failures := failures || 'Mike does not see the returned trip and its reason'::text; end if;
  update mileage_entries set vehicle_id = truck, status = 'submitted', resubmitted_at = now()
   where id = trip and space_id = abc;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'Mike could not resubmit'::text; end if;

  -- Dana approves.
  perform pg_temp.as_person(dana);
  update mileage_entries set status = 'approved', reviewed_by = dana, reviewed_at = now()
   where id = trip and space_id = abc;

  -- History and activity, as Mike reads them.
  perform pg_temp.as_person(mike);
  select string_agg(action || ':' || (case actor_id when mike then 'mike' when dana then 'dana' else '?' end)
                    || coalesce(':' || reason, ''), ' ' order by at, action)
    into history from approval_events where submission_id = trip;
  -- Within one transaction now() is constant, so order the expected story by action too.
  if history is distinct from
     'approved:dana resubmitted:mike returned:dana:Add the truck you drove. submitted:mike' then
    failures := failures || ('Trip history is wrong: ' || coalesce(history, 'none'));
  end if;
  -- Mike's own lines are his; the reviewer's lines on money are for people who review (Dana).
  select count(*) into n from activity where object_id = trip;
  if n <> 2 then failures := failures || format('Mike sees %s lines on his trip, not his own 2', n); end if;
  perform pg_temp.as_person(dana);
  select count(*) into lines from activity where object_id = trip;
  if lines < 4 then failures := failures || format('Trip wrote %s activity lines, not 4', lines); end if;
  select count(*) into n from activity where object_id = trip and verb = 'returned'
     and actor_id = dana and detail like '%Add the truck you drove.%';
  if n <> 1 then failures := failures || 'The return line does not carry Dana and the reason'::text; end if;
  results := results || 'ok: trip submitted → returned with reason → fixed → approved; history and activity by the right people'::text;

  -- The same for a receipt, filed against Oak Brook with Truck 24.
  perform pg_temp.as_person(mike);
  insert into receipts (id, space_id, created_by, vendor, category, total, date, vehicle_id,
                        project_id, status)
  values (receipt, abc, mike, 'Shell', 'fuel', 64.10, now(), truck, oakbrook, 'submitted');
  perform pg_temp.as_person(dana);
  update receipts set status = 'returned', reviewed_by = dana, reviewed_at = now(),
         return_reason = 'Photo is cut off.' where id = receipt;
  perform pg_temp.as_person(mike);
  update receipts set status = 'submitted', resubmitted_at = now(), notes = 'Retook the photo.'
   where id = receipt;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'Mike could not resubmit the receipt'::text; end if;
  select count(*) into n from approval_events where submission_id = receipt;
  if n <> 3 then failures := failures || format('Receipt history has %s events before approval, not 3', n); end if;
  select count(*) into n from activity where object_id = receipt and context_id = oakbrook;
  if n < 1 then failures := failures || 'Receipt activity is not on Oak Brook Remodel'::text; end if;
  results := results || 'ok: receipt returned with a reason and resubmitted, connected to its project and truck'::text;

  -- Batch approval: Ray approves everything waiting in ABC that isn't his own.
  perform pg_temp.as_person(ray);
  select array_agg(id) into waiting from approval_queue
   where space_id = abc and status = 'submitted' and created_by <> ray;
  if coalesce(array_length(waiting, 1), 0) < 5 then
    failures := failures || format('Ray sees %s waiting, expected at least 5', coalesce(array_length(waiting, 1), 0));
  end if;
  update receipts set status = 'approved', reviewed_by = ray, reviewed_at = now()
   where id = any (waiting) and status = 'submitted';
  update mileage_entries set status = 'approved', reviewed_by = ray, reviewed_at = now()
   where id = any (waiting) and status = 'submitted';
  select count(*) into n from approval_queue where space_id = abc and status = 'submitted' and created_by <> ray;
  if n <> 0 then failures := failures || format('%s still waiting after batch approval', n); end if;
  select count(*) into n from approval_events where submission_id = any (waiting) and action = 'approved' and actor_id = ray;
  if n <> array_length(waiting, 1) then
    failures := failures || format('Batch wrote %s approvals for %s items', n, array_length(waiting, 1));
  end if;
  results := results || format('ok: batch approval of %s items, one approval event each, by Ray', array_length(waiting, 1));

  -- Pins are a person's own.
  perform pg_temp.as_person(mike);
  insert into pins (space_id, person_id, target_type, target_id) values (abc, mike, 'project', oakbrook::text);
  begin
    insert into pins (space_id, person_id, target_type, target_id) values (abc, dana, 'tool', 'pdf');
    failures := failures || 'Mike pinned something for Dana'::text;
  exception when others then null;
  end;
  perform pg_temp.as_person(dana);
  select count(*) into n from pins where person_id = mike;
  if n <> 0 then failures := failures || 'Dana sees Mike''s pins'::text; end if;
  results := results || 'ok: pins persist per person and stay private'::text;

  -- A file attached to Oak Brook; its activity line is written at commit with the project.
  perform pg_temp.as_person(mike);
  insert into files (id, space_id, created_by, name, kind, size, folder, access)
  values (file, abc, mike, 'Tile spec.pdf', 'pdf', 220000, 'Projects', 'team');
  insert into file_attachments (file_id, record_type, record_id) values (file, 'project', oakbrook);
  set constraints all immediate;
  perform pg_temp.as_person(ray);
  select count(*) into n from files f join file_attachments a on a.file_id = f.id
   where f.id = file and a.record_id = oakbrook;
  if n <> 1 then failures := failures || 'Ray does not see the file on Oak Brook'::text; end if;
  select count(*) into n from activity where object_id = file and context_id = oakbrook and actor_id = mike;
  if n <> 1 then failures := failures || 'The file''s activity line is missing its project'::text; end if;
  results := results || 'ok: file metadata and its project attachment persist; activity says where it went'::text;

  -- An invitation creates the identity (auth.users) and an invited membership.
  perform pg_temp.as_person(dana);
  invited := invite_member(abc, 'Sam Torres', 'sam.torres@abcconstruction.example', 'member', 'Carpenter', '{}');
  select count(*) into n from space_members where person_id = invited and status = 'invited';
  if n <> 1 then failures := failures || 'The invitation did not create an invited membership'::text; end if;
  perform set_config('role', 'none', true);
  select count(*) into n from auth.users where id = invited;
  if n <> 1 then failures := failures || 'The invitation did not create an identity'::text; end if;
  results := results || 'ok: invitation creates an identity and an invited membership'::text;

  perform set_config('role', 'none', true);
  if array_length(failures, 1) > 0 then
    raise exception 'FLOWS FAILED (rolled back): %', array_to_string(failures, '; ');
  end if;
  raise exception E'FLOWS PASSED (rolled back)\n%', array_to_string(results, E'\n');
end;
$flows$;
