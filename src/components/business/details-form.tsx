'use client';
import { useState } from 'react';
import { updateBusiness } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { SpaceMark } from '@/components/ui/marks';
import { useTeamAction } from '@/components/team/use-team-action';
import { BASE_PATH } from '@/lib/base-path';
import { BUSINESS_TYPES, businessTypes } from '@/lib/platform/business-types';
import type { Space } from '@/lib/platform/types';

/**
 * A business's own details: its name, what kind it is and what it calls its projects. The address
 * stays fixed so every link and bookmark keeps working; records refer to the Space by id, so a new
 * name shows everywhere at once.
 */
export function BusinessDetailsForm({
  space,
  words,
  host,
}: {
  space: Pick<Space, 'id' | 'slug' | 'name' | 'kind' | 'brand' | 'businessType'>;
  words: { singular: string; plural: string };
  host: string;
}) {
  const { pending, run } = useTeamAction();
  const [name, setName] = useState(space.name);
  const [type, setType] = useState<string>(space.businessType ?? '');
  const [singular, setSingular] = useState(words.singular);
  const [plural, setPlural] = useState(words.plural);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateBusiness(space.slug, { name, type, singular, plural }));
      }}
      className="grid gap-5 px-4 pb-5"
    >
      <div className="flex items-center gap-4">
        <SpaceMark space={{ ...space, name }} size="xl" />
        <div className="min-w-0 text-[13px] leading-snug text-muted">
          <p className="font-medium text-ink-2">Logo</p>
          <p>Your mark uses the business’s first letter. Logo uploads arrive with file storage.</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business name" htmlFor="business-name">
          <Input
            id="business-name"
            value={name}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Kind of business" htmlFor="business-type">
          <Select id="business-type" value={type} onChange={(event) => setType(event.target.value)}>
            {!type && <option value="">Not set</option>}
            {BUSINESS_TYPES.map((id) => (
              <option key={id} value={id}>
                {businessTypes[id].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="What you call one project"
          htmlFor="word-one"
          hint="e.g. Job, Event, Property"
        >
          <Input
            id="word-one"
            value={singular}
            maxLength={30}
            onChange={(event) => setSingular(event.target.value)}
          />
        </Field>
        <Field label="…and several" htmlFor="word-many">
          <Input
            id="word-many"
            value={plural}
            maxLength={30}
            onChange={(event) => setPlural(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-1.5">
        <p className="text-[13.5px] font-medium text-ink-2">Address</p>
        <p className="truncate rounded-[11px] bg-subtle px-3.5 py-3 text-[14px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] lg:py-2.5">
          {host}
          {BASE_PATH}/<span className="text-ink">{space.slug}</span>
        </p>
        <p className="text-[12.5px] leading-snug text-muted">
          Addresses stay the same so links and bookmarks keep working.
        </p>
      </div>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}
