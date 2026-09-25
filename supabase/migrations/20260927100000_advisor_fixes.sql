-- Hyphy Tools — Supabase database advisor findings on hyphy-tools-dev.
--
-- Trigger functions are security definer and live in the exposed `public` schema, so the Data
-- API lists them as callable RPCs. A trigger function can't actually be called outside a trigger,
-- but nobody should be offered one: only the triggers use them, and firing a trigger doesn't need
-- the EXECUTE privilege. The policy helpers (can, is_member, role_in, can_see_project,
-- can_see_file) stay callable — policies run them as the signed-in person, and they only ever
-- answer about that person's own access.

revoke execute on function public.handle_new_profile(), public.log_submission(),
  public.log_review(), public.log_approval(), public.log_record(), public.log_file(),
  public.log_membership(), public.log_modules(), public.guard_review()
  from public, anon, authenticated;

-- A fixed search path, like every other function here.
alter function public.trip_label(text, text) set search_path = public;
