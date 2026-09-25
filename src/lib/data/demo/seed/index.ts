import { createClock } from '../clock';
import { abc } from './abc';
import { memberships, people, pins, spaces } from './core';
import { hyphy } from './hyphy';
import { personal } from './personal';
import { saltAndEmber } from './salt-and-ember';
import type { Dataset, SeedSlice } from './types';

export { people, perspectives, personalSpaceId } from './core';
export type { Perspective } from './core';
export type { Dataset, TableName } from './types';

const slices: ((clock: ReturnType<typeof createClock>) => SeedSlice)[] = [
  personal,
  hyphy,
  abc,
  saltAndEmber,
];

let cached: { minute: number; data: Dataset } | null = null;

/**
 * The seeded world, anchored to the current minute so "3h ago" stays true. Built fresh each
 * minute and never mutated — Demo Mode layers the visitor's own changes on top (see journal.ts).
 */
export function seed(now = Date.now()): Dataset {
  const minute = Math.floor(now / 60000);
  if (cached?.minute === minute) return cached.data;
  const clock = createClock(minute * 60000);
  const data: Dataset = {
    people,
    spaces: spaces(clock),
    memberships: memberships(clock),
    projects: [],
    vehicles: [],
    receipts: [],
    mileage: [],
    files: [],
    qrCodes: [],
    linkPages: [],
    activity: [],
    inbox: [],
    pins: pins(),
  };
  for (const slice of slices.map((make) => make(clock))) {
    for (const [table, rows] of Object.entries(slice) as [keyof SeedSlice, unknown[]][]) {
      (data[table] as unknown[]).push(...rows);
    }
  }
  cached = { minute, data };
  return data;
}
