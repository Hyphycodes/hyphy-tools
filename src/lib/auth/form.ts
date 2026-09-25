import type { AuthProblem } from './errors';

/** What an account form shows after it's been sent. */
export type AuthFormState = {
  /** The one thing to fix, said plainly. */
  problem?: AuthProblem;
  /** It worked, and here's what happens next (e.g. "Check your email"). */
  done?: boolean;
  /** Echoed back so a failed submit doesn't empty the form (never the password). */
  values?: { name?: string; email?: string };
  /** Changes on every submit, so the same message announces again. */
  at?: number;
};

export const initialAuthState: AuthFormState = {};
