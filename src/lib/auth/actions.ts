'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { renameSelf } from '@/lib/data/supabase/profile';
import { getSession } from '@/lib/identity';
import { identityMode } from '@/lib/identity/mode';
import { appUrl } from '@/lib/site';
import { createSupabaseServerClient, verifiedIdentity } from '@/lib/supabase/server';
import {
  authProblem,
  checkEmail,
  checkName,
  checkNewPassword,
  type AuthIntent,
  type AuthProblem,
} from './errors';
import type { AuthFormState } from './form';
import { authRoutes, safeNext } from './routes';

/*
 * Every account action runs here, on the server: the password goes from the form to Supabase
 * Auth and never into client code, and the session cookies are written by the server. In Demo
 * Mode the forms are there to look at, and every action says so instead of doing anything.
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? '');
const fail = (problem: AuthProblem, values?: AuthFormState['values']): AuthFormState => ({
  problem,
  values,
  at: Date.now(),
});

const preview: AuthProblem = {
  notice: true,
  message:
    'This is a preview: sign-in isn’t switched on yet. Demo Mode is how you use Hyphy Tools for now.',
};

function report(error: unknown, intent: AuthIntent, values?: AuthFormState['values']) {
  if (process.env.NODE_ENV !== 'production') console.warn(`[auth:${intent}]`, error);
  return fail(authProblem(error, intent), values);
}

/** Where links in account emails land. Supabase also checks them against its allowed URLs. */
async function confirmUrl(next: string) {
  return appUrl(`${authRoutes.confirm}?next=${encodeURIComponent(next)}`);
}

/* ---------- sign in / sign up ---------- */

export async function signIn(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = text(form, 'email').trim();
  const password = text(form, 'password');
  const values = { email };
  if (identityMode() !== 'supabase') return fail(preview, values);
  const invalid = checkEmail(email);
  if (invalid) return fail(invalid, values);
  if (!password) return fail({ message: 'Enter your password.', field: 'password' }, values);
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return report(error, 'sign-in', values);
  } catch (error) {
    return report(error, 'sign-in', values);
  }
  redirect(safeNext(text(form, 'next')));
}

export async function signUp(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const name = text(form, 'name').trim().replace(/\s+/g, ' ');
  const email = text(form, 'email').trim();
  const password = text(form, 'password');
  const values = { name, email };
  // Where they were headed (an invitation, say), kept through the confirmation email.
  const next = safeNext(text(form, 'next'), authRoutes.welcome);
  if (identityMode() !== 'supabase') return fail(preview, values);
  const invalid = checkName(name) ?? checkEmail(email) ?? checkNewPassword(password);
  if (invalid) return fail(invalid, values);
  let signedIn = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: await confirmUrl(next),
        // Only a display name: the bootstrap uses it for the profile. Nothing about access is ever
        // read from user metadata.
        data: { name },
      },
    });
    if (error) return report(error, 'sign-up', values);
    // With email confirmation off, Supabase signs them straight in.
    signedIn = Boolean(data.session);
  } catch (error) {
    return report(error, 'sign-up', values);
  }
  if (signedIn) redirect(next);
  // Confirmation on: "check your email" — also what an existing address gets, on purpose, so the
  // form can't be used to find out who has an account.
  return { done: true, values, at: Date.now() };
}

export async function resendConfirmation(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const email = text(form, 'email').trim();
  const values = { email };
  if (identityMode() !== 'supabase') return fail(preview, values);
  const invalid = checkEmail(email);
  if (invalid) return fail(invalid, values);
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: await confirmUrl(authRoutes.welcome) },
    });
    if (error) return report(error, 'sign-up', values);
  } catch (error) {
    return report(error, 'sign-up', values);
  }
  return { done: true, values, at: Date.now() };
}

/* ---------- passwords ---------- */

export async function requestPasswordReset(
  _: AuthFormState,
  form: FormData,
): Promise<AuthFormState> {
  const email = text(form, 'email').trim();
  const values = { email };
  if (identityMode() !== 'supabase') return fail(preview, values);
  const invalid = checkEmail(email);
  if (invalid) return fail(invalid, values);
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: await confirmUrl(authRoutes.resetPassword),
    });
    // Supabase answers the same whether or not the address has an account; so do we. Only
    // problems the person can do something about (rate limits, the network) are shown.
    if (error && error.code !== 'user_not_found') return report(error, 'forgot-password', values);
  } catch (error) {
    return report(error, 'forgot-password', values);
  }
  return { done: true, values, at: Date.now() };
}

/** A new password, from a reset link's session or from Profile. */
export async function setNewPassword(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const intent: AuthIntent =
    text(form, 'intent') === 'change-password' ? 'change-password' : 'reset-password';
  if (identityMode() !== 'supabase') return fail(preview);
  const password = text(form, 'password');
  const invalid = checkNewPassword(password);
  if (invalid) return fail(invalid);
  if (form.has('confirm') && text(form, 'confirm') !== password)
    return fail({ message: 'The two passwords don’t match.', field: 'password' });
  try {
    if (!(await verifiedIdentity()))
      return fail(authProblem({ code: 'session_not_found' }, intent));
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return report(error, intent);
  } catch (error) {
    return report(error, intent);
  }
  return { done: true, at: Date.now() };
}

/* ---------- profile ---------- */

export async function updateDisplayName(_: AuthFormState, form: FormData): Promise<AuthFormState> {
  const name = text(form, 'name').trim().replace(/\s+/g, ' ');
  const values = { name };
  const invalid = checkName(name);
  if (invalid) return fail(invalid, values);
  const session = await getSession();
  // Only a real account renames itself; Demo Mode's people are the seed's.
  if (!session?.account) return fail(preview, values);
  try {
    await renameSelf(session.person.id, name);
  } catch (error) {
    return report(error, 'profile', values);
  }
  revalidatePath('/', 'layout');
  return { done: true, values, at: Date.now() };
}

/* ---------- sign out ---------- */

/**
 * Ends this session: Supabase revokes it and the cookies are cleared. The person, their Spaces
 * and their work are untouched — signing out is not deleting anything.
 */
export async function signOut(form?: FormData) {
  // Where to sign back in to (e.g. an invitation meant for another account).
  const next = form ? safeNext(String(form.get('next') ?? ''), '') : '';
  if (identityMode() !== 'supabase') redirect('/');
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    // Couldn't reach Supabase: clear this browser's session cookies anyway. The session itself
    // then simply expires.
    console.warn('[auth:sign-out]', error);
    const store = await cookies();
    for (const cookie of store.getAll())
      if (cookie.name.startsWith('sb-')) store.delete(cookie.name);
  }
  revalidatePath('/', 'layout');
  redirect(next ? `${authRoutes.signIn}?next=${encodeURIComponent(next)}` : authRoutes.signIn);
}
