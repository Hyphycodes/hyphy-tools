-- The public Tools marketplace (/tools) and the Spaces front door (/spaces) are the app's own
-- addresses, so no Space can take them (src/lib/auth/routes.ts, reservedSlugs).
alter table public.spaces drop constraint spaces_slug_not_reserved;
alter table public.spaces add constraint spaces_slug_not_reserved check (
  slug not in ('personal', 'auth', 'sign-in', 'sign-up', 'sign-out', 'forgot-password',
               'reset-password', 'welcome', 'account', 'api', 'platform', 'invite', 'invites',
               'create-business', 'new', 'dev', 'settings', 'help', 'tools', 'spaces')
);
