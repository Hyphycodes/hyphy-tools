import 'server-only';
import { RuleError } from '@/lib/data/repository';
import { asPerson } from '@/lib/data/supabase/db';
import { translate } from '@/lib/data/supabase/source';
import type { Session } from '@/lib/identity/types';
import {
  brandFor,
  businessTypes,
  presetLabels,
  presetModules,
  type BusinessType,
} from '@/lib/platform/business-types';

export const DEMO_BUSINESS =
  'Creating a business needs a real account. In Demo Mode, explore ABC Construction, Hyphy LLC and Salt & Ember.';

export type NewBusiness = {
  name: string;
  type: BusinessType;
  /** The Space address. Taken → a free variant, unless `exact`. */
  address: string;
  exact: boolean;
  /** One per form: a retried submit returns the same Business. */
  requestKey: string;
};

/**
 * Creating a Business: one database transaction (`create_business`) makes the Space with its
 * type's starting words and tools, and the creator's owner membership. It runs as the verified
 * person; nothing about ownership comes from the form.
 */
export async function createBusiness(session: Session, input: NewBusiness) {
  if (session.source !== 'supabase' || !session.account) throw new RuleError(DEMO_BUSINESS);
  const preset = businessTypes[input.type];
  const [row] = await asPerson(
    session.person.id,
    (tx) => tx`
      select * from public.create_business(
        ${input.name}, ${input.address}, ${input.type}, ${input.exact}, ${input.requestKey}::uuid,
        ${presetModules(input.type)}::text[], ${preset.workStyle},
        ${tx.json(presetLabels(input.type) ?? {})}, ${tx.json(brandFor(input.name))},
        ${preset.label})`,
  ).catch(translate);
  return {
    spaceId: String(row.space_id),
    slug: String(row.space_slug),
    created: Boolean(row.created),
  };
}
