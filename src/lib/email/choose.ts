/** Which email provider this deployment uses (see `./index.ts`). Pure, for tests. */
export type EmailProviderName = 'capture' | 'resend' | 'none';

export function emailProviderName(
  env: Record<string, string | undefined> = process.env,
): EmailProviderName {
  const choice = env.HYPHY_EMAIL?.trim().toLowerCase();
  if (choice === 'resend' || choice === 'capture' || choice === 'none') return choice;
  return env.NODE_ENV === 'production' ? 'none' : 'capture';
}
