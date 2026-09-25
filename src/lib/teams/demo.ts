import 'server-only';
import { RuleError, type Repository } from '@/lib/data/repository';
import type { Workspace } from '@/lib/identity/types';
import type { Invitation, Team } from './types';

export const DEMO_TEAM =
  'In Demo Mode the team is part of the story. Changing roles, removing people and sending invitations work with real accounts.';

/**
 * Demo Mode's team: the seeded people, as they are. Inviting still adds a fictional "Invited"
 * person the way the preview always has (in this browser, or on the development database);
 * shown here as open invitations so People looks the way it will. Nothing else changes anyone.
 */
export function demoTeam(workspace: Workspace, repo: Repository): Team {
  const refuse = async (): Promise<never> => {
    throw new RuleError(DEMO_TEAM);
  };
  return {
    real: false,
    async invitations() {
      if (!workspace.permissions.includes('people.manage')) return [];
      const week = 7 * 86_400_000;
      return (await repo.members())
        .filter((member) => member.status === 'invited')
        .map((member): Invitation => ({
          id: member.id,
          spaceId: member.spaceId,
          email: member.person.email,
          name: member.person.name,
          role: member.role,
          title: member.title,
          projectIds: member.projectIds ?? [],
          status: 'pending',
          invitedBy: workspace.person.id,
          createdAt: member.joinedAt,
          sentAt: member.joinedAt,
          expiresAt: new Date(new Date(member.joinedAt).getTime() + week).toISOString(),
        }))
        .map((item) =>
          new Date(item.expiresAt).getTime() < Date.now() ? { ...item, status: 'expired' } : item,
        );
    },
    async invite(input) {
      const member = await repo.invite({
        name: input.name || input.email.split('@')[0],
        email: input.email,
        role: input.role,
        title: input.title || (input.role === 'guest' ? 'Guest' : 'Team member'),
        projectIds: input.projectIds,
      });
      return {
        invitation: {
          id: member.id,
          email: input.email,
          name: member.person.name,
          role: member.role,
        },
        emailed: false,
      };
    },
    resend: refuse,
    shareLink: refuse,
    revoke: refuse,
    setInvitationRole: refuse,
    setMemberRole: refuse,
    removeMember: refuse,
    leave: refuse,
    transferOwnership: refuse,
  };
}
