'use client';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useReducedMotion } from './kit';

/*
 * Secret Santa's world: a pine-green felt table, parchment envelopes with a cranberry wax seal
 * and a thread of muted gold. The draw shuffles the envelopes; your own lands in front of you;
 * opening it lifts the flap and the card rises with one name on it. No clip art, no confetti.
 */

const PARCHMENT = '#fbf3e2';
const PARCHMENT_DEEP = '#efe2c4';
const CRANBERRY = '#b3263a';
const GOLD = '#c9a24c';

/** The table: deep pine felt with a soft light on it. */
export function Felt({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('relative isolate overflow-hidden rounded-[28px] text-[#f6eedb]', className)}
      style={{
        background:
          'radial-gradient(70% 60% at 50% 20%, rgb(255 244 214 / .14), transparent 70%), radial-gradient(circle at 1px 1px, rgb(255 255 255 / .05) 1px, transparent 1.5px) 0 0 / 6px 6px, linear-gradient(180deg, #21493a, #173628)',
        boxShadow:
          'inset 0 0 0 1px rgb(255 255 255 / .06), inset 0 -40px 80px -40px rgb(0 0 0 / .35)',
      }}
    >
      {/* A little snow, still. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 12px 14px, rgb(255 255 255 / .35) 1.2px, transparent 1.8px) 0 0 / 58px 64px, radial-gradient(circle at 36px 40px, rgb(255 255 255 / .22) 1.5px, transparent 2.1px) 0 0 / 74px 80px',
        }}
      />
      {children}
    </div>
  );
}

/** A wax seal with a star pressed into it. */
export function Seal({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('grid place-items-center rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, #d8485c, ${CRANBERRY} 55%, #7d1424)`,
        boxShadow: '0 3px 8px -2px rgb(60 0 10 / .5), inset 0 0 0 3px rgb(0 0 0 / .08)',
        color: GOLD,
      }}
    >
      <Icon name="star" size={Math.round(size * 0.42)} strokeWidth={2.2} />
    </span>
  );
}

/**
 * An envelope. `open` lifts the flap and lets the card rise (children are the card). `name` is
 * written on the front: "For Kamila".
 */
export function Envelope({
  name,
  open = false,
  width = 220,
  tilt = 0,
  children,
  className,
  style,
}: {
  name?: string;
  open?: boolean;
  width?: number;
  tilt?: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const height = Math.round(width * 0.66);
  return (
    <div
      className={cn('relative', className)}
      style={{ width, height, transform: `rotate(${tilt}deg)`, perspective: 900, ...style }}
    >
      {/* The back of the envelope, and the card inside it (hidden until it's opened). */}
      <div
        className="absolute inset-0 rounded-[10px]"
        style={{ background: PARCHMENT_DEEP, boxShadow: '0 18px 30px -16px rgb(0 0 0 / .55)' }}
      />
      {children && (
        <div
          aria-hidden={!open}
          className="absolute inset-x-[7%] bottom-[6%] z-[1] rounded-[8px] transition-[transform,opacity] duration-700 ease-[cubic-bezier(.2,.9,.2,1)]"
          style={{
            top: '8%',
            opacity: open ? 1 : 0,
            transform: open ? `translateY(-${Math.round(height * 0.72)}px)` : 'translateY(0)',
            transitionDelay: open ? '260ms' : '0ms',
          }}
        >
          {children}
        </div>
      )}
      {/* The front pocket: a soft edge, then the paper. */}
      <div
        className="absolute inset-0 z-[2] rounded-[10px]"
        style={{
          background: '#e2d2ad',
          clipPath: 'polygon(0 33%, 50% 69%, 100% 33%, 100% 100%, 0 100%)',
        }}
      />
      <div
        className="absolute inset-0 z-[2] rounded-[10px]"
        style={{
          background: `linear-gradient(180deg, ${PARCHMENT}, #f7ecd4)`,
          clipPath: 'polygon(0 35%, 50% 71%, 100% 35%, 100% 100%, 0 100%)',
        }}
      />
      {/* A gold thread along the bottom. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-[8%] bottom-[8%] z-[3] h-px opacity-70"
        style={{ background: GOLD }}
      />
      {name && (
        <p
          className="absolute inset-x-3 bottom-[12%] z-[3] truncate text-center font-display font-bold text-[#3a2a1a]"
          style={{ fontSize: Math.max(12, Math.round(width * 0.075)) }}
        >
          For {name}
        </p>
      )}
      {/* The flap: folds up and back when opened. */}
      <div
        className="absolute inset-x-0 top-0 z-[4] h-[56%] origin-top transition-transform duration-500 ease-out"
        style={{
          transform: open ? 'rotateX(180deg)' : 'rotateX(0deg)',
          transformStyle: 'preserve-3d',
          zIndex: open ? 0 : 4,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, ${PARCHMENT}, ${PARCHMENT_DEEP})`,
            clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
            borderRadius: '10px 10px 0 0',
            backfaceVisibility: 'hidden',
          }}
        />
        {!open && (
          <Seal
            size={Math.round(width * 0.17)}
            className="absolute left-1/2 top-[100%] -translate-x-1/2 -translate-y-[70%]"
          />
        )}
      </div>
    </div>
  );
}

/** The card that rises out of the envelope: one name, written large. */
export function MatchCard({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn('grid h-full place-items-center rounded-[8px] px-3 text-center', className)}
      style={{
        background: '#fffdf6',
        boxShadow: `inset 0 0 0 1px ${GOLD}55, 0 10px 20px -12px rgb(0 0 0 / .4)`,
      }}
    >
      <div>
        <p className="text-[10.5px] font-bold tracking-[.16em] text-[#8a6d2e] uppercase">
          You’re giving to
        </p>
        <p className="mt-1 font-display text-[26px] leading-none font-extrabold tracking-[-0.03em] text-[#1b2a22]">
          {name}
        </p>
      </div>
    </div>
  );
}

/**
 * The draw: envelopes shuffling on the felt, one per person (up to eight shown), then settling.
 * `onDone` fires when they've settled; with reduced motion it fires straight away.
 */
export function Shuffle({ count, onDone }: { count: number; onDone: () => void }) {
  const reduced = useReducedMotion();
  const shown = Math.min(Math.max(count, 3), 8);
  const [order, setOrder] = useState(() => Array.from({ length: shown }, (_, index) => index));
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (reduced) {
      done.current();
      return;
    }
    let round = 0;
    const timer = window.setInterval(() => {
      round += 1;
      setOrder((current) => {
        const next = [...current];
        const a = Math.floor(Math.random() * next.length);
        let b = Math.floor(Math.random() * next.length);
        if (a === b) b = (b + 1) % next.length;
        [next[a], next[b]] = [next[b], next[a]];
        return next;
      });
      if (round >= 9) {
        window.clearInterval(timer);
        window.setTimeout(() => done.current(), 420);
      }
    }, 170);
    return () => window.clearInterval(timer);
  }, [reduced]);
  const columns = Math.min(shown, 4);
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto h-[190px] w-full max-w-[420px] sm:h-[210px]"
    >
      {order.map((slot, envelope) => {
        const row = Math.floor(slot / columns);
        const col = slot % columns;
        const inRow = Math.min(columns, shown - row * columns);
        const x = (col - (inRow - 1) / 2) * 86;
        const y = row * 64 - (shown > columns ? 32 : 0);
        return (
          <div
            key={envelope}
            className="absolute top-1/2 left-1/2 transition-transform duration-[260ms] ease-[cubic-bezier(.3,1.3,.5,1)]"
            style={{
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${((envelope * 37) % 11) - 5}deg)`,
            }}
          >
            <Envelope width={78} />
          </div>
        );
      })}
    </div>
  );
}
