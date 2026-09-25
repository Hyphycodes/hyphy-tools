-- Hyphy Tools — each trip keeps the per-mile rate it was logged at (Phase 2C follow-up).
--
-- Phase 2C lets a business change what it pays back per mile. Payback used to be worked out as
-- miles × the business's current rate, so a new rate would have re-priced every trip already
-- logged. Now a trip records the business's rate when it's logged — 0 when the business wasn't
-- paying miles back then — and payback is miles × that. The database sets it; nobody can choose
-- or change it. Personal Spaces don't pay anyone back, so their trips have none.

alter table public.mileage_entries add column rate numeric(5, 3)
  constraint mileage_rate_range check (rate is null or (rate >= 0 and rate <= 5));

-- Trips logged before this: the business's rate as it stands now, the best record there is. (Runs
-- before the trigger below exists; the triggers that do run do nothing without a signed-in person.)
update public.mileage_entries m set rate = coalesce(s.mileage_rate, 0)
  from public.spaces s where s.id = m.space_id and s.kind = 'business';

create or replace function private.stamp_mileage_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.seeding() then return new; end if;
  if tg_op = 'INSERT' then
    select case when s.kind = 'business' then coalesce(s.mileage_rate, 0) end into new.rate
    from public.spaces s where s.id = new.space_id;
  else
    new.rate := old.rate;
  end if;
  return new;
end;
$$;
create trigger mileage_rate_stamped before insert or update on public.mileage_entries
  for each row execute function private.stamp_mileage_rate();

revoke execute on function private.stamp_mileage_rate() from public, anon, authenticated;
