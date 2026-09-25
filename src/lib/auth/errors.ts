/**
 * Supabase Auth's answers, in Hyphy's words. Known codes get a plain sentence (and the field it's
 * about); anything else gets a calm generic line — with the original code and message appended in
 * development, so it stays diagnosable.
 *
 * Deliberately vague where precision would help an attacker: a wrong password and an unknown email
 * read the same, and a reset request always "sends".
 */
export type AuthIntent =
  | 'sign-in'
  | 'sign-up'
  | 'forgot-password'
  | 'reset-password'
  | 'change-password'
  | 'confirm'
  | 'profile';

export type AuthProblem = {
  message: string;
  field?: 'name' | 'email' | 'password';
  /** Not a failure, just something to know (e.g. the Demo Mode preview). */
  notice?: boolean;
};

type ErrorLike = {
  code?: string;
  status?: number;
  message?: string;
  name?: string;
  reasons?: string[];
};

const connection: AuthProblem = {
  message: 'We couldn’t reach Hyphy. Check your connection and try again.',
};

export function authProblem(
  error: unknown,
  intent: AuthIntent,
  env: string | undefined = process.env.NODE_ENV,
): AuthProblem {
  const e = (error ?? {}) as ErrorLike;
  const code = e.code ?? '';
  const known = byCode(code, e, intent);
  if (known) return known;
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    /fetch failed|network|ECONNREFUSED|ETIMEDOUT/i.test(e.message ?? '')
  )
    return connection;
  if (e.status === 429) return rateLimited;
  const generic = 'Something went wrong on our side. Try again in a moment.';
  return {
    message:
      env === 'development' && (code || e.message)
        ? `${generic} (${[code, e.message].filter(Boolean).join(': ')})`
        : generic,
  };
}

const rateLimited: AuthProblem = {
  message: 'That’s a lot of tries in a short time. Wait a minute, then try again.',
};

function byCode(code: string, e: ErrorLike, intent: AuthIntent): AuthProblem | null {
  switch (code) {
    case 'invalid_credentials':
      return { message: 'That email and password don’t match. Check both and try again.' };
    case 'email_not_confirmed':
      return {
        message: 'Confirm your email first — the link is in your inbox.',
        field: 'email',
      };
    case 'user_already_exists':
    case 'email_exists':
    case 'identity_already_exists':
      return {
        message: 'There’s already an account with this email. Sign in instead.',
        field: 'email',
      };
    case 'weak_password':
      return {
        message: e.reasons?.includes('pwned')
          ? 'That password has appeared in a data breach. Choose a different one.'
          : 'Choose a stronger password: at least 8 characters, mixing letters and numbers.',
        field: 'password',
      };
    case 'same_password':
      return { message: 'That’s your current password. Choose a new one.', field: 'password' };
    case 'email_address_invalid':
      return { message: 'Enter a valid email address.', field: 'email' };
    case 'email_address_not_authorized':
      return {
        message: 'We can’t send email to that address yet. Try another address.',
        field: 'email',
      };
    case 'otp_expired':
      return {
        message:
          intent === 'reset-password'
            ? 'This reset link has expired or was already used. Ask for a new one.'
            : 'This link has expired or was already used.',
      };
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return {
        message:
          'This link has expired, or was opened in a different browser from the one you started in.',
      };
    case 'over_email_send_rate_limit':
      return {
        message: 'We’ve sent a few emails already. Wait a minute, then try again.',
      };
    case 'over_request_rate_limit':
      return rateLimited;
    case 'signup_disabled':
    case 'email_provider_disabled':
      return { message: 'New accounts aren’t open right now.' };
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return {
        message:
          intent === 'reset-password'
            ? 'This reset link has expired. Ask for a new one.'
            : 'Your session has ended. Sign in again.',
      };
    case 'reauthentication_needed':
    case 'reauthentication_not_valid':
      return { message: 'For your security, sign in again, then change your password.' };
    case 'user_banned':
      return { message: 'This account can’t sign in right now.' };
    case 'request_timeout':
    case 'hook_timeout':
    case 'hook_timeout_after_retry':
      return connection;
    case 'validation_failed':
      return intent === 'sign-in' || intent === 'sign-up' || intent === 'forgot-password'
        ? { message: 'Enter a valid email address.', field: 'email' }
        : null;
    default:
      return null;
  }
}

/* ---------- the checks a form makes before asking Supabase ---------- */

export const PASSWORD_MIN = 8;

export function checkEmail(value: string): AuthProblem | null {
  const email = value.trim();
  if (!email) return { message: 'Enter your email.', field: 'email' };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { message: 'Enter a valid email address.', field: 'email' };
  return null;
}

export function checkNewPassword(value: string): AuthProblem | null {
  if (value.length < PASSWORD_MIN)
    return { message: `Use at least ${PASSWORD_MIN} characters.`, field: 'password' };
  if (value.length > 72) return { message: 'Use 72 characters or fewer.', field: 'password' };
  if (!/[a-zA-Z]/.test(value) || !/[0-9\W_]/.test(value))
    return {
      message: 'Mix letters with at least one number or symbol.',
      field: 'password',
    };
  return null;
}

export function checkName(value: string): AuthProblem | null {
  const name = value.trim();
  if (!name) return { message: 'Tell us what to call you.', field: 'name' };
  if (name.length > 80) return { message: 'Keep it under 80 characters.', field: 'name' };
  return null;
}
