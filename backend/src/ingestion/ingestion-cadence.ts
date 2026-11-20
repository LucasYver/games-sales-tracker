export type IngestionCadence = 'hour' | 'day' | 'week' | 'month';

export interface CycleWindow {
  startedAt: Date;
  endsAt: Date;
}

/**
 * Calendar window for a cadence, always in UTC.
 * Hourly windows can be offset by a few minutes past the hour.
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

/**
 * UTC hours at which EXTENDED games get a Steam player-count reading (CORE
 * games are read every hour). Only the day's highest reading is stored, so
 * the slots sit on the usual peaks: 13 UTC (Steam's daily high, Asian
 * evening), 17 and 20 UTC (European evening) and 01 UTC (American evening).
 * Keep them at least 3 hours apart: a slot's leftover games are read by the
 * following hourly runs, once the CORE games are done.
 */
export const STEAM_CCU_EXTENDED_HOURS_UTC: readonly number[] = [1, 13, 17, 20];

/**
 * Start of the latest slot at or before `now`, for a job that runs at fixed
 * whole UTC hours (`hoursUtc`). Before the first slot of the day it returns
 * yesterday's last slot.
 */
export function latestSlotStart(
  hoursUtc: readonly number[],
  now: Date = new Date(),
): Date {
  const dayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const hour = now.getUTCHours();
  const sorted = [...hoursUtc].sort((a, b) => a - b);
  const todaySlots = sorted.filter((slot) => slot <= hour);
  const slotHour =
    todaySlots.length > 0
      ? todaySlots[todaySlots.length - 1]
      : sorted[sorted.length - 1] - 24;
  return new Date(dayStart + slotHour * 3600 * 1000);
}
