'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { finishSetup, invitePerson } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { roles } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';

/**
 * "Invite your team", the last step of setting up a business. As many as they like, or none:
 * each invitation is sent as it's added, and Finish (or Skip) goes to the business's Home.
 */
export function SetupTeam({ slug, grantable }: { slug: string; grantable: Role[] }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(grantable.includes('member') ? 'member' : grantable[0]);
  const [sent, setSent] = useState<{ email: string; role: Role; note: string }[]>([]);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [finishing, startFinish] = useTransition();
  const selectable = grantable.filter((item) => item !== 'guest');

  const finish = () =>
    startFinish(async () => {
      const result = await finishSetup(slug);
      router.push(result.ok && result.href ? result.href : `/${slug}`);
    });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <form
        className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          start(async () => {
            const result = await invitePerson(slug, { email, role });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setSent((list) => [{ email, role, note: result.message ?? '' }, ...list]);
            setEmail('');
          });
        }}
      >
        <Field label="Email" htmlFor="setup-email">
          <Input
            id="setup-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            data-autofocus
          />
        </Field>
        <Field label="Role" htmlFor="setup-role">
          <Select
            id="setup-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {selectable.map((option) => (
              <option key={option} value={option}>
                {roles[option].label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={pending || !email.trim()}>
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </form>
      <p className="-mt-2 text-[12.5px] text-muted">{roles[role].summary}</p>
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-[12px] bg-critical-soft px-3.5 py-3 text-[14px] text-critical"
        >
          <Icon name="alert" size={17} className="mt-px" /> {error}
        </p>
      )}
      {sent.length > 0 && (
        <ul className="row-divide rounded-[14px] bg-subtle" aria-label="Invited">
          {sent.map((item) => (
            <li key={item.email} className="flex items-center gap-3 px-4 py-3 text-[14px]">
              <Icon name="check-circle" size={17} className="text-positive" />
              <span className="min-w-0 flex-1 truncate">{item.email}</span>
              <span className="text-[12.5px] text-muted">{roles[item.role].label}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <p className="text-[13px] text-muted">
          Guests and anyone else can be invited any time from People.
        </p>
        <Button
          variant={sent.length ? 'primary' : 'secondary'}
          onClick={finish}
          disabled={finishing}
        >
          {finishing ? 'Opening…' : sent.length ? 'Finish' : 'Skip for now'}
        </Button>
      </div>
    </div>
  );
}
