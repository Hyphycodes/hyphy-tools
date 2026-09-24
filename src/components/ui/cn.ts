/** Joins class names, skipping falsy values. */
export function cn(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(' ');
}
