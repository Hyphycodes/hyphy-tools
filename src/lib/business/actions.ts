'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { RuleError } from '@/lib/data/repository';
import { requireSession } from '@/lib/identity';
import { checkAddress, isBusinessType, slugify } from '@/lib/platform/business-types';
import { acceptInvitation } from '@/lib/teams/accept';
import { INVITE_TOKEN } from '@/lib/teams/token';
import { createBusiness } from './index';
import type { BusinessFormState } from './form';

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

/**
 * Create a Business: the one action behind every "Create a business" button. On success the
 * owner goes straight into its short setup.
 */
export async function createBusinessAction(
  _: BusinessFormState,
  form: FormData,
): Promise<BusinessFormState> {
  const session = await requireSession('/create-business');
  const name = text(form, 'name').replace(/\s+/g, ' ');
  const type = text(form, 'type');
  const typed = text(form, 'address').toLowerCase();
  const address = typed || slugify(name);
  const values = { name, type, address: typed };
  const fail = (message: string, field: 'name' | 'type' | 'address'): BusinessFormState => ({
    problem: { message, field },
    values,
    at: Date.now(),
  });
  if (!name) return fail('Give your business a name.', 'name');
  if (name.length > 80) return fail('Keep the name under 80 characters.', 'name');
  if (!isBusinessType(type)) return fail('Choose what kind of business it is.', 'type');
  if (!address) return fail('Choose an address for your business.', 'address');
  const invalid = checkAddress(address);
  if (invalid) return fail(invalid, 'address');
  // One key per form: a double submit or a retried request returns the same Business.
  const key = text(form, 'requestKey');
  const requestKey = /^[0-9a-f-]{36}$/.test(key) ? key : randomUUID();
  let slug: string;
  try {
    ({ slug } = await createBusiness(session, {
      name,
      type,
      address,
      // An address they typed is what they asked for; one made from the name may take a variant.
      exact: Boolean(typed),
      requestKey,
    }));
  } catch (error) {
    if (error instanceof RuleError)
      return fail(error.message, /address/i.test(error.message) ? 'address' : 'name');
    console.error(error);
    return fail('Something went wrong. Try again.', 'name');
  }
  revalidatePath('/', 'layout');
  redirect(`/${slug}/setup`);
}

/** Accept an invitation, as the signed-in person. Joined → into the business. */
export async function acceptInviteAction(form: FormData) {
  const token = text(form, 'token');
  if (!INVITE_TOKEN.test(token)) redirect('/');
  const session = await requireSession(`/invite/${token}`);
  if (!session.account) redirect(`/invite/${token}`);
  const { outcome, slug } = await acceptInvitation(session.person.id, token);
  if ((outcome === 'joined' || outcome === 'already_member') && slug) {
    revalidatePath('/', 'layout');
    redirect(`/${slug}${outcome === 'joined' ? '?joined=1' : ''}`);
  }
  redirect(`/invite/${token}?outcome=${outcome}`);
}
