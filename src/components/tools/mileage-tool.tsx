'use client';
import { NextSteps } from './next-step';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { downloadText } from '@/lib/files/download';
import { newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  addFix,
  clock,
  dayLabel,
  distance,
  EMPTY_MILEAGE,
  frequentRoutes,
  inMonthPeriod,
  KIND_NAMES,
  mileageCsv,
  mileageStoreSchema,
  newTrip,
  parseDistance,
  recentPlaces,
  recentValues,
  removeTrip,
  saveTrip,
  startDrive,
  timeNow,
  totals,
  TRIP_KINDS,
  tripFromDrive,
  tripMeters,
  tripsByMonth,
  tripTitle,
  type MileagePeriod,
  type MileageStore,
  type Route,
  type Trip,
  type TripKind,
} from '@/lib/tools/mileage';
import { todayHere } from '@/lib/tools/plan';
import { CountUp, MoreOptions, Note, Surface, useReducedMotion } from './kit';
import { DEEP, GO, KIND_LOOK, KindChips, Picks, Road, RouteLine } from './mileage-parts';

/*
 * Mileage: Start drive, drive, Stop — the miles count up while the phone's location follows
 * the road (lib/tools/mileage), then one tap says what it was for. Trips can also be typed in or
 * repeated from a route driven before. The log adds itself up by month and exports as CSV.
 * Everything is kept in this browser; location never leaves the device.
 */

const noop = () => () => {};

/** A new trip for today, to type in (or repeat a route). */
function blankTrip(today: string, fields: Partial<Trip> = {}) {
  return newTrip(newId(10), Date.now(), today, fields);
}
const PERIODS: { value: MileagePeriod; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All' },
];

type GpsState = 'waiting' | 'good' | 'weak' | 'denied' | 'unavailable';

/** A second-by-second clock while something is running. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

/** Keeps the screen on while driving, where the browser allows it. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const take = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => (lock = sentinel))
        .catch(() => {});
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, [on]);
}

export function MileageTool() {
  const toast = useToast();
  const today = useSyncExternalStore(noop, todayHere, () => '');
  const [store, setStore, { loaded }] = useLocalState<MileageStore>(
    'hyphy.mileage.v1',
    mileageStoreSchema,
    EMPTY_MILEAGE,
  );
  const [gps, setGps] = useState<GpsState>('waiting');
  const [finished, setFinished] = useState<Trip | null>(null);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  /** A drive just logged: the next thing is often its receipt. */
  const [logged, setLogged] = useState(false);
  const [period, setPeriod] = useState<MileagePeriod>('month');
  const [kind, setKind] = useState<TripKind | null>(null);
  const drive = store.drive;
  const driving = Boolean(drive);
  const now = useNow(driving);
  useWakeLock(driving);

  // While driving, the phone's location follows the road. A reload picks the drive back up.
  useEffect(() => {
    if (!driving) return;
    if (!('geolocation' in navigator)) {
      // No location on this device at all: the drive is timed, miles come at the end.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGps('unavailable');
      return;
    }
    setGps('waiting');
    const watch = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setGps(accuracy <= 30 ? 'good' : 'weak');
        setStore((current) =>
          current.drive
            ? {
                ...current,
                drive: addFix(current.drive, {
                  lat: latitude,
                  lng: longitude,
                  accuracy,
                  // When it arrived: some browsers repeat a stale timestamp.
                  t: Date.now(),
                }),
              }
            : current,
        );
      },
      (error) => setGps(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [driving, setStore]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(null), 5000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const start = () => {
    setLogged(false);
    setFinished(null);
    setStore((current) => ({ ...current, drive: startDrive(Date.now()) }));
  };

  const stop = () => {
    if (!drive) return;
    const ended = Date.now();
    const started = new Date(drive.startedAt);
    const trip = tripFromDrive(drive, newId(10), ended, todayHere(), timeNow(started));
    setFinished(trip);
    setStore((current) => ({ ...current, drive: null }));
  };

  const cancelDrive = () => {
    if (!window.confirm('Stop without saving this drive?')) return;
    setStore((current) => ({ ...current, drive: null }));
  };

  const keep = (trip: Trip) => {
    setStore((current) => saveTrip(current, { ...trip, updated: Date.now() }));
    setJustSaved(trip.id);
    setLogged(true);
    setFinished(null);
    setEditing(null);
    if (!inMonthPeriod(trip.date, period, today)) setPeriod('all');
  };

  const remove = (trip: Trip) => {
    if (
      !window.confirm(`Delete this ${distance(tripMeters(trip), store.unit)} ${store.unit} trip?`)
    )
      return;
    setStore((current) => removeTrip(current, trip.id));
    setEditing(null);
    toast({ title: 'Trip deleted' });
  };

  const repeat = (route: Route) =>
    setEditing(
      blankTrip(today, {
        from: route.from,
        to: route.to,
        meters: route.meters,
        kind: route.kind,
        purpose: route.purpose,
        tag: route.tag,
      }),
    );

  if (!loaded || !today)
    return <div aria-busy="true" className="skeleton h-[480px] !rounded-[28px]" />;

  if (drive)
    return (
      <Driving
        miles={distance(drive.meters, store.unit)}
        unit={store.unit}
        seconds={(now - drive.startedAt) / 1000}
        points={drive.points}
        gps={gps}
        onStop={stop}
        onCancel={cancelDrive}
      />
    );

  if (finished)
    return (
      <Finish
        trip={finished}
        unit={store.unit}
        trips={store.trips}
        gpsFailed={gps === 'denied' || gps === 'unavailable'}
        onSave={keep}
        onDiscard={() => {
          if (window.confirm('Throw this drive away?')) setFinished(null);
        }}
      />
    );

  const month = store.trips.filter((trip) => inMonthPeriod(trip.date, 'month', today));
  const monthTotals = totals(month);
  const routes = frequentRoutes(store.trips);
  const shown = store.trips.filter(
    (trip) => inMonthPeriod(trip.date, period, today) && (!kind || trip.kind === kind),
  );
  const shownTotals = totals(shown);
  const months = tripsByMonth(shown, today);

  return (
    <div
      className={cn(
        'grid gap-5',
        store.trips.length
          ? 'lg:grid-cols-[minmax(320px,.85fr)_minmax(0,1.25fr)] lg:items-start'
          : 'mx-auto w-full max-w-[640px]',
      )}
    >
      <div className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        <Road className="grid justify-items-center gap-6 px-5 pt-7 pb-6 text-center sm:px-8 sm:pt-9">
          {store.trips.length > 0 ? (
            <div className="grid w-full grid-cols-2 gap-3 text-left">
              <div>
                <p className="text-[12px] font-bold tracking-[.14em] text-white/60 uppercase">
                  This month
                </p>
                <p
                  className="mt-1 font-display text-[40px] leading-none font-extrabold tracking-[-0.04em]"
                  style={{ fontVariationSettings: "'wdth' 110" }}
                >
                  <CountUp
                    value={monthTotals.meters}
                    format={(value) => distance(value, store.unit)}
                    mono={false}
                  />
                  <span className="ml-1 text-[18px] font-bold text-white/60">{store.unit}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[12px] font-bold tracking-[.14em] text-white/60 uppercase">
                  Trips
                </p>
                <p className="mt-1 font-display text-[40px] leading-none font-extrabold tracking-[-0.04em]">
                  {monthTotals.trips}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <p
                className="font-display text-[34px] leading-[1] font-extrabold tracking-[-0.035em] sm:text-[42px]"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                No drives yet.
              </p>
              <p className="mx-auto max-w-[32ch] text-[15.5px] text-white/70">
                Tap start when you pull out. Tap stop when you arrive. That’s the log.
              </p>
            </div>
          )}
          <StartButton onStart={start} />
          <button
            type="button"
            onClick={() => setEditing(blankTrip(today))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-medium text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Icon name="plus" size={15} /> Add a trip by hand
          </button>
        </Road>
        {logged && (
          <NextSteps
            from="mileage"
            title="Trip saved"
            steps={[{ tool: 'receipts', label: 'Add a receipt' }]}
            className="px-1"
          />
        )}

        {routes.length > 0 && (
          <Surface className="grid gap-2">
            <p className="label">Drive it again</p>
            <ul className="grid gap-1.5">
              {routes.map((route) => (
                <li key={`${route.from}→${route.to}`}>
                  <button
                    type="button"
                    onClick={() => repeat(route)}
                    className="flex min-h-13 w-full items-center gap-3 rounded-[14px] bg-subtle px-3 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-ink/[.05]"
                  >
                    <Icon name="route" size={18} className="shrink-0 text-[var(--accent-ink)]" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                      {route.from} → {route.to}
                    </span>
                    <span className="mono-num shrink-0 text-[14px] text-muted">
                      {distance(route.meters, store.unit)} {store.unit}
                    </span>
                    <Icon name="plus" size={16} className="shrink-0 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </Surface>
        )}

        {!store.trips.length && (
          <Note icon="lock">
            Location is used on this phone only, while this page is open. Keep the screen on: phones
            pause location for pages in the background.
          </Note>
        )}
      </div>

      {store.trips.length > 0 && (
        <section aria-labelledby="mileage-history" className="grid min-w-0 gap-4">
          <h2 id="mileage-history" className="sr-only">
            Your trips
          </h2>
          <div className="grid gap-2">
            <div role="radiogroup" aria-label="When" className="flex flex-wrap gap-1.5">
              {PERIODS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={period === entry.value}
                  onClick={() => setPeriod(entry.value)}
                  className={cn(
                    'min-h-10 rounded-full px-3.5 text-[14px] font-medium',
                    period === entry.value
                      ? 'bg-ink text-on-ink'
                      : 'bg-well text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div
              role="radiogroup"
              aria-label="What for"
              className="scroller -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!kind}
                onClick={() => setKind(null)}
                className={cn(
                  'min-h-10 shrink-0 rounded-full px-3.5 text-[13.5px] font-medium',
                  !kind ? 'bg-signal-soft text-[var(--accent-ink)]' : 'bg-well text-ink-2',
                )}
              >
                Every trip
              </button>
              {TRIP_KINDS.filter((entry) => store.trips.some((trip) => trip.kind === entry)).map(
                (entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={kind === entry}
                    onClick={() => setKind(kind === entry ? null : entry)}
                    className={cn(
                      'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-2 text-[13.5px] font-medium',
                      kind === entry
                        ? 'bg-signal-soft text-[var(--accent-ink)]'
                        : 'bg-well text-ink-2',
                    )}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: KIND_LOOK[entry].color }}
                    />
                    {KIND_NAMES[entry]}
                  </button>
                ),
              )}
            </div>
          </div>

          {months.length ? (
            months.map((group) => (
              <section key={group.key} aria-label={group.label} className="grid gap-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h3 className="font-display text-[15px] font-extrabold tracking-[.1em] text-ink uppercase">
                    {group.label}
                  </h3>
                  <p className="mono-num text-[15px] font-semibold text-ink">
                    {distance(group.meters, store.unit)} {store.unit}
                  </p>
                </div>
                <ul className="grid overflow-hidden rounded-[20px] bg-surface shadow-card">
                  {group.trips.map((trip) => (
                    <li key={trip.id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        onClick={() => setEditing(trip)}
                        className={cn(
                          'flex min-h-[68px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink/[.03]',
                          justSaved === trip.id && 'fx-settle bg-signal-soft',
                        )}
                      >
                        <span className="w-12 shrink-0 text-[12.5px] leading-tight font-semibold text-muted">
                          {dayLabel(trip.date, today)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15.5px] font-semibold text-ink">
                            {tripTitle(trip)}
                          </span>
                          <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
                            <span
                              className="size-2 shrink-0 rounded-full"
                              style={{ background: KIND_LOOK[trip.kind].color }}
                            />
                            {KIND_NAMES[trip.kind]}
                            {trip.roundTrip && ' · round trip'}
                            {trip.tag && ` · ${trip.tag}`}
                            {trip.source === 'gps' && (
                              <Icon
                                name="navigation"
                                size={11}
                                className="text-faint"
                                label="Measured by GPS"
                              />
                            )}
                          </span>
                        </span>
                        <span className="mono-num shrink-0 text-[16px] font-semibold text-ink">
                          {distance(tripMeters(trip), store.unit)}
                          <span className="ml-0.5 text-[12px] text-muted">{store.unit}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          ) : (
            <Surface className="grid justify-items-center gap-2 py-10 text-center">
              <Icon name="route" size={24} className="text-faint" />
              <p className="text-[16px] font-semibold text-ink">No trips here</p>
              <button
                type="button"
                onClick={() => {
                  setPeriod('all');
                  setKind(null);
                }}
                className="mt-1 rounded-full bg-well px-4 py-2.5 text-[14px] font-medium text-ink-2"
              >
                Show every trip
              </button>
            </Surface>
          )}

          {shown.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <p className="text-[14px] text-muted">
                {shown.length} {shown.length === 1 ? 'trip' : 'trips'} ·{' '}
                <span className="font-semibold text-ink">
                  {distance(shownTotals.meters, store.unit)} {store.unit}
                </span>
                {shownTotals.byKind.business && shownTotals.byKind.business !== shownTotals.meters
                  ? ` · ${distance(shownTotals.byKind.business, store.unit)} business`
                  : ''}
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadText(
                    mileageCsv(shown, store.unit),
                    `mileage-${period === 'all' ? 'all' : today.slice(0, period === 'year' ? 4 : 7)}.csv`,
                    'text/csv',
                  )
                }
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink"
              >
                <Icon name="download" size={15} /> Export CSV
              </button>
            </div>
          )}
          <div className="flex justify-end px-1">
            <button
              type="button"
              onClick={() =>
                setStore((current) => ({ ...current, unit: current.unit === 'mi' ? 'km' : 'mi' }))
              }
              className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] text-muted hover:bg-ink/5 hover:text-ink"
            >
              Show {store.unit === 'mi' ? 'kilometers' : 'miles'}
            </button>
          </div>
        </section>
      )}

      <TripSheet
        key={editing?.id ?? 'none'}
        trip={editing}
        isNew={Boolean(editing && !store.trips.some((trip) => trip.id === editing.id))}
        unit={store.unit}
        today={today}
        trips={store.trips}
        onSave={keep}
        onDelete={remove}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

/* ---------------- start and drive ---------------- */

function StartButton({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="group relative grid size-[176px] place-items-center rounded-full text-[#0f1f3d] transition-transform active:scale-[.96] sm:size-[196px]"
      style={{
        background: `radial-gradient(circle at 35% 30%, #7ff0b0, ${GO} 55%, #1fa860)`,
        boxShadow: `0 0 0 10px rgb(47 208 122 / .14), 0 0 0 22px rgb(47 208 122 / .07), 0 24px 50px -18px ${GO}`,
      }}
    >
      <span className="grid justify-items-center gap-1.5">
        <Icon name="navigation" size={34} strokeWidth={2.2} />
        <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">
          Start drive
        </span>
      </span>
    </button>
  );
}

const GPS_WORDS: Record<GpsState, string> = {
  waiting: 'Finding you…',
  good: 'GPS is good',
  weak: 'GPS is weak',
  denied: 'Location is off for this site: add the miles when you stop.',
  unavailable: 'No location on this device: add the miles when you stop.',
};

function Driving({
  miles,
  unit,
  seconds,
  points,
  gps,
  onStop,
  onCancel,
}: {
  miles: string;
  unit: 'mi' | 'km';
  seconds: number;
  points: [number, number][];
  gps: GpsState;
  onStop: () => void;
  onCancel: () => void;
}) {
  const off = gps === 'denied' || gps === 'unavailable';
  return (
    <div className="mx-auto grid w-full max-w-[560px] gap-4">
      <Road className="grid justify-items-center gap-5 px-5 pt-8 pb-7 text-center">
        <p className="inline-flex items-center gap-2 text-[14px] font-bold tracking-[.14em] text-white/75 uppercase">
          <span className="size-2.5 rounded-full" style={{ background: off ? '#ffc66b' : GO }} />
          Driving…
        </p>
        <p
          className="font-display text-[88px] leading-[.9] font-extrabold tracking-[-0.05em] tabular-nums sm:text-[112px]"
          style={{ fontVariationSettings: "'wdth' 112" }}
          aria-live="polite"
          aria-label={`${miles} ${unit === 'mi' ? 'miles' : 'kilometers'}`}
        >
          {miles}
          <span className="ml-2 text-[28px] font-bold tracking-normal text-white/60">{unit}</span>
        </p>
        <p className="mono-num text-[22px] font-semibold text-white/85" aria-label="Driving time">
          {clock(seconds)}
        </p>
        <RouteLine points={points} live className="max-w-[340px] opacity-90" />
        <p
          className={cn('text-[13.5px]', off ? 'max-w-[34ch] text-[#ffc66b]' : 'text-white/60')}
          role="status"
        >
          {GPS_WORDS[gps]}
        </p>
        <button
          type="button"
          onClick={onStop}
          className="grid size-[128px] place-items-center rounded-full bg-white text-[#0f1f3d] shadow-[0_0_0_10px_rgb(255_255_255/.1)] transition-transform active:scale-[.96]"
        >
          <span className="grid justify-items-center gap-1">
            <span className="size-7 rounded-[7px] bg-[#e5484d]" />
            <span className="text-[19px] font-extrabold">Stop</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center rounded-full px-4 text-[14px] text-white/60 hover:bg-white/10 hover:text-white"
        >
          Cancel this drive
        </button>
      </Road>
      <p className="text-center text-[13px] text-muted">
        Keep this page open with the screen on. Your location stays on this phone.
      </p>
    </div>
  );
}

/* ---------------- after a drive ---------------- */

function Finish({
  trip: initial,
  unit,
  trips,
  gpsFailed,
  onSave,
  onDiscard,
}: {
  trip: Trip;
  unit: 'mi' | 'km';
  trips: Trip[];
  gpsFailed: boolean;
  onSave: (trip: Trip) => void;
  onDiscard: () => void;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const [trip, setTrip] = useState(initial);
  const [typed, setTyped] = useState('');
  const set = (change: Partial<Trip>) => setTrip((current) => ({ ...current, ...change }));
  const noMiles = initial.meters < 50;
  const meters = noMiles ? (parseDistance(typed, unit) ?? 0) : trip.meters;
  const purposes = recentValues(trips, 'purpose');
  const places = recentPlaces(trips);
  const field =
    'h-12 w-full rounded-[14px] bg-white/10 px-4 text-[16px] text-white outline-none placeholder:text-white/40 focus:bg-white/15 focus:shadow-[0_0_0_2px_#2fd07a]';
  return (
    <div className="mx-auto grid w-full max-w-[600px] gap-4">
      <Road className="grid gap-5 px-5 pt-8 pb-6 sm:px-8">
        <div className="grid justify-items-center text-center">
          {noMiles ? (
            <div className="grid w-full gap-2">
              <p className="font-display text-[30px] font-extrabold tracking-[-0.03em]">
                How far was it?
              </p>
              <p className="text-[14px] text-white/65">
                {gpsFailed
                  ? 'Location was off, so type the miles.'
                  : 'The drive barely moved. Type the miles.'}
              </p>
              <label className="mx-auto flex h-16 w-[220px] items-center gap-2 rounded-[18px] bg-white/10 px-4">
                <span className="sr-only">Distance</span>
                <input
                  id={`${id}-miles`}
                  inputMode="decimal"
                  autoFocus
                  value={typed}
                  placeholder="0.0"
                  onChange={(event) => setTyped(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-right font-display text-[32px] font-extrabold text-white outline-none placeholder:text-white/30"
                />
                <span className="text-[18px] font-bold text-white/60">{unit}</span>
              </label>
            </div>
          ) : (
            <>
              <p className="text-[12px] font-bold tracking-[.16em] text-white/60 uppercase">
                Drive done
              </p>
              <p
                className="fx-stamp mt-2 font-display text-[80px] leading-[.9] font-extrabold tracking-[-0.05em]"
                style={{ fontVariationSettings: "'wdth' 112" }}
              >
                <CountUp
                  value={trip.meters}
                  format={(value) => distance(value, unit)}
                  mono={false}
                  duration={reduced ? 0 : 900}
                />
                <span className="ml-2 text-[26px] font-bold tracking-normal text-white/60">
                  {unit === 'mi' ? 'miles' : 'km'}
                </span>
              </p>
              <p className="mt-2 text-[14.5px] text-white/65">
                {clock(trip.seconds).replace(/^00:/, '')} · started {trip.start}
              </p>
              <RouteLine points={trip.route} className="mt-4 max-w-[320px]" />
            </>
          )}
        </div>
        <div className="grid gap-2">
          <p className="text-[12px] font-bold tracking-[.14em] text-white/60 uppercase">
            What was it for?
          </p>
          <KindChips value={trip.kind} onChange={(kind) => set({ kind })} dark />
        </div>
        <div className="grid gap-2">
          <label
            htmlFor={`${id}-purpose`}
            className="text-[12px] font-bold tracking-[.14em] text-white/60 uppercase"
          >
            Purpose <span className="font-medium tracking-normal normal-case">· optional</span>
          </label>
          <Picks
            label="Purposes"
            values={purposes}
            value={trip.purpose}
            onPick={(purpose) => set({ purpose })}
            dark
          />
          <input
            id={`${id}-purpose`}
            value={trip.purpose}
            maxLength={80}
            placeholder="Site visit, supplies, client meeting"
            onChange={(event) => set({ purpose: event.target.value })}
            className={field}
          />
        </div>
        <MoreOptions
          label={<span className="text-white/85">From, to, client, note</span>}
          className="[&_summary_span:first-child]:bg-white/10"
        >
          <div className="grid gap-3">
            <Picks
              label="Places"
              values={places}
              value=""
              onPick={(place) => set(trip.from ? { to: place } : { from: place })}
              dark
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label="From"
                value={trip.from}
                maxLength={60}
                placeholder="From"
                onChange={(event) => set({ from: event.target.value })}
                className={field}
              />
              <input
                aria-label="To"
                value={trip.to}
                maxLength={60}
                placeholder="To"
                onChange={(event) => set({ to: event.target.value })}
                className={field}
              />
            </div>
            <input
              aria-label="Client or project"
              value={trip.tag}
              maxLength={60}
              placeholder="Client or project"
              onChange={(event) => set({ tag: event.target.value })}
              className={field}
            />
            <textarea
              aria-label="Note"
              value={trip.note}
              maxLength={300}
              rows={2}
              placeholder="Note"
              onChange={(event) => set({ note: event.target.value })}
              className="rounded-[14px] bg-white/10 p-3 text-[16px] text-white outline-none placeholder:text-white/40"
            />
          </div>
        </MoreOptions>
        <button
          type="button"
          disabled={meters <= 0}
          onClick={() => onSave({ ...trip, meters })}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-[18px] text-[17px] font-bold text-[#0f1f3d] transition-transform active:scale-[.98] disabled:opacity-40"
          style={{ background: GO }}
        >
          <Icon name="check" size={19} strokeWidth={2.6} /> Save trip
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="mx-auto inline-flex min-h-11 items-center rounded-full px-4 text-[14px] text-white/60 hover:bg-white/10 hover:text-white"
        >
          Discard
        </button>
      </Road>
    </div>
  );
}

/* ---------------- a trip by hand, or changing one ---------------- */

function TripSheet({
  trip,
  isNew,
  unit,
  today,
  trips,
  onSave,
  onDelete,
  onClose,
}: {
  trip: Trip | null;
  isNew: boolean;
  unit: 'mi' | 'km';
  today: string;
  trips: Trip[];
  onSave: (trip: Trip) => void;
  onDelete: (trip: Trip) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(trip);
  const [miles, setMiles] = useState(() =>
    trip && trip.meters ? distance(trip.meters, unit).replace(/,/g, '') : '',
  );
  const first = useRef<HTMLInputElement>(null);
  if (!trip || !draft)
    return (
      <Sheet open={false} onClose={onClose} title="Trip">
        <span />
      </Sheet>
    );
  const set = (change: Partial<Trip>) =>
    setDraft((current) => current && { ...current, ...change });
  const meters = parseDistance(miles, unit);
  const places = recentPlaces(trips);
  const purposes = recentValues(trips, 'purpose');
  const tags = recentValues(trips, 'tag');
  const field =
    'h-12 w-full rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]';
  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title={isNew ? 'Add a trip' : tripTitle(trip)}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {!isNew ? (
            <button
              type="button"
              onClick={() => onDelete(trip)}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-muted hover:bg-critical-soft hover:text-critical"
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!meters}
            onClick={() => meters && onSave({ ...draft, meters })}
            className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15.5px] font-bold text-[var(--on-accent)] disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name="check" size={17} strokeWidth={2.6} /> {isNew ? 'Log it' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="grid gap-5">
        {!isNew && trip.source === 'gps' && trip.route.length > 1 && (
          <div className="rounded-[18px] p-3" style={{ background: DEEP }}>
            <RouteLine points={trip.route} />
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <label className="grid gap-1.5" htmlFor={`${id}-miles`}>
            <span className="text-[13.5px] font-medium text-ink-2">
              {unit === 'mi' ? 'Miles' : 'Kilometers'} {draft.roundTrip && '(one way)'}
            </span>
            <input
              ref={first}
              id={`${id}-miles`}
              data-autofocus
              inputMode="decimal"
              value={miles}
              placeholder="0.0"
              onChange={(event) => setMiles(event.target.value)}
              className="h-16 w-full rounded-[16px] bg-subtle px-4 font-display text-[30px] font-extrabold text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
            />
          </label>
          <button
            type="button"
            aria-pressed={draft.roundTrip}
            onClick={() => set({ roundTrip: !draft.roundTrip })}
            className={cn(
              'inline-flex h-16 items-center gap-2 rounded-[16px] px-4 text-[14.5px] font-semibold',
              draft.roundTrip ? 'bg-ink text-on-ink' : 'bg-well text-ink-2',
            )}
          >
            <Icon name="repeat" size={16} /> Round trip
          </button>
        </div>
        {draft.roundTrip && meters && (
          <p className="-mt-3 text-[13.5px] text-muted">
            Counts as {distance(meters * 2, unit)} {unit}.
          </p>
        )}
        <label className="grid gap-1.5">
          <span className="text-[13.5px] font-medium text-ink-2">Day</span>
          <input
            type="date"
            value={draft.date}
            max={today}
            onChange={(event) => event.target.value && set({ date: event.target.value })}
            className={cn(field, 'max-w-[220px]')}
          />
        </label>
        <div className="grid gap-2">
          <span className="text-[13.5px] font-medium text-ink-2">What was it for?</span>
          <KindChips value={draft.kind} onChange={(kind) => set({ kind })} />
        </div>
        <MoreOptions
          label="From, to, purpose, client"
          summary={
            [tripTitle(draft) !== 'Drive' && tripTitle(draft), draft.tag]
              .filter(Boolean)
              .join(' · ') || 'Optional'
          }
          defaultOpen={!isNew || Boolean(draft.from || draft.purpose)}
        >
          <div className="grid gap-3">
            <Picks
              label="Places"
              values={places}
              value=""
              onPick={(place) => set(draft.from && !draft.to ? { to: place } : { from: place })}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                aria-label="From"
                value={draft.from}
                maxLength={60}
                placeholder="From"
                onChange={(event) => set({ from: event.target.value })}
                className={field}
              />
              <input
                aria-label="To"
                value={draft.to}
                maxLength={60}
                placeholder="To"
                onChange={(event) => set({ to: event.target.value })}
                className={field}
              />
            </div>
            <Picks
              label="Purposes"
              values={purposes}
              value={draft.purpose}
              onPick={(purpose) => set({ purpose })}
            />
            <input
              aria-label="Purpose"
              value={draft.purpose}
              maxLength={80}
              placeholder="Purpose"
              onChange={(event) => set({ purpose: event.target.value })}
              className={field}
            />
            <Picks
              label="Clients and projects"
              values={tags}
              value={draft.tag}
              onPick={(tag) => set({ tag })}
            />
            <input
              aria-label="Client or project"
              value={draft.tag}
              maxLength={60}
              placeholder="Client or project"
              onChange={(event) => set({ tag: event.target.value })}
              className={field}
            />
            <textarea
              aria-label="Note"
              value={draft.note}
              maxLength={300}
              rows={2}
              placeholder="Note"
              onChange={(event) => set({ note: event.target.value })}
              className="rounded-[14px] bg-subtle p-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none"
            />
          </div>
        </MoreOptions>
      </div>
    </Sheet>
  );
}
