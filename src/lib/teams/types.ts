import type { Role } from '@/lib/platform/types';

/**
 * An invitation to a Business: an email address, the role it will grant and a link. Not a
 * membership — that exists only once the invited person accepts (supabase/migrations,
 * business_spaces). `expired` is a pending invitation past its date.
 */
export type Invitation = {
  id: string;
  spaceId: string;
  email: string;
  /** How the inviter referred to them; empty if they didn't say. */
  name: string;
  role: Role;
  title: string;
  projectIds: string[];
  note?: string;
  status: 'pending' | 'expired' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
  sentAt: string;
  expiresAt: string;
};

export type InviteInput = {
  email: string;
  role: Role;
  name?: string;
  title?: string;
  projectIds?: string[];
  note?: string;
};

export type InviteResult = {
  invitation: Pick<Invitation, 'id' | 'email' | 'name' | 'role'>;
  /** Whether an email went out; if not, the link can be shared from People. */
  emailed: boolean;
};

/** Managing who's in a Business. Every method is checked again by the database. */
export interface Team {
  /** Whether this is a real team (real accounts) or Demo Mode's story. */
  readonly real: boolean;
  /** Open invitations (pending or expired), newest first. Empty for people who can't manage. */
  invitations(): Promise<Invitation[]>;
  invite(input: InviteInput): Promise<InviteResult>;
  /** A new link, emailed; the old link stops working. Renews an expired invitation. */
  resend(invitationId: string): Promise<{ emailed: boolean }>;
  /** A new link to share by hand (not emailed); the old link stops working. */
  shareLink(invitationId: string): Promise<string>;
  revoke(invitationId: string): Promise<void>;
  setInvitationRole(invitationId: string, role: Role, projectIds?: string[]): Promise<void>;
  setMemberRole(personId: string, role: Role): Promise<void>;
  removeMember(personId: string): Promise<void>;
  leave(): Promise<void>;
  transferOwnership(personId: string): Promise<void>;
}

/** What an invitation link shows, before and after sign-in. */
export type InvitationPreview = {
  id: string;
  spaceId: string;
  spaceName: string;
  brand: { color: string; ink: 'light' | 'dark'; monogram: string };
  email: string;
  role: Role;
  title: string;
  note?: string;
  inviterName: string;
  status: Invitation['status'];
  expiresAt: string;
};

export type AcceptOutcome =
  | 'joined'
  | 'already_member'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'wrong_account'
  | 'unconfirmed';
