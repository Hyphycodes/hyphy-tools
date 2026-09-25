import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuthAside, AuthCard, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { PendingButton } from '@/components/business/invite-buttons';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { signOut } from '@/lib/auth/actions';
import { authRoutes } from '@/lib/auth/routes';
import { acceptInviteAction } from '@/lib/business/actions';
import { getSession } from '@/lib/identity';
import { identityMode } from '@/lib/identity/mode';
import { roles } from '@/lib/platform/roles';
import { previewInvitation } from '@/lib/teams/accept';
import type { InvitationPreview } from '@/lib/teams/types';

export const metadata: Metadata = { title: 'Invitation', referrer: 'no-referrer' };

const refusals: Record<string, { title: string; body: string }> = {
  expired: {
    title: 'This invitation has expired.',
    body: 'Invitations work for 7 days. Ask the business to send a new one.',
  },
  revoked: {
    title: 'This invitation was withdrawn.',
    body: 'The business took it back. If that’s a surprise, ask them to send a new one.',
  },
  used: {
    title: 'This invitation was already used.',
    body: 'Someone already joined with it. If that wasn’t you, ask the business to send a new one.',
  },
  invalid: {
    title: 'This invitation link isn’t valid.',
    body: 'It may be incomplete, or it was replaced by a newer email. Use the newest one you got.',
  },
  unconfirmed: {
    title: 'Confirm your email first.',
    body: 'Open the confirmation link we sent when you created your account, then come back here.',
  },
};

/**
 * Where an invitation email lands. Explains who invited you where, as what, and for which
 * address; then either gets you an account (keeping the invitation for after you confirm), asks
 * you to switch to the invited account, or offers Accept. Nothing happens until you accept.
 */
export default async function InvitePage({ params, searchParams }: PageProps<'/invite/[token]'>) {
  const { token } = await params;
  const outcome = String((await searchParams).outcome ?? '');
  const here = `/invite/${token}`;

  if (identityMode() !== 'supabase')
    return (
      <Refusal
        title="Invitations work with real accounts."
        body="This preview runs in Demo Mode, so invitation links don’t do anything here."
        action={
          <ButtonLink href="/" variant="primary" size="lg" className="w-full">
            Open Hyphy Tools
          </ButtonLink>
        }
      />
    );

  const [invite, session] = await Promise.all([previewInvitation(token), getSession()]);
  if (!invite) return <Refusal {...refusals.invalid} />;

  const member = session?.memberships.find((item) => item.spaceId === invite.spaceId);
  if (invite.status === 'accepted')
    return member ? (
      <AlreadyIn invite={invite} slug={member.space.slug} />
    ) : (
      <Refusal {...refusals.used} />
    );
  if (invite.status !== 'pending') return <Refusal {...refusals[invite.status]} />;

  const inviter = invite.inviterName.trim().split(/\s+/)[0] || 'Someone';
  const role = roles[invite.role];
  const card = (children: ReactNode) => (
    <AuthCard>
      <div className="mb-5 flex items-center gap-3">
        <SpaceMark
          space={{
            id: invite.spaceId,
            name: invite.spaceName,
            kind: 'business',
            slug: '',
            brand: invite.brand,
          }}
          size="lg"
        />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{invite.spaceName}</p>
          <p className="truncate text-[13px] text-muted">
            Invited by {invite.inviterName || 'the business'}
          </p>
        </div>
      </div>
      <dl className="mb-5 grid gap-3 rounded-[14px] bg-subtle p-4 text-[14px]">
        <div>
          <dt className="label mb-1">Your role</dt>
          <dd>
            <span className="font-semibold">{role.label}</span>
            <span className="text-muted"> · {role.summary}</span>
          </dd>
        </div>
        <div>
          <dt className="label mb-1">For</dt>
          <dd className="font-medium [overflow-wrap:anywhere]">{invite.email}</dd>
        </div>
      </dl>
      {invite.note && (
        <blockquote className="mb-5 border-l-[3px] border-line-strong pl-3 text-[14px] leading-relaxed text-ink-2">
          “{invite.note}”
        </blockquote>
      )}
      {children}
    </AuthCard>
  );
  const problem = outcome && refusals[outcome] && (
    <p
      role="alert"
      className="mb-4 flex gap-2.5 rounded-[12px] bg-critical-soft px-3.5 py-3 text-[14px] text-critical"
    >
      <Icon name="alert" size={17} className="mt-px" /> {refusals[outcome].title}
    </p>
  );

  // Not signed in: get an account (or sign in) with the invited address, then come back.
  if (!session?.account)
    return (
      <AuthColumn>
        <AuthHeading eyebrow="Invitation" title={`${inviter} invited you to ${invite.spaceName}.`}>
          Create your Hyphy account with the address below to join — or sign in if you already have
          one.
        </AuthHeading>
        {card(
          <div className="grid gap-2.5">
            <ButtonLink
              href={`${authRoutes.signUp}?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}
              variant="primary"
              size="lg"
              className="w-full"
            >
              Create account to join
            </ButtonLink>
            <ButtonLink
              href={`${authRoutes.signIn}?next=${encodeURIComponent(here)}`}
              size="lg"
              className="w-full"
            >
              I have an account — sign in
            </ButtonLink>
          </div>,
        )}
      </AuthColumn>
    );

  // Signed in, but as someone else: the invitation only works for its address.
  const signedInAs = session.account.email;
  if (signedInAs.trim().toLowerCase() !== invite.email || outcome === 'wrong_account')
    return (
      <AuthColumn>
        <AuthHeading eyebrow="Invitation" title="This invitation is for another account.">
          It was sent to {invite.email}. You’re signed in as {signedInAs}. Sign in with the invited
          address to accept it.
        </AuthHeading>
        <form action={signOut}>
          <input type="hidden" name="next" value={here} />
          <PendingButton pendingLabel="Signing out…">Sign in as {invite.email}</PendingButton>
        </form>
        <AuthAside>
          <Link href="/" className={inlineLink}>
            Stay signed in as {signedInAs}
          </Link>
        </AuthAside>
      </AuthColumn>
    );

  if (member) return <AlreadyIn invite={invite} slug={member.space.slug} token={token} />;

  return (
    <AuthColumn>
      <AuthHeading eyebrow="Invitation" title={`Join ${invite.spaceName}?`}>
        You’ll see {invite.spaceName} next to your Personal Space. Your Personal Space stays yours.
      </AuthHeading>
      {problem}
      {card(
        <form action={acceptInviteAction} className="grid gap-2.5">
          <input type="hidden" name="token" value={token} />
          <PendingButton pendingLabel="Joining…">Accept invite</PendingButton>
          <ButtonLink href="/" size="lg" variant="ghost" className="w-full">
            Not now
          </ButtonLink>
        </form>,
      )}
    </AuthColumn>
  );
}

function Refusal({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <AuthColumn>
      <span className="mb-5 ml-1 grid size-12 place-items-center rounded-[14px] bg-caution-soft text-caution">
        <Icon name="mail" size={22} />
      </span>
      <AuthHeading title={title}>{body}</AuthHeading>
      {action ?? (
        <ButtonLink href="/" variant="primary" size="lg" className="w-full">
          Open Hyphy Tools
        </ButtonLink>
      )}
    </AuthColumn>
  );
}

/** Already a member: accepting again changes nothing, so this just opens the business. */
function AlreadyIn({
  invite,
  slug,
  token,
}: {
  invite: InvitationPreview;
  slug: string;
  token?: string;
}) {
  return (
    <AuthColumn>
      <AuthHeading eyebrow="Invitation" title={`You’re already part of ${invite.spaceName}.`}>
        Nothing to accept — it’s in your Spaces.
      </AuthHeading>
      {token ? (
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          <PendingButton pendingLabel="Opening…">Open {invite.spaceName}</PendingButton>
        </form>
      ) : (
        <ButtonLink href={`/${slug}`} variant="primary" size="lg" className="w-full">
          Open {invite.spaceName}
        </ButtonLink>
      )}
    </AuthColumn>
  );
}
