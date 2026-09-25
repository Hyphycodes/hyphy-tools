-- Hyphy Tools — table privileges Row Level Security can't cover.
--
-- Supabase grants `authenticated` every privilege on new tables. TRUNCATE ignores Row Level
-- Security entirely: anyone who could run SQL as a signed-in person — including the app's own
-- role, which becomes `authenticated` for each request — could empty a table across every Space.
-- The Data API can't issue TRUNCATE, but the database shouldn't rely on that. TRIGGER and
-- REFERENCES aren't needed either. Nothing in the product uses any of the three.

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables
  from anon, authenticated;
