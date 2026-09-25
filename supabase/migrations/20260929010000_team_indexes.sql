-- Hyphy Tools — indexes for the Phase 2B "who did it" columns.
--
-- `revoked_by` and `removed_by` point at profiles. Without an index, anything that checks those
-- references (deleting or merging a profile) scans every invitation and membership. Both are
-- mostly null, so the indexes only hold the rows that have a value.

create index if not exists space_invitations_revoked_by on public.space_invitations (revoked_by)
  where revoked_by is not null;
create index if not exists space_members_removed_by on public.space_members (removed_by)
  where removed_by is not null;
