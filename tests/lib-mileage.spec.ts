import { expect, test } from '@playwright/test';
import {
  addFix,
  clock,
  distance,
  EMPTY_MILEAGE,
  frequentRoutes,
  haversine,
  mileageCsv,
  mileageStoreSchema,
  newTrip,
  parseDistance,
  recentPlaces,
  removeTrip,
  saveTrip,
  startDrive,
  thin,
  totals,
  tripFromDrive,
  tripsByMonth,
  tripTitle,
  type Drive,
} from '@/lib/tools/mileage';

/* Mileage: GPS that doesn't count standing still, and a log that adds itself up. */

const T0 = 1_750_000_000_000;
const TODAY = '2026-09-28';

/** A drive north along a street: `count` fixes, `meters` apart, `seconds` apart. */
function driveNorth(drive: Drive, count: number, meters: number, seconds = 5, accuracy = 8) {
  let current = drive;
  const start = current.last ?? { lat: 41.88, lng: -87.63, accuracy, t: T0 };
  for (let index = 1; index <= count; index += 1)
    current = addFix(current, {
      lat: start.lat + (meters * index) / 111_195,
      lng: start.lng,
      accuracy,
      t: start.t + index * seconds * 1000,
    });
  return current;
}

test('distance on the earth', () => {
  // One degree of latitude is about 111.2 km.
  expect(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2);
  expect(distance(1609.344)).toBe('1.0');
  expect(distance(20_000, 'km')).toBe('20.0');
  expect(clock(24 * 60 + 18)).toBe('00:24:18');
  expect(clock(3 * 3600 + 5)).toBe('03:00:05');
  expect(parseDistance('18.2')).toBeCloseTo(18.2 * 1609.344, 3);
  expect(parseDistance('18,2 mi')).toBeCloseTo(18.2 * 1609.344, 3);
  expect(parseDistance('0')).toBeNull();
  expect(parseDistance('abc')).toBeNull();
});

test('a drive adds up real movement', () => {
  let drive = addFix(startDrive(T0), { lat: 41.88, lng: -87.63, accuracy: 8, t: T0 });
  drive = driveNorth(drive, 100, 100); // 10 km at 72 km/h
  expect(drive.meters).toBeGreaterThan(9_900);
  expect(drive.meters).toBeLessThan(10_100);
  expect(drive.points.length).toBeGreaterThan(50);
});

test('standing still, vague fixes and glitches don’t count', () => {
  let drive = addFix(startDrive(T0), { lat: 41.88, lng: -87.63, accuracy: 10, t: T0 });
  // Jitter at a red light: a few meters back and forth.
  for (let index = 1; index <= 30; index += 1)
    drive = addFix(drive, {
      lat: 41.88 + (index % 2 ? 0.00003 : -0.00002),
      lng: -87.63,
      accuracy: 10,
      t: T0 + index * 1000,
    });
  expect(drive.meters).toBe(0);
  // A vague fix far away is set aside.
  drive = addFix(drive, { lat: 41.9, lng: -87.63, accuracy: 400, t: T0 + 40_000 });
  expect(drive.meters).toBe(0);
  // A jump of 50 km in a second is a glitch.
  drive = addFix(drive, { lat: 42.33, lng: -87.63, accuracy: 10, t: T0 + 41_000 });
  expect(drive.meters).toBe(0);
  expect(drive.fixes).toBe(33);
});

test('a finished drive becomes a trip with a thin route', () => {
  let drive = addFix(startDrive(T0), { lat: 41.88, lng: -87.63, accuracy: 8, t: T0 });
  drive = driveNorth(drive, 200, 60);
  const trip = tripFromDrive(drive, 'trip1', T0 + 1_000_000, TODAY, '08:15');
  expect(trip.source).toBe('gps');
  expect(trip.seconds).toBe(1000);
  expect(trip.route.length).toBeLessThanOrEqual(48);
  expect(trip.kind).toBe('business');
  expect(
    thin(
      [
        [0, 0],
        [1, 1],
        [2, 2],
      ],
      48,
    ),
  ).toHaveLength(3);
});

test('the log: months, totals, routes you drive again, CSV', () => {
  let store = EMPTY_MILEAGE;
  const mile = 1609.344;
  const add = (id: string, fields: Parameters<typeof newTrip>[3]) =>
    (store = saveTrip(store, newTrip(id, T0, fields?.date ?? TODAY, fields)));
  add('a', {
    date: '2026-09-28',
    from: 'Home',
    to: 'Home Depot',
    meters: 18.2 * mile,
    start: '08:10',
  });
  add('b', { date: '2026-09-27', from: 'Bolingbrook', to: 'Chicago', meters: 34.8 * mile });
  add('c', {
    date: '2026-09-20',
    from: 'Home',
    to: 'Home Depot',
    meters: 18.2 * mile,
    roundTrip: true,
  });
  add('d', { date: '2026-09-12', meters: 5 * mile, kind: 'personal', purpose: 'Groceries' });
  add('e', {
    date: '2026-08-30',
    from: 'Office',
    to: 'Supplier',
    meters: 12 * mile,
    kind: 'medical',
  });
  expect(store.trips.map((trip) => trip.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(mileageStoreSchema.safeParse(store).success).toBe(true);

  const months = tripsByMonth(store.trips, TODAY);
  expect(months.map((month) => [month.label, distance(month.meters)])).toEqual([
    ['September', '94.4'],
    ['August', '12.0'],
  ]);
  const september = totals(months[0].trips);
  expect(september.trips).toBe(4);
  expect(distance(september.byKind.business ?? 0)).toBe('89.4');

  expect(frequentRoutes(store.trips)[0]).toMatchObject({
    from: 'Home',
    to: 'Home Depot',
    times: 2,
  });
  expect(recentPlaces(store.trips)).toContain('Supplier');
  expect(tripTitle(store.trips[3])).toBe('Groceries');
  expect(tripTitle(store.trips[0])).toBe('Home → Home Depot');

  const sheet = mileageCsv(store.trips).split('\r\n');
  expect(sheet[0]).toBe(
    'Date,Start time,From,To,Miles,Round trip,Category,Purpose,Client or project,Notes',
  );
  expect(sheet[1]).toBe('2026-09-28,08:10,Home,Home Depot,18.2,,Business,,,');
  expect(sheet[3]).toContain('36.4,Yes,Business');

  store = removeTrip(store, 'b');
  expect(store.trips).toHaveLength(4);
});
