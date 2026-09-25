'use client';
import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import {
  requestPasswordReset,
  resendConfirmation,
  setNewPassword,
  signIn,
  signUp,
  updateDisplayName,
} from '@/lib/auth/actions';
import { PASSWORD_MIN } from '@/lib/auth/errors';
import { initialAuthState, type AuthFormState } from '@/lib/auth/form';
import { authRoutes } from '@/lib/auth/routes';
import { AuthField, PasswordField, Problem, Submit, useFormRef, useProblemFocus } from './fields';
import { inlineLink } from './frame';

const on = (state: AuthFormState, field: 'name' | 'email' | 'password') =>
  state.problem?.field === field;

/* ---------- sign in ---------- */

export function SignInForm({ next, email }: { next?: string; email?: string }) {
  const [state, action, pending] = useActionState(signIn, initialAuthState);
  const form = useFormRef();
  const problemId = useId();
  useProblemFocus(state, form);
  return (
    <form ref={form} action={action} noValidate className="grid gap-4">
      <Problem problem={state.problem} id={problemId} />
      {next && <input type="hidden" name="next" value={next} />}
      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email ?? email}
        invalid={on(state, 'email')}
        problemId={problemId}
      />
      <div className="grid gap-1.5">
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          required
          invalid={on(state, 'password') || state.problem?.message.startsWith('That email and')}
          problemId={problemId}
        />
        <Link
          href={authRoutes.forgotPassword}
          className="justify-self-end rounded-[6px] py-1 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          Forgot password?
        </Link>
      </div>
      <Submit pending={pending} pendingLabel="Signing in…">
        Sign in
      </Submit>
    </form>
  );
}

/* ---------- sign up ---------- */

export function SignUpForm({ next, email }: { next?: string; email?: string }) {
  const [state, action, pending] = useActionState(signUp, initialAuthState);
  const form = useFormRef();
  const problemId = useId();
  useProblemFocus(state, form);
  if (state.done) return <CheckEmail email={state.values?.email ?? ''} />;
  return (
    <form ref={form} action={action} noValidate className="grid gap-4">
      <Problem problem={state.problem} id={problemId} />
      {next && <input type="hidden" name="next" value={next} />}
      <AuthField
        label="Name"
        name="name"
        autoComplete="name"
        autoCapitalize="words"
        required
        maxLength={80}
        defaultValue={state.values?.name}
        invalid={on(state, 'name')}
        problemId={problemId}
      />
      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email ?? email}
        invalid={on(state, 'email')}
        problemId={problemId}
      />
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN}
        required
        hint={`At least ${PASSWORD_MIN} characters, with a number or symbol.`}
        invalid={on(state, 'password')}
        problemId={problemId}
      />
      <Submit pending={pending} pendingLabel="Creating account…" className="mt-1">
        Create account
      </Submit>
    </form>
  );
}

/** After sign-up: the one thing to do next, and a way to get the email again. */
function CheckEmail({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendConfirmation, initialAuthState);
  const problemId = useId();
  return (
    <div className="animate-rise">
      <span className="mb-4 grid size-12 place-items-center rounded-[14px] bg-signal-soft text-signal">
        <Icon name="mail" size={22} />
      </span>
      <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Check your email</h2>
      <p role="status" className="mt-1.5 text-[15px] leading-relaxed text-muted sm:text-[14.5px]">
        We sent a link to{' '}
        <span className="font-medium [overflow-wrap:anywhere] text-ink">{email}</span>. Open it to
        confirm your account and step into your Personal Space.
      </p>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
        Already have an account with this email?{' '}
        <Link href={authRoutes.signIn} className={inlineLink}>
          Sign in
        </Link>{' '}
        instead.
      </p>
      <form action={action} className="mt-5 grid gap-3 border-t border-line pt-5">
        <Problem problem={state.problem} id={problemId} />
        <input type="hidden" name="email" value={email} />
        {state.done ? (
          <p role="status" className="flex items-center gap-2 text-[14px] text-positive">
            <Icon name="check-circle" size={17} /> Sent again. It can take a minute to arrive.
          </p>
        ) : (
          <Submit pending={pending} pendingLabel="Sending…" variant="secondary">
            Send the link again
          </Submit>
        )}
      </form>
    </div>
  );
}

/* ---------- forgot password ---------- */

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialAuthState);
  const form = useFormRef();
  const problemId = useId();
  useProblemFocus(state, form);
  if (state.done)
    return (
      <div className="animate-rise">
        <span className="mb-4 grid size-12 place-items-center rounded-[14px] bg-signal-soft text-signal">
          <Icon name="mail" size={22} />
        </span>
        <h2 className="text-[19px] font-semibold tracking-[-0.01em]">Check your email</h2>
        <p role="status" className="mt-1.5 text-[15px] leading-relaxed text-muted sm:text-[14.5px]">
          If there’s an account for{' '}
          <span className="font-medium [overflow-wrap:anywhere] text-ink">
            {state.values?.email}
          </span>
          , a link to choose a new password is on its way. It works once, for a short while.
        </p>
      </div>
    );
  return (
    <form ref={form} action={action} noValidate className="grid gap-4">
      <Problem problem={state.problem} id={problemId} />
      <AuthField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email}
        invalid={on(state, 'email')}
        problemId={problemId}
      />
      <Submit pending={pending} pendingLabel="Sending reset link…">
        Send reset link
      </Submit>
    </form>
  );
}

/* ---------- new password (reset link, or Profile) ---------- */

export function NewPasswordForm({
  intent,
  continueHref,
}: {
  intent: 'reset-password' | 'change-password';
  continueHref?: string;
}) {
  const [state, action, pending] = useActionState(setNewPassword, initialAuthState);
  const form = useFormRef();
  const problemId = useId();
  useProblemFocus(state, form);
  // After a change on Profile, "Change it again" brings the form back.
  const [dismissed, setDismissed] = useState<number>();
  if (state.done && dismissed !== state.at)
    return (
      <div className="animate-rise">
        <p role="status" className="flex items-center gap-2 text-[15px] font-medium text-positive">
          <Icon name="check-circle" size={18} /> Your password is updated.
        </p>
        {continueHref ? (
          <ButtonLink href={continueHref} variant="primary" size="lg" className="mt-5 w-full">
            Continue to Hyphy <Icon name="arrow-right" size={17} />
          </ButtonLink>
        ) : (
          <button
            type="button"
            onClick={() => setDismissed(state.at)}
            className="mt-2 text-[13.5px] text-muted underline underline-offset-2"
          >
            Change it again
          </button>
        )}
      </div>
    );
  return (
    <form ref={form} action={action} noValidate className="grid gap-4">
      <Problem problem={state.problem} id={problemId} />
      <input type="hidden" name="intent" value={intent} />
      {/* Lets password managers save the new password against the right account. */}
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN}
        required
        hint={`At least ${PASSWORD_MIN} characters, with a number or symbol.`}
        invalid={on(state, 'password')}
        problemId={problemId}
      />
      <PasswordField
        label="Confirm new password"
        name="confirm"
        autoComplete="new-password"
        required
        problemId={problemId}
      />
      <Submit pending={pending} pendingLabel="Updating password…">
        {intent === 'reset-password' ? 'Set new password' : 'Change password'}
      </Submit>
    </form>
  );
}

/* ---------- display name ---------- */

export function DisplayNameForm({ name, compact }: { name: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(updateDisplayName, initialAuthState);
  const form = useFormRef();
  const problemId = useId();
  useProblemFocus(state, form);
  return (
    <form ref={form} action={action} noValidate className="grid gap-3">
      <Problem problem={state.problem} id={problemId} />
      <div className={compact ? 'flex items-end gap-2' : 'grid gap-3'}>
        <AuthField
          label="Display name"
          name="name"
          autoComplete="name"
          autoCapitalize="words"
          required
          maxLength={80}
          defaultValue={state.values?.name ?? name}
          invalid={on(state, 'name')}
          problemId={problemId}
          className="flex-1"
        />
        <div className={compact ? 'w-auto' : ''}>
          <Submit
            pending={pending}
            pendingLabel="Saving…"
            variant="secondary"
            className={compact ? 'w-auto px-5' : ''}
          >
            Save
          </Submit>
        </div>
      </div>
      {state.done && !state.problem && (
        <p role="status" className="flex items-center gap-1.5 text-[13px] text-positive">
          <Icon name="check" size={15} /> Saved.
        </p>
      )}
    </form>
  );
}
