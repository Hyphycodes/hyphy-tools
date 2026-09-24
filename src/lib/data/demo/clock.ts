/**
 * Demo records are written relative to "now" so the product always looks alive: a receipt from
 * this morning stays from this morning. Local times are in the demo's home timezone.
 */
export const DEMO_TZ = 'America/Chicago';

function offsetMinutes(date: Date, timeZone: string) {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

export type Clock = ReturnType<typeof createClock>;

export function createClock(now: number) {
  const today = new Intl.DateTimeFormat('en-US', {
    timeZone: DEMO_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(now));
  const part = (type: string) => Number(today.find((item) => item.type === type)?.value);
  const [year, month, day] = [part('year'), part('month'), part('day')];

  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    now,
    /** A moment in the past. */
    ago: (days = 0, hours = 0, minutes = 0) =>
      iso(now - ((days * 24 + hours) * 60 + minutes) * 60000),
    /** A moment in the future. */
    ahead: (days = 0, hours = 0) => iso(now + (days * 24 + hours) * 3600000),
    /**
     * A local clock time on a day relative to today (negative = past). Never later than now,
     * so "today at 5 pm" can't appear before it has happened.
     */
    at: (dayOffset: number, time: string) => {
      const [hours, minutes] = time.split(':').map(Number);
      const guess = Date.UTC(year, month - 1, day + dayOffset, hours, minutes);
      const ms = guess - offsetMinutes(new Date(guess), DEMO_TZ) * 60000;
      return iso(dayOffset <= 0 ? Math.min(ms, now - 20 * 60000) : ms);
    },
  };
}
