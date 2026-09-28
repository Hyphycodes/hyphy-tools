import * as z from 'zod/mini';
import { csv } from '@/lib/files/download';
import { idSchema, stampSchema } from './claims';

/*
 * Mileage: trips for work, kept like a spreadsheet you never have to open. A drive is measured
 * from the phone's location while it's on screen (`addFix` adds up the distance between fixes,
 * ignoring GPS jitter and impossible jumps); a trip can also be typed in, or repeated from a
 * route driven before. Trips live in this browser and keep this shape when accounts arrive.
 * Distances are stored in meters. Pure and tested (tests/lib-mileage.spec.ts).
 */

export const TRIP_KINDS = ['business', 'personal', 'medical', 'charity', 'other'] as const;
export type TripKind = (typeof TRIP_KINDS)[number];
export const KIND_NAMES: Record<TripKind, string> = {
  business: 'Business',
  personal: 'Personal',
  medical: 'Medical',
  charity: 'Charity',
  other: 'Other',
};

export const MAX_TRIPS = 3000;
export const METERS_PER_MILE = 1609.344;
/** Route points kept on a saved trip: enough to draw it, small enough to keep thousands. */
export const ROUTE_POINTS = 48;

const point = z.tuple([z.number(), z.number()]);

export const tripSchema = z.object({
  id: idSchema,
  date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  /** When it started, "HH:MM", or ''. */
  start: z.string().check(z.regex(/^(\d{2}:\d{2})?$/)),
  from: z.string().check(z.maxLength(60)),
  to: z.string().check(z.maxLength(60)),
  meters: z.number().check(z.minimum(0), z.maximum(5_000_000)),
  kind: z.enum(TRIP_KINDS),
  purpose: z.string().check(z.maxLength(80)),
  /** A client, project or job. */
  tag: z.string().check(z.maxLength(60)),
  note: z.string().check(z.maxLength(300)),
  source: z.enum(['gps', 'typed']),
  /** Driving time, when it was measured. */
  seconds: z.int().check(z.minimum(0), z.maximum(7 * 86_400)),
  roundTrip: z.boolean(),
  route: z.array(point).check(z.maxLength(ROUTE_POINTS)),
  created: stampSchema,
  updated: stampSchema,
});
export type Trip = z.infer<typeof tripSchema>;

const fixSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  t: stampSchema,
});
export type Fix = z.infer<typeof fixSchema>;

export const driveSchema = z.object({
  startedAt: stampSchema,
  meters: z.number().check(z.minimum(0)),
  last: z.nullable(fixSchema),
  /** The path so far, thinned. */
  points: z.array(point).check(z.maxLength(4000)),
  /** Fixes seen, including ones set aside: tells "no GPS" from "not moving". */
  fixes: z.int().check(z.minimum(0)),
});
export type Drive = z.infer<typeof driveSchema>;

export const mileageStoreSchema = z.object({
  v: z.literal(1),
  unit: z.enum(['mi', 'km']),
  trips: z.array(tripSchema).check(z.maxLength(MAX_TRIPS)),
  drive: z.nullable(driveSchema),
});
export type MileageStore = z.infer<typeof mileageStoreSchema>;
export const EMPTY_MILEAGE: MileageStore = { v: 1, unit: 'mi', trips: [], drive: null };

/* ---------------- distance ---------------- */

/** Meters between two points on the earth. */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function startDrive(now: number): Drive {
  return { startedAt: now, meters: 0, last: null, points: [], fixes: 0 };
}

/** Fixes this vague are set aside (meters). */
export const MAX_ACCURACY = 65;
/** Faster than this between two fixes is a glitch, not a car (meters a second, ~180 mph). */
export const MAX_SPEED = 80;

/**
 * A location fix arrives. Vague fixes are set aside; movement smaller than the fix's own
 * uncertainty is jitter (standing still at a light), not distance; impossible jumps are glitches.
 */
export function addFix(drive: Drive, fix: Fix): Drive {
  const next = { ...drive, fixes: drive.fixes + 1 };
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || fix.accuracy > MAX_ACCURACY)
    return next;
  const here: [number, number] = [round(fix.lat), round(fix.lng)];
  if (!drive.last) return { ...next, last: fix, points: [here] };
  const step = haversine(drive.last, fix);
  const floor = Math.max(8, (drive.last.accuracy + fix.accuracy) * 0.35);
  if (step < floor) return next;
  const seconds = Math.max(1, (fix.t - drive.last.t) / 1000);
  if (step / seconds > MAX_SPEED) return next;
  const lastPoint = drive.points.at(-1);
  const points =
    !lastPoint || haversine({ lat: lastPoint[0], lng: lastPoint[1] }, fix) >= 30
      ? [...drive.points, here].slice(-4000)
      : drive.points;
  return { ...next, meters: drive.meters + step, last: fix, points };
}

const round = (value: number) => Math.round(value * 1e5) / 1e5;

/** A path, thinned to at most `max` points (always keeping the ends). */
export function thin(points: [number, number][], max = ROUTE_POINTS): [number, number][] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => points[Math.round(index * step)]);
}

/* ---------------- units ---------------- */

export const toMiles = (meters: number) => meters / METERS_PER_MILE;
export const fromMiles = (miles: number) => miles * METERS_PER_MILE;

/** "12.4" (miles, or kilometers), one decimal. */
export function distance(meters: number, unit: 'mi' | 'km' = 'mi') {
  const value = unit === 'mi' ? toMiles(meters) : meters / 1000;
  return (Math.round(value * 10) / 10).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** "00:24:18" */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** A typed distance ("18.2", "18,2 mi") in meters, or null. */
export function parseDistance(text: string, unit: 'mi' | 'km' = 'mi') {
  const value = Number(text.replace(',', '.').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(value) || value <= 0 || value > 3000) return null;
  return unit === 'mi' ? fromMiles(value) : value * 1000;
}

/* ---------------- trips ---------------- */

export function newTrip(id: string, now: number, date: string, fields: Partial<Trip> = {}): Trip {
  return {
    id,
    date,
    start: '',
    from: '',
    to: '',
    meters: 0,
    kind: 'business',
    purpose: '',
    tag: '',
    note: '',
    source: 'typed',
    seconds: 0,
    roundTrip: false,
    route: [],
    created: now,
    updated: now,
    ...fields,
  };
}

/** The distance a trip counts for: doubled when it was there and back. */
export const tripMeters = (trip: Pick<Trip, 'meters' | 'roundTrip'>) =>
  trip.roundTrip ? trip.meters * 2 : trip.meters;

/** A finished drive → a trip (the kind and details come after). */
export function tripFromDrive(
  drive: Drive,
  id: string,
  now: number,
  date: string,
  start: string,
): Trip {
  return newTrip(id, now, date, {
    start,
    meters: drive.meters,
    source: 'gps',
    seconds: Math.round((now - drive.startedAt) / 1000),
    route: thin(drive.points),
  });
}

export function saveTrip(store: MileageStore, trip: Trip): MileageStore {
  const trips = [trip, ...store.trips.filter((entry) => entry.id !== trip.id)]
    .sort((a, b) =>
      a.date === b.date
        ? a.start === b.start
          ? b.created - a.created
          : a.start < b.start
            ? 1
            : -1
        : a.date < b.date
          ? 1
          : -1,
    )
    .slice(0, MAX_TRIPS);
  return { ...store, trips };
}

export function removeTrip(store: MileageStore, id: string): MileageStore {
  return { ...store, trips: store.trips.filter((trip) => trip.id !== id) };
}

/** "Home → Job site", or the purpose, or "Drive". */
export function tripTitle(trip: Pick<Trip, 'from' | 'to' | 'purpose'>) {
  if (trip.from && trip.to) return `${trip.from} → ${trip.to}`;
  return trip.to || trip.from || trip.purpose || 'Drive';
}

export type Route = {
  from: string;
  to: string;
  meters: number;
  kind: TripKind;
  purpose: string;
  tag: string;
  times: number;
};

/** Routes driven before, most driven first: one tap to log again. */
export function frequentRoutes(trips: Trip[], limit = 4): Route[] {
  const routes = new Map<string, Route & { last: number }>();
  for (const trip of trips) {
    if (!trip.from.trim() || !trip.to.trim()) continue;
    const key = `${trip.from.trim().toLowerCase()}→${trip.to.trim().toLowerCase()}`;
    const known = routes.get(key);
    if (known) {
      known.times += 1;
      if (trip.updated > known.last) Object.assign(known, { last: trip.updated });
      continue;
    }
    routes.set(key, {
      from: trip.from.trim(),
      to: trip.to.trim(),
      meters: trip.meters,
      kind: trip.kind,
      purpose: trip.purpose,
      tag: trip.tag,
      times: 1,
      last: trip.updated,
    });
  }
  return [...routes.values()]
    .sort((a, b) => b.times - a.times || b.last - a.last)
    .slice(0, limit)
    .map((route) => ({
      from: route.from,
      to: route.to,
      meters: route.meters,
      kind: route.kind,
      purpose: route.purpose,
      tag: route.tag,
      times: route.times,
    }));
}

/** Places typed before, for one-tap From and To. */
export function recentPlaces(trips: Trip[], limit = 6) {
  const places: string[] = [];
  for (const trip of [...trips].sort((a, b) => b.updated - a.updated)) {
    for (const place of [trip.from, trip.to]) {
      const clean = place.trim();
      if (clean && !places.some((known) => known.toLowerCase() === clean.toLowerCase()))
        places.push(clean);
    }
    if (places.length >= limit) break;
  }
  return places.slice(0, limit);
}

export function recentValues(trips: Trip[], field: 'purpose' | 'tag', limit = 5) {
  const values: string[] = [];
  for (const trip of [...trips].sort((a, b) => b.updated - a.updated)) {
    const clean = trip[field].trim();
    if (clean && !values.some((known) => known.toLowerCase() === clean.toLowerCase()))
      values.push(clean);
    if (values.length >= limit) break;
  }
  return values;
}

/* ---------------- adding up ---------------- */

export type MileagePeriod = 'month' | 'last' | 'year' | 'all';

const pad = (n: number) => String(n).padStart(2, '0');

export function inMonthPeriod(date: string, period: MileagePeriod, today: string) {
  if (period === 'all') return true;
  if (period === 'year') return date.slice(0, 4) === today.slice(0, 4);
  if (period === 'month') return date.slice(0, 7) === today.slice(0, 7);
  const [year, month] = today.split('-').map(Number);
  return date.slice(0, 7) === (month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`);
}

export function totals(trips: Trip[]) {
  let meters = 0;
  const byKind: Partial<Record<TripKind, number>> = {};
  for (const trip of trips) {
    const counted = tripMeters(trip);
    meters += counted;
    byKind[trip.kind] = (byKind[trip.kind] ?? 0) + counted;
  }
  return { meters, trips: trips.length, byKind };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function tripsByMonth(trips: Trip[], today = '') {
  const groups = new Map<string, Trip[]>();
  for (const trip of trips)
    groups.set(trip.date.slice(0, 7), [...(groups.get(trip.date.slice(0, 7)) ?? []), trip]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => {
      const [year, month] = key.split('-').map(Number);
      return {
        key,
        label:
          today.slice(0, 4) === String(year)
            ? MONTH_NAMES[month - 1]
            : `${MONTH_NAMES[month - 1]} ${year}`,
        meters: totals(list).meters,
        trips: list,
      };
    });
}

/** "Sep 28" */
export function dayLabel(date: string, today = '') {
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTH_NAMES[month - 1].slice(0, 3);
  return today.slice(0, 4) === String(year) ? `${name} ${day}` : `${name} ${day}, ${year}`;
}

/** The trips as a spreadsheet: one row a trip, miles counted (round trips doubled). */
export function mileageCsv(trips: Trip[], unit: 'mi' | 'km' = 'mi') {
  return csv([
    [
      'Date',
      'Start time',
      'From',
      'To',
      unit === 'mi' ? 'Miles' : 'Kilometers',
      'Round trip',
      'Category',
      'Purpose',
      'Client or project',
      'Notes',
    ],
    ...trips.map((trip) => [
      trip.date,
      trip.start,
      trip.from,
      trip.to,
      distance(tripMeters(trip), unit).replace(/,/g, ''),
      trip.roundTrip ? 'Yes' : '',
      KIND_NAMES[trip.kind],
      trip.purpose,
      trip.tag,
      trip.note,
    ]),
  ]);
}

/** Now as "HH:MM", where the person is. */
export function timeNow(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
