/** Formatting shared by server and client. Times render in the Space's timezone. */

const DEFAULT_TZ = 'America/Chicago';

export function formatCurrency(value: number, { cents = true }: { cents?: boolean } = {}) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(value);
}

/** "$148k", "$1.2M", "$640": big values at a glance. */
export function formatCompactMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10000 ? 1 : 0,
  })
    .format(value)
    .replace(/K$/, 'k');
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatMiles(value: number) {
  return `${formatNumber(value, value % 1 === 0 ? 0 : 1)} mi`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso: string, timezone = DEFAULT_TZ, withYear = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: timezone,
  }).format(new Date(iso));
}

export function formatDateLong(iso: string, timezone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timezone = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(iso));
}

/** "just now", "12m", "3h", "Yesterday", "Tue", "Sep 12". Compact, for lists. */
export function formatRelative(iso: string, timezone = DEFAULT_TZ, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (diff < 0) {
    const days = Math.round(-diff / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 7) return `In ${days} days`;
    return formatDate(iso, timezone);
  }
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return 'Yesterday';
  if (days < 7)
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(
      new Date(iso),
    );
  return formatDate(iso, timezone);
}

/** formatRelative for the middle of a sentence: "edited yesterday", "edited Tuesday". */
export function formatRelativeInline(iso: string, timezone = DEFAULT_TZ, now = Date.now()) {
  const text = formatRelative(iso, timezone, now);
  return /^(Today|Tomorrow|Yesterday|In )/.test(text)
    ? text[0].toLowerCase() + text.slice(1)
    : text;
}

/** Days from now until a date (negative when past). */
export function daysUntil(iso: string, now = Date.now()) {
  return Math.ceil((new Date(iso).getTime() - now) / 86400000);
}

export function greeting(timezone = DEFAULT_TZ, now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: timezone,
    }).format(now),
  );
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Start of the current month in the given timezone, as a timestamp. Approximate at DST edges. */
export function startOfMonth(timezone = DEFAULT_TZ, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    timeZone: timezone,
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return Date.UTC(year, month - 1, 1, 6);
}

export function plural(count: number, one: string, many = `${one}s`) {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}
