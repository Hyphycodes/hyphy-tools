/**
 * How something was paid for. A personal card means the business pays the person back, which a
 * business can switch off (`receipts.allowPersonal`). The database reads the same prefix
 * (`private.check_submission_rules`).
 */
export const PERSONAL_PAYMENT = 'Personal card (reimburse me)';

export function isPersonalPayment(method: string | undefined | null) {
  return typeof method === 'string' && /^personal\b/i.test(method.trim());
}
