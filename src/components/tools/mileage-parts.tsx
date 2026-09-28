'use client';
import { useId, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { KIND_NAMES, TRIP_KINDS, type TripKind } from '@/lib/tools/mileage';

/*
 * Mileage's world: deep blue for the road at night, fresh green for going, cream map paper
 * underneath. A drive is a number that grows and a line that draws itself; a saved trip keeps a
 * little route of its own.
 */

export const DEEP = '#0f1f3d';
export const GO = '#2fd07a';

export const KIND_LOOK: Record<TripKind, { icon: IconName; color: string }> = {
  business: { icon: 'briefcase', color: '#2fd07a' },
  personal: { icon: 'home', color: '#8fb0ff' },
  medical: { icon: 'stethoscope', color: '#ff8f8f' },
  charity: { icon: 'hand-heart', color: '#ffc66b' },
  other: { icon: 'route', color: '#b9c2d0' },
};

/** A panel of night road: deep blue with faint contour lines. */
export function Road({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('relative isolate overflow-hidden rounded-[28px] text-white', className)}
      style={{
        background:
          'radial-gradient(70% 60% at 100% 0%, rgb(47 208 122 / .28), transparent 70%), linear-gradient(180deg, #15295a, #0f1f3d)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          background:
            'repeating-radial-gradient(circle at 10% 110%, transparent 0 38px, rgb(255 255 255 / .05) 38px 39.5px)',
        }}
      />
      {children}
    </div>
  );
}

/**
 * A route, drawn: the path scaled into its box, a road under it, a dot where it began and a
 * bigger one where it is (or ended). Without points it's a gentle sample curve.
 */
export function RouteLine({
  points,
  className,
  light = true,
  live = false,
}: {
  points: [number, number][];
  className?: string;
  /** On a dark panel (true) or on paper (false). */
  light?: boolean;
  live?: boolean;
}) {
  const id = useId();
  const W = 300;
  const H = 120;
  const pad = 14;
  let d = 'M20 96 C 90 96, 90 30, 160 36 S 250 90, 280 24';
  let end: [number, number] = [280, 24];
  let start: [number, number] = [20, 96];
  if (points.length >= 2) {
    const lats = points.map((point) => point[0]);
    const lngs = points.map((point) => point[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const spanX = Math.max(1e-6, (maxLng - minLng) * Math.cos(midLat));
    const spanY = Math.max(1e-6, maxLat - minLat);
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const offX = (W - spanX * scale) / 2;
    const offY = (H - spanY * scale) / 2;
    const xy = points.map(
      ([lat, lng]) =>
        [offX + (lng - minLng) * Math.cos(midLat) * scale, H - (offY + (lat - minLat) * scale)] as [
          number,
          number,
        ],
    );
    d = xy.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    start = xy[0];
    end = xy[xy.length - 1];
  }
  const road = light
    ? 'rgb(255 255 255 / .12)'
    : 'color-mix(in srgb, var(--w-ink, #0f1f3d) 10%, transparent)';
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn('block h-auto w-full', className)}
      role="img"
      aria-label={points.length >= 2 ? 'The route' : 'A route'}
    >
      <defs>
        <linearGradient id={`${id}-go`} x1="0" x2="1">
          <stop offset="0" stopColor={GO} stopOpacity=".55" />
          <stop offset="1" stopColor={GO} />
        </linearGradient>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={road}
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={d}
        fill="none"
        stroke={`url(#${id}-go)`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={points.length >= 2 ? 1 : 0.45}
        strokeDasharray={points.length >= 2 ? undefined : '2 9'}
      />
      <circle
        cx={start[0]}
        cy={start[1]}
        r="5"
        fill={light ? DEEP : '#fff'}
        stroke={GO}
        strokeWidth="3"
      />
      <circle
        cx={end[0]}
        cy={end[1]}
        r={live ? 8 : 7}
        fill={GO}
        stroke={light ? DEEP : '#fff'}
        strokeWidth="3"
      />
    </svg>
  );
}

/** Pick what the trip was for; Business first. */
export function KindChips({
  value,
  onChange,
  dark = false,
}: {
  value: TripKind;
  onChange: (kind: TripKind) => void;
  dark?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="What was it for?" className="flex flex-wrap gap-1.5">
      {TRIP_KINDS.map((kind) => {
        const on = value === kind;
        const look = KIND_LOOK[kind];
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(kind)}
            className={cn(
              'fx-move inline-flex min-h-12 items-center gap-2 rounded-full py-1 pr-4 pl-1.5 text-[15px] font-semibold active:scale-[.97]',
              on
                ? dark
                  ? 'bg-white text-[#0f1f3d]'
                  : 'bg-ink text-on-ink'
                : dark
                  ? 'bg-white/10 text-white hover:bg-white/15'
                  : 'bg-well text-ink-2 hover:bg-ink/10',
            )}
          >
            <span
              className="grid size-9 place-items-center rounded-full text-[#0f1f3d]"
              style={{ background: look.color }}
            >
              <Icon name={look.icon} size={17} strokeWidth={2.1} />
            </span>
            {KIND_NAMES[kind]}
          </button>
        );
      })}
    </div>
  );
}

/** Words tapped instead of typed: places, purposes, clients driven before. */
export function Picks({
  label,
  values,
  value,
  onPick,
  dark = false,
}: {
  label: string;
  values: string[];
  value: string;
  onPick: (value: string) => void;
  dark?: boolean;
}) {
  if (!values.length) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {values.map((entry) => {
        const on = value.trim().toLowerCase() === entry.toLowerCase();
        return (
          <button
            key={entry}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(on ? '' : entry)}
            className={cn(
              'min-h-10 rounded-full px-3.5 text-[14px] font-medium',
              on
                ? dark
                  ? 'bg-white text-[#0f1f3d]'
                  : 'bg-ink text-on-ink'
                : dark
                  ? 'bg-white/10 text-white/85'
                  : 'bg-well text-ink-2',
            )}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}
