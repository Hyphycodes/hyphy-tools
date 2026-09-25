-- Hyphy Tools — connected product systems (proposed, not applied).
--
-- Follows 20260925000000_platform_foundation.sql. It mirrors the Phase 1.75 model in
-- src/lib/platform/types.ts:
--   * one review shape for every submission (status, reviewer, when, return reason, resubmission);
--   * approvals and returns read from the submissions themselves (`approval_queue`), so the
--     inbox never holds a copy that can go stale;
--   * a project's money as value + optional cost allowance (no more ambiguous "budget");
--   * a Space's work style (jobs, events, engagements) and mileage rate;
--   * QR codes that know the project or link page they were made for;
--   * personal pins.

-- ---------------------------------------------------------------------------------------------
-- Spaces and projects
-- ---------------------------------------------------------------------------------------------

alter table public.spaces
  add column work_style text check (work_style in ('jobs', 'events', 'engagements')),
  add column mileage_rate numeric(5, 3);

alter table public.projects rename column budget to cost_allowance;
alter table public.projects
  add column value numeric(12, 2),
  alter column progress drop not null,
  alter column progress drop default;
comment on column public.projects.value is 'What the customer pays: a contract, a booking.';
comment on column public.projects.cost_allowance is
  'Optional internal target for costs tracked in Hyphy. Never the project value.';

-- ---------------------------------------------------------------------------------------------
-- One review shape for receipts and trips
-- ---------------------------------------------------------------------------------------------

alter table public.receipts drop constraint receipts_status_check;
update public.receipts set status = 'returned' where status = 'rejected';
alter table public.receipts
  add constraint receipts_status_check check (status in ('draft', 'submitted', 'approved', 'returned')),
  add column reviewed_at timestamptz,
  add column return_reason text check (length(return_reason) <= 280),
  add column resubmitted_at timestamptz,
  add column return_seen_at timestamptz;

alter table public.mileage_entries drop constraint mileage_entries_status_check;
update public.mileage_entries set status = 'returned' where status = 'rejected';
alter table public.mileage_entries
  add constraint mileage_entries_status_check check (status in ('draft', 'submitted', 'approved', 'returned')),
  add column reviewed_at timestamptz,
  add column return_reason text check (length(return_reason) <= 280),
  add column resubmitted_at timestamptz,
  add column return_seen_at timestamptz;

-- The submitter fixes a returned item (or finishes a draft) and sends it again; reviewers decide,
-- but never on their own submissions.
drop policy "Edit your drafts; reviewers decide" on public.receipts;
create policy "Fix and resend your own; reviewers decide on others'" on public.receipts
  for update to authenticated using (
    (created_by = auth.uid() and status in ('draft', 'returned'))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  ) with check (
    (created_by = auth.uid() and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  );

drop policy "Reviewers decide on trips" on public.mileage_entries;
create policy "Fix and resend your own trips; reviewers decide on others'" on public.mileage_entries
  for update to authenticated using (
    (created_by = auth.uid() and status in ('draft', 'returned'))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  ) with check (
    (created_by = auth.uid() and (status in ('draft', 'submitted') or can(space_id, 'expenses.approve')))
    or (can(space_id, 'expenses.approve') and created_by <> auth.uid())
  );

-- Everything waiting on a decision, one shape for every kind. Invoker rights: each reader sees
-- only the rows the receipts and mileage policies already allow them.
create view public.approval_queue with (security_invoker = true) as
  select 'receipt' as kind, id, space_id, created_by, created_at, date, status,
         vendor as title, total as value, project_id, vehicle_id,
         reviewed_by, reviewed_at, return_reason, resubmitted_at
  from public.receipts
  union all
  select 'mileage', id, space_id, created_by, created_at, date, status,
         "from" || ' → ' || "to", miles, project_id, vehicle_id,
         reviewed_by, reviewed_at, return_reason, resubmitted_at
  from public.mileage_entries;

-- Submissions no longer write inbox rows: the queue above is the approvals inbox.
create or replace function public.log_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fields jsonb := to_jsonb(new);
  kind text := case tg_table_name when 'receipts' then 'receipt' else 'mileage' end;
  label text := case tg_table_name
    when 'receipts' then (fields ->> 'vendor') || ' receipt'
    else (fields ->> 'from') || ' → ' || (fields ->> 'to') end;
begin
  insert into activity (space_id, actor_id, verb, object_type, object_id, object_label,
                        context_type, context_id, context_label)
  select new.space_id, new.created_by,
         case kind when 'receipt' then 'submitted' else 'logged' end, kind, new.id, label,
         case when p.id is not null then 'project' end, p.id, p.name
  from (select 1) one left join projects p on p.id = (fields ->> 'project_id')::uuid;
  return new;
end;
$$;

-- Decisions and resubmissions write their own activity line; a return carries its reason.
create or replace function public.log_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  fields jsonb := to_jsonb(new);
  kind text := case tg_table_name when 'receipts' then 'receipt' else 'mileage' end;
  label text := case tg_table_name
    when 'receipts' then (fields ->> 'vendor') || ' receipt'
    else (fields ->> 'from') || ' → ' || (fields ->> 'to') end;
  verb text;
begin
  if new.status is not distinct from old.status then return new; end if;
  verb := case
    when old.status = 'returned' and new.status in ('submitted', 'approved') then 'resubmitted'
    when old.status = 'draft' then 'submitted'
    when new.status in ('approved', 'returned') then new.status
  end;
  if verb is null then return new; end if;
  insert into activity (space_id, actor_id, verb, object_type, object_id, object_label, detail)
  values (new.space_id, auth.uid(), verb, kind, new.id, label,
          case when verb = 'returned' and new.return_reason <> '' then '“' || new.return_reason || '”' end);
  return new;
end;
$$;
create trigger receipts_reviewed after update on public.receipts
  for each row execute function public.log_review();
create trigger mileage_reviewed after update on public.mileage_entries
  for each row execute function public.log_review();

-- ---------------------------------------------------------------------------------------------
-- QR codes know what they were made for
-- ---------------------------------------------------------------------------------------------

alter table public.qr_codes
  add column project_id uuid references public.projects (id) on delete set null,
  add column link_page_id uuid references public.link_pages (id) on delete set null;

-- ---------------------------------------------------------------------------------------------
-- Pins: a person's own shortcuts in one Space
-- ---------------------------------------------------------------------------------------------

create table public.pins (
  space_id uuid not null references public.spaces (id) on delete cascade,
  person_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('tool', 'project')),
  target_id text not null,
  created_at timestamptz not null default now(),
  primary key (space_id, person_id, target_type, target_id)
);
alter table public.pins enable row level security;
create policy "Your own pins" on public.pins
  for all to authenticated using (person_id = auth.uid() and is_member(space_id))
  with check (person_id = auth.uid() and is_member(space_id));
