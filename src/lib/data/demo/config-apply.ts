import type { SpaceSettings } from '@/lib/platform/business-settings';
import { recordTypes } from '@/lib/platform/custom-fields';
import type { ActivityEvent, FieldDefinition, Space } from '@/lib/platform/types';
import type { Dataset } from './seed';

/*
 * The pure half of Demo Mode's business setup: applying a visitor's configuration (their words,
 * tools, rules and fields) to the seeded world. No cookies, no Next.js — unit-tested directly.
 *
 * Setup is kept apart from the record journal on purpose: the journal drops its oldest changes
 * when it fills up, and a business's setup must never quietly revert because someone logged a
 * lot of trips afterwards. Reset clears both.
 */

/** What a visitor may change about a Space. */
export type SpaceChanges = Partial<
  Pick<
    Space,
    | 'name'
    | 'descriptor'
    | 'businessType'
    | 'workStyle'
    | 'labels'
    | 'setupDoneAt'
    | 'brand'
    | 'mileageRate'
    | 'modules'
    | 'settings'
  >
>;

export type DemoConfig = {
  /** Changes to each Space, by Space id. */
  spaces: Record<string, SpaceChanges>;
  /** Every field of a Space, once any of its fields changed. */
  fields: Record<string, FieldDefinition[]>;
  /** Setup activity ("Dana added required receipt field “Cost Code”"), newest last. */
  log: ActivityEvent[];
  /** How many setup changes were saved, for the Reset count. */
  changes: number;
};

export const emptyConfig = (): DemoConfig => ({ spaces: {}, fields: {}, log: [], changes: 0 });

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isField = (value: unknown): value is FieldDefinition =>
  isObject(value) &&
  ['id', 'spaceId', 'appliesTo', 'label', 'type'].every((key) => typeof value[key] === 'string');
const isEvent = (value: unknown): value is ActivityEvent =>
  isObject(value) &&
  typeof value.id === 'string' &&
  typeof value.at === 'string' &&
  isObject(value.object);

/**
 * A setup read back from the browser, keeping only entries of the right shape. The cookie is
 * written by the server, but a stale or hand-edited one must never break a page.
 */
export function cleanConfig(parsed: unknown): DemoConfig {
  if (!isObject(parsed)) return emptyConfig();
  const entries = (value: unknown) => (isObject(value) ? Object.entries(value) : []);
  return {
    spaces: Object.fromEntries(
      entries(parsed.spaces).filter(([, changes]) => isObject(changes)),
    ) as DemoConfig['spaces'],
    fields: Object.fromEntries(
      entries(parsed.fields)
        .filter(([, list]) => Array.isArray(list))
        .map(([spaceId, list]) => [spaceId, (list as unknown[]).filter(isField)]),
    ),
    log: Array.isArray(parsed.log) ? parsed.log.filter(isEvent) : [],
    changes: Number.isInteger(parsed.changes) ? (parsed.changes as number) : 0,
  };
}

/** How many setup lines Demo Mode keeps; older ones fall away first. */
export const LOG_LIMIT = 12;

export function applyConfig(base: Dataset, config: DemoConfig): Dataset {
  const spaceIds = Object.keys(config.spaces);
  const fieldSpaces = Object.keys(config.fields);
  if (!spaceIds.length && !fieldSpaces.length && !config.log.length) return base;
  return {
    ...base,
    spaces: base.spaces.map((space) =>
      config.spaces[space.id] ? { ...space, ...config.spaces[space.id] } : space,
    ),
    fields: [
      ...base.fields.filter((field) => !fieldSpaces.includes(field.spaceId)),
      ...fieldSpaces.flatMap((spaceId) => config.fields[spaceId]),
    ],
    activity: [...base.activity, ...config.log],
  };
}

/* ---------- setup activity: the same lines the database's triggers write ---------- */

type Line = Pick<ActivityEvent, 'verb' | 'detail'> & {
  label: string;
  /** Tools are a change to the Space itself, as the database has always written them. */
  object?: 'space';
};

export function fieldLine(
  before: FieldDefinition | undefined,
  after: FieldDefinition | undefined,
): Line | null {
  const field = after ?? before;
  if (!field) return null;
  const noun = recordTypes[field.appliesTo].noun;
  const name = `${noun} field “${field.label}”`;
  if (!before && after)
    return { verb: 'added', label: `${after.required ? 'required ' : ''}${name}` };
  if (!before || !after) return null;
  if (Boolean(before.archivedAt) !== Boolean(after.archivedAt))
    return after.archivedAt ? { verb: 'archived', label: name } : { verb: 'added', label: name };
  if (Boolean(before.required) !== Boolean(after.required))
    return {
      verb: 'changed',
      label: name,
      detail: after.required ? 'Now required' : 'Now optional',
    };
  return null;
}

const money = (rate: number) => `$${rate.toFixed(2)} a mile`;

/** The lines a change to a Space's setup writes. Tools, words, rules, the rate — not the accent. */
export function spaceLines(before: Space, changes: SpaceChanges): Line[] {
  const lines: Line[] = [];
  if (changes.modules && changes.modules.join() !== before.modules.join())
    lines.push({ verb: 'updated', label: 'the tools in this Space', object: 'space' });
  if (
    changes.mileageRate !== undefined &&
    changes.mileageRate !== before.mileageRate &&
    changes.mileageRate !== null
  )
    lines.push({ verb: 'changed', label: 'the mileage rate', detail: money(changes.mileageRate) });
  if (changes.labels && JSON.stringify(changes.labels) !== JSON.stringify(before.labels ?? {}))
    lines.push({ verb: 'changed', label: 'the words this business uses' });
  if (changes.businessType && changes.businessType !== before.businessType)
    lines.push({ verb: 'changed', label: 'the kind of business' });
  if (changes.settings) lines.push(...settingsLines(before.settings, changes.settings));
  return lines;
}

function settingsLines(before: SpaceSettings | undefined, after: SpaceSettings): Line[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  const lines: Line[] = [];
  if (!same(before?.receipts, after.receipts))
    lines.push({ verb: 'changed', label: 'the receipt rules' });
  if (!same(before?.mileage, after.mileage))
    lines.push({ verb: 'changed', label: 'the mileage rules' });
  if (!same(before?.approvals, after.approvals))
    lines.push({ verb: 'changed', label: 'who approves' });
  return lines;
}

export function lineEvent(
  line: Line,
  spaceId: string,
  actorId: string,
  at: string,
  index: number,
): ActivityEvent {
  return {
    id: `ac_setup_${spaceId}_${Date.parse(at).toString(36)}_${index}`,
    spaceId,
    actorId,
    verb: line.verb,
    object: { type: line.object ?? 'setting', id: spaceId, label: line.label },
    ...(line.detail ? { detail: line.detail } : {}),
    at,
  };
}
