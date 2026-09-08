export type IngestionCadence = 'hour' | 'day' | 'week' | 'month';

export interface CycleWindow {
  startedAt: Date;
  endsAt: Date;
}

/**
 * Calendar window for a cadence, always in UTC.
 * Hourly windows can be offset (Twitch polls at :30).
 */
export function cycleWindow(
  cadence: IngestionCadence,
  now: Date = new Date(),
  hourOffsetMinutes = 0,
): CycleWindow {
  const startedAt = new Date(now);

  if (cadence === 'hour') {
    startedAt.setUTCSeconds(0, 0);
    if (startedAt.getUTCMinutes() < hourOffsetMinutes) {
      startedAt.setUTCHours(startedAt.getUTCHours() - 1);
    }
    startedAt.setUTCMinutes(hourOffsetMinutes, 0, 0);
    return {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 60 * 60 * 1000),
    };
  }

  startedAt.setUTCHours(0, 0, 0, 0);

  if (cadence === 'day') {
    return {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 24 * 60 * 60 * 1000),
    };
  }

  if (cadence === 'week') {
    const daysSinceMonday = (startedAt.getUTCDay() + 6) % 7;
    startedAt.setUTCDate(startedAt.getUTCDate() - daysSinceMonday);
    return {
      startedAt,
      endsAt: new Date(startedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
  }

  startedAt.setUTCDate(1);
  const endsAt = new Date(startedAt);
  endsAt.setUTCMonth(endsAt.getUTCMonth() + 1);
  return { startedAt, endsAt };
}

export function isDue(
  lastAttemptAt: Date | number | null | undefined,
  cadence: IngestionCadence,
  now: Date = new Date(),
  hourOffsetMinutes = 0,
): boolean {
  if (lastAttemptAt == null) return true;
  const timestamp =
    lastAttemptAt instanceof Date ? lastAttemptAt.getTime() : lastAttemptAt;
  if (!Number.isFinite(timestamp) || timestamp === 0) return true;
  return (
    timestamp < cycleWindow(cadence, now, hourOffsetMinutes).startedAt.getTime()
  );
}
