import 'server-only';
import { RuleError } from '@/lib/data/repository';
import { asPerson } from '@/lib/data/supabase/db';
import { asJson, translate } from '@/lib/data/supabase/source';
import type { Session } from '@/lib/identity/types';
import {
  brandFor,
  businessTypes,
  presetFields,
  presetLabels,
  presetModules,
  type BusinessType,
} from '@/lib/platform/business-types';
import { fieldColumns } from '@/lib/data/supabase/rows';

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
 * type's starting words and tools, and the creator's owner membership; in the same transaction,
 * as the new owner, it gets its kind's starting rules and suggested fields (all optional — a
 * starting point, not a requirement). It runs as the verified person; nothing about ownership
 * comes from the form. A retried request finds the same Business and adds nothing twice.
 */
export async function createBusiness(session: Session, input: NewBusiness) {
  if (session.source !== 'supabase' || !session.account) throw new RuleError(DEMO_BUSINESS);
  const preset = businessTypes[input.type];
  const me = session.person.id;
  const [row] = await asPerson(me, async (tx) => {
    const [created] = await tx`
      select * from public.create_business(
        ${input.name}, ${input.address}, ${input.type}, ${input.exact}, ${input.requestKey}::uuid,
        ${presetModules(input.type)}::text[], ${preset.workStyle},
        ${tx.json(presetLabels(input.type) ?? {})}, ${tx.json(brandFor(input.name))},
        ${preset.label})`;
    if (created.created) {
      const spaceId = String(created.space_id);
      if (Object.keys(preset.settings).length)
        await tx`insert into space_settings (space_id, settings)
                 values (${spaceId}, ${tx.json(preset.settings as never)})`;
      for (const field of presetFields(input.type, spaceId))
        await tx`insert into custom_fields ${tx(
          asJson(tx, fieldColumns({ ...field, createdBy: me })) as Record<string, never>,
        )}`;
    }
    return [created];
  }).catch(translate);
  return {
    spaceId: String(row.space_id),
    slug: String(row.space_slug),
    created: Boolean(row.created),
  };
}
