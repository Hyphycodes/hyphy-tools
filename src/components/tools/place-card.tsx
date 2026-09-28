import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import {
  directionsUrl,
  linkSource,
  placeKind,
  type Place,
  type PlaceKind,
} from '@/lib/tools/places';

/*
 * A place as a little destination: a tile of street grid in the place's own color with a pin
 * that says what kind of place it is. Shared by Where? (the cards people vote on) and Plan (the
 * place on the event card). No photos are fetched: the picture is drawn here.
 */

export const KIND_ICON: Record<PlaceKind, IconName> = {
  food: 'utensils',
  drinks: 'wine',
  coffee: 'coffee',
  fun: 'film',
  outdoors: 'tree',
  trip: 'plane',
  place: 'map-pin',
};

/** Warm city-night colors that hold white text; the same name always gets the same one. */
const PLACE_COLORS = [
  ['#ff6b5b', '#c2352b'],
  ['#ff8fab', '#c23a6b'],
  ['#ffb35c', '#c46a14'],
  ['#9b7bff', '#5b3fc4'],
  ['#3fc1a5', '#16806a'],
  ['#5b9dff', '#2b5fc4'],
  ['#f2789f', '#a3305a'],
  ['#e0a340', '#9a6410'],
] as const;

export function placeColors(name: string) {
  let hash = 7;
  for (const char of name.trim().toLowerCase())
    hash = (hash * 33 + (char.codePointAt(0) ?? 0)) >>> 0;
  return PLACE_COLORS[hash % PLACE_COLORS.length];
}

/** The tile: street grid, the place's color, a pin with its kind. */
export function PlaceArt({
  name,
  kind,
  className,
  pin = 'md',
}: {
  name: string;
  kind?: PlaceKind;
  className?: string;
  pin?: 'sm' | 'md' | 'lg';
}) {
  const [light, deep] = placeColors(name);
  const size = pin === 'lg' ? 64 : pin === 'md' ? 46 : 32;
  return (
    <div
      aria-hidden="true"
      className={cn('relative isolate grid place-items-center overflow-hidden', className)}
      style={{
        background: `radial-gradient(90% 80% at 30% 20%, ${light}, ${deep})`,
      }}
    >
      {/* Streets: a few crossing lines, one a little wider, like a map seen from above. */}
      <div
        className="absolute inset-0 -z-10 opacity-35"
        style={{
          background: `linear-gradient(90deg, transparent 0 38%, rgb(255 255 255 / .55) 38% 41%, transparent 41%), linear-gradient(0deg, transparent 0 62%, rgb(255 255 255 / .5) 62% 64%, transparent 64%), repeating-linear-gradient(90deg, transparent 0 22px, rgb(255 255 255 / .22) 22px 23px), repeating-linear-gradient(0deg, transparent 0 22px, rgb(255 255 255 / .22) 22px 23px)`,
        }}
      />
      <span
        className="relative grid place-items-center drop-shadow-[0_6px_10px_rgb(0_0_0/.25)]"
        style={{ width: size, height: size * 1.2, color: deep }}
      >
        <svg viewBox="0 0 40 48" className="absolute inset-0 h-full w-full">
          <path d="M20 47s17-15.4 17-28A17 17 0 0 0 3 19c0 12.6 17 28 17 28Z" fill="#fffaf5" />
        </svg>
        <Icon
          name={KIND_ICON[kind ?? placeKind(name)]}
          size={Math.round(size * 0.42)}
          className="relative -mt-[18%]"
          strokeWidth={2.1}
        />
      </span>
    </div>
  );
}

/** A place in a line: its tile, its name and a note, and directions. */
export function PlaceLine({
  place,
  className,
  children,
}: {
  place: Place;
  className?: string;
  /** Extra actions at the end ("Change"). */
  children?: ReactNode;
}) {
  const source = place.url ? linkSource(place.url) : '';
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <PlaceArt name={place.name} pin="sm" className="size-14 shrink-0 rounded-[16px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16.5px] leading-tight font-semibold text-ink">{place.name}</p>
        <p className="truncate text-[13px] text-muted">
          {[place.note, source && `from ${source}`].filter(Boolean).join(' · ') ||
            'Tap directions to find it'}
        </p>
      </div>
      <a
        href={directionsUrl(place)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-semibold text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
      >
        <Icon name="navigation" size={15} /> Directions
      </a>
      {children}
    </div>
  );
}
