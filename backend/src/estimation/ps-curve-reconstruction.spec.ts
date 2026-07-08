import {
  DEFAULT_MAX_STEAM_LAG_DAYS,
  DEFAULT_SHAPE_RATIO_FLOOR,
  DEFAULT_STEAM_FLOOR,
  PsReconstructionInputs,
  reconstructPsCurveMonthly,
  reconstructPsRatingAt,
} from './ps-curve-reconstruction';

const DAY = 24 * 3600 * 1000;

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Synchronised multiplatform title: PS and Steam launch the same day and both
 * accumulate a clean cumulative curve. This is the happy path.
 */
function syncedInputs(
  overrides: Partial<PsReconstructionInputs> = {},
): PsReconstructionInputs {
  const start = d('2022-01-01');
  const steamReviews = Array.from({ length: 25 }, (_, i) => ({
    capturedAt: new Date(start.getTime() + i * 30 * DAY),
    // Linear-ish cumulative growth well above every floor.
    value: 1000 + i * 4000,
  }));
  return {
    anchor: {
      capturedAt: new Date(start.getTime() + 24 * 30 * DAY),
      value: 50000,
    },
    psReleaseDate: start,
    steamReviews,
    ...overrides,
  };
}

describe('reconstructPsRatingAt', () => {
  it('reconstructs proportionally to the aligned Steam shape', () => {
    const inputs = syncedInputs();
    const start = inputs.psReleaseDate as Date;
    const target = new Date(start.getTime() + 12 * 30 * DAY);

    const out = reconstructPsRatingAt(target, inputs);

    // steamAligned(target) / steamAligned(anchor) = (1000+12*4000)/(1000+24*4000)
    const expected = 50000 * (49000 / 97000);
    expect(out.reason).toBeNull();
    expect(out.value).toBeCloseTo(expected, 6);
  });

  it('abstains when the anchor is missing or non-positive', () => {
    const inputs = syncedInputs({ anchor: { capturedAt: d('2023-01-01'), value: 0 } });
    expect(reconstructPsRatingAt(d('2022-06-01'), inputs)).toEqual({
      value: null,
      reason: 'no-anchor',
    });
  });

  it('abstains when there is no Steam curve to borrow the shape from', () => {
    const inputs = syncedInputs({ steamReviews: [] });
    expect(reconstructPsRatingAt(d('2022-06-01'), inputs).reason).toBe('no-steam');
  });

  it('abstains for targets before the PS release', () => {
    const inputs = syncedInputs();
    const before = new Date((inputs.psReleaseDate as Date).getTime() - 10 * DAY);
    expect(reconstructPsRatingAt(before, inputs).reason).toBe('pre-ps-release');
  });

  it('abstains when the Steam footprint at the anchor is negligible', () => {
    const start = d('2022-01-01');
    const inputs: PsReconstructionInputs = {
      anchor: { capturedAt: new Date(start.getTime() + 300 * DAY), value: 800 },
      psReleaseDate: start,
      steamReviews: [
        { capturedAt: start, value: 10 },
        { capturedAt: new Date(start.getTime() + 300 * DAY), value: DEFAULT_STEAM_FLOOR - 1 },
      ],
    };
    expect(reconstructPsRatingAt(new Date(start.getTime() + 150 * DAY), inputs).reason).toBe(
      'negligible-steam',
    );
  });

  describe('shape-reliability guardrail', () => {
    // Steam dwarfs PS (tiny ratio) AND launches are far apart in time: the
    // classic early-access-on-Steam / late-to-Steam failure (e.g. CoD Vanguard).
    function unreliableInputs(): PsReconstructionInputs {
      const psRelease = d('2023-01-01');
      // First Steam review is ~2 years before the PS launch (> 365d gap).
      const steamStart = d('2021-01-01');
      const steamReviews = Array.from({ length: 40 }, (_, i) => ({
        capturedAt: new Date(steamStart.getTime() + i * 30 * DAY),
        value: 100000 + i * 50000,
      }));
      const anchorDate = new Date(steamStart.getTime() + 39 * 30 * DAY);
      return {
        // PS anchor is tiny vs the ~2M Steam reviews at the same date.
        anchor: { capturedAt: anchorDate, value: 3000 },
        psReleaseDate: psRelease,
        steamReviews,
      };
    }

    it('abstains when PS/Steam ratio is tiny and Steam↔PS launch gap is large', () => {
      const inputs = unreliableInputs();
      const anchorDate = inputs.anchor.capturedAt;
      const target = new Date(anchorDate.getTime() - 300 * DAY);
      expect(reconstructPsRatingAt(target, inputs).reason).toBe('shape-unreliable');
    });

    it('does NOT abstain when the launch gap is small even with a tiny ratio', () => {
      const inputs = unreliableInputs();
      // Move PS launch next to the Steam start so the gap is within the limit.
      const near = new Date(
        inputs.steamReviews[0].capturedAt.getTime() +
          (DEFAULT_MAX_STEAM_LAG_DAYS - 30) * DAY,
      );
      const withNearLaunch: PsReconstructionInputs = { ...inputs, psReleaseDate: near };
      const target = new Date(inputs.anchor.capturedAt.getTime() - 300 * DAY);
      expect(reconstructPsRatingAt(target, withNearLaunch).reason).not.toBe(
        'shape-unreliable',
      );
    });

    it('does NOT abstain when the ratio is healthy even with a large launch gap', () => {
      const inputs = unreliableInputs();
      // Lift the PS anchor so the ratio clears the floor.
      const healthy: PsReconstructionInputs = {
        ...inputs,
        anchor: { ...inputs.anchor, value: 5_000_000 },
      };
      const target = new Date(inputs.anchor.capturedAt.getTime() - 300 * DAY);
      expect(reconstructPsRatingAt(target, healthy).reason).not.toBe('shape-unreliable');
    });

    it('exposes tunable thresholds via inputs', () => {
      const inputs = syncedInputs();
      // Force the guardrail to trip on the otherwise-healthy synced game.
      const forced: PsReconstructionInputs = {
        ...inputs,
        shapeRatioFloor: 1000,
        maxSteamLagDays: 0,
        psReleaseDate: new Date(
          (inputs.steamReviews[0].capturedAt as Date).getTime() - 400 * DAY,
        ),
      };
      // target must be >= psReleaseDate to reach the guardrail check.
      const target = inputs.steamReviews[0].capturedAt;
      expect(reconstructPsRatingAt(target, forced).reason).toBe('shape-unreliable');
      expect(DEFAULT_SHAPE_RATIO_FLOOR).toBeGreaterThan(0);
    });
  });
});

describe('reconstructPsCurveMonthly', () => {
  it('builds a monthly series that ends exactly on toDate', () => {
    const inputs = syncedInputs();
    const from = inputs.psReleaseDate as Date;
    const to = new Date(from.getTime() + 12 * 30 * DAY);

    const series = reconstructPsCurveMonthly(from, to, inputs);

    expect(series.length).toBeGreaterThan(1);
    expect(series[series.length - 1].capturedAt.getTime()).toBe(to.getTime());
    // Cumulative curve must be non-decreasing.
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].value).toBeGreaterThanOrEqual(series[i - 1].value);
    }
  });

  it('returns an empty series when from is after to', () => {
    const inputs = syncedInputs();
    const from = new Date((inputs.psReleaseDate as Date).getTime() + 100 * DAY);
    const to = inputs.psReleaseDate as Date;
    expect(reconstructPsCurveMonthly(from, to, inputs)).toEqual([]);
  });

  it('skips points that trip a guardrail (no synthetic when unreliable)', () => {
    const psRelease = d('2023-01-01');
    const steamStart = d('2021-01-01');
    const inputs: PsReconstructionInputs = {
      anchor: {
        capturedAt: new Date(steamStart.getTime() + 39 * 30 * DAY),
        value: 3000,
      },
      psReleaseDate: psRelease,
      steamReviews: Array.from({ length: 40 }, (_, i) => ({
        capturedAt: new Date(steamStart.getTime() + i * 30 * DAY),
        value: 100000 + i * 50000,
      })),
    };
    const series = reconstructPsCurveMonthly(
      psRelease,
      new Date(psRelease.getTime() + 6 * 30 * DAY),
      inputs,
    );
    expect(series).toEqual([]);
  });
});
