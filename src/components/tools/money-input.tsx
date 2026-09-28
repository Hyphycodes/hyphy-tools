'use client';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { minorUnits, moneyInput, parseMoney } from '@/lib/tools/split';

/**
 * An amount you type: the keypad with a decimal point on phones, the currency's symbol beside
 * it, the number kept exactly as typed while you type and saved in whole cents.
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  label,
  placeholder = '0.00',
  className,
  inputClassName,
  id,
  onEnter,
  autoFocus,
}: {
  value: number;
  onChange: (cents: number) => void;
  currency: string;
  label: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(() => moneyInput(value, currency));
  const [focused, setFocused] = useState(false);
  // Changed from outside (a new bill, another currency): show the new amount.
  const shown = focused ? text : moneyInput(value, currency);
  const symbol = (() => {
    try {
      return (
        new Intl.NumberFormat('en-US', { style: 'currency', currency })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ?? '$'
      );
    } catch {
      return '$';
    }
  })();
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] text-muted">
        {symbol}
      </span>
      <input
        id={id}
        aria-label={label}
        inputMode={minorUnits(currency) ? 'decimal' : 'numeric'}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={minorUnits(currency) ? placeholder : '0'}
        value={shown}
        onFocus={() => {
          setText(moneyInput(value, currency));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.target.value);
          onChange(parseMoney(event.target.value, currency) ?? 0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && onEnter) {
            event.preventDefault();
            onEnter();
          }
        }}
        className={cn(
          'num h-11 w-full rounded-[11px] bg-subtle pr-3 text-right text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_0_4px_rgb(106_116_255/.14)] lg:h-10 lg:text-[14.5px]',
          symbol.length > 1 ? 'pl-10' : 'pl-7',
          inputClassName,
        )}
      />
    </div>
  );
}
