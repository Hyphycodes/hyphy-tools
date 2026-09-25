'use client';
import { useRouter } from 'next/navigation';
import { Select } from './form';

/** A select whose choices are places: picking one goes there (filters that live in the URL). */
export function LinkSelect({
  label,
  value,
  options,
  className,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; href: string }[];
  className?: string;
}) {
  const router = useRouter();
  return (
    <Select
      aria-label={label}
      value={value}
      className={className}
      onChange={(event) => {
        const next = options.find((option) => option.value === event.target.value);
        if (next) router.push(next.href, { scroll: false });
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
