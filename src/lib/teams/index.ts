import 'server-only';
import { cache } from 'react';
import { getRepository } from '@/lib/data';
import type { Workspace } from '@/lib/identity/types';
import { demoTeam } from './demo';
import { supabaseTeam } from './supabase';
import type { Team } from './types';

export type { AcceptOutcome, Invitation, InvitationPreview, InviteInput, Team } from './types';

/**
 * The team of the Business in this Workspace: real (the signed-in person managing real
 * memberships and invitations) or Demo Mode's story. The same People screens use either.
 */
export const teamFor = cache((workspace: Workspace): Team =>
  workspace.session.source === 'supabase'
    ? supabaseTeam(workspace)
    : demoTeam(workspace, getRepository(workspace)),
);
