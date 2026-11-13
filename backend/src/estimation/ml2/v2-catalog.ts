import { estimateV2, V2Estimate } from './v2-estimate';
import { buildV2Features, V2FeatureInput } from './v2-features';
import {
  loadV2Signals,
  v2ReviewsAge,
  v2ReviewsAtDate,
  V2Query,
  V2Status,
  V2World,
} from './v2-inputs';
import { V2Model, V2Prediction, v2SignalGroups, V2Target } from './v2-model';

/**
 * The whole V2 chain for a batch of games at one date: read the base, ask the
 * model (total and PC, today and at the date of the game's last published
 * total), apply the rules. Mirror of `ml2/estimate_catalog.py`.
 */

const MS_PER_DAY = 86_400_000;

export interface V2GameEstimate {
  status: V2Status;
  /** Null when the game is not in scope, excluded or not released. */
  estimate: V2Estimate | null;
  /** The model's total today, with its range. */
  model: V2Prediction | null;
  /** The model's PC sales today (never above its total). */
  modelPc: number | null;
  steamReviews: number | null;
  /** The last published total the estimate is anchored on, if any. */
  anchor: {
    units: number;
    reportedAt: Date;
    steamReviewsAtDate: number | null;
    reviewsReadThatDay: boolean;
    modelLogAtDate: number;
  } | null;
  bestPublished: number | null;
}

function ask(
  model: V2Model,
  input: V2FeatureInput,
  target: V2Target,
): V2Prediction {
  const built = buildV2Features(input, target, model.columns);
  return model.predict(
    built.features,
    input.steamReviews,
    built.target,
    v2SignalGroups(
      model.json,
      input.steamReviews,
      input.steamPeakPlayers,
      (input.psRatings ?? 0) + (input.xboxRatings ?? 0),
    ),
  );
}

export async function estimateV2Games(
  query: V2Query,
  model: V2Model,
  gameIds: string[],
  asOf: Date,
  /** Figures and prices entered after that date are not read (default: `asOf`). */
  knownBy: Date = asOf,
): Promise<Map<string, V2GameEstimate>> {
  const out = new Map<string, V2GameEstimate>();
  const [world, today] = await Promise.all([
    V2World.load(query, model.json, gameIds, knownBy),
    loadV2Signals(
      query,
      gameIds.map((gameId) => ({ gameId, at: asOf })),
    ),
  ]);
  const estimated = gameIds.filter(
    (id) => world.has(id) && world.status(id, asOf) === 'estimated',
  );
  // The last published total of each game: what its estimate is anchored on.
  const lastTotal = new Map<string, { reportedAt: number; units: number }>();
  for (const id of estimated) {
    const totals = world.figures(id).filter((f) => f.total && !f.players);
    if (totals.length) lastTotal.set(id, totals[totals.length - 1]);
  }
  // The figure counts sales up to its day: readings of that day are fair game.
  const readAt = (reportedAt: number): Date =>
    new Date(Math.floor(reportedAt / MS_PER_DAY) * MS_PER_DAY + MS_PER_DAY);
  const then = await loadV2Signals(
    query,
    [...lastTotal].map(([gameId, total]) => ({
      gameId,
      at: readAt(total.reportedAt),
    })),
  );

  for (const id of gameIds) {
    if (!world.has(id)) continue;
    const status = world.status(id, asOf);
    const signals = today.get(id);
    const input =
      status === 'estimated' ? world.input(id, asOf, signals) : null;
    if (!input) {
      out.set(id, {
        status,
        estimate: null,
        model: null,
        modelPc: null,
        steamReviews: null,
        anchor: null,
        bestPublished: null,
      });
      continue;
    }
    input.steamReviewsAgeDays = v2ReviewsAge(signals, asOf);
    const total = ask(model, input, 'TOTAL');
    const pc = ask(model, input, 'PC').units;

    let anchor: V2GameEstimate['anchor'] = null;
    const last = lastTotal.get(id);
    if (last) {
      const at = readAt(last.reportedAt);
      const read = then.get(id);
      const rebuilt = v2ReviewsAtDate(
        read,
        at.getTime(),
        world.pcRelease(id, read),
      );
      const past = world.input(
        id,
        new Date(last.reportedAt),
        read,
        rebuilt.reviews,
      )!;
      past.steamReviewsAgeDays = v2ReviewsAge(read, at);
      anchor = {
        units: last.units,
        reportedAt: new Date(last.reportedAt),
        steamReviewsAtDate: rebuilt.reviews,
        reviewsReadThatDay: rebuilt.readThatDay,
        modelLogAtDate: Math.log(ask(model, past, 'TOTAL').units),
      };
    }
    const sales = world.figures(id).filter((f) => !f.players);
    const bestPublished = sales.length
      ? Math.max(...sales.map((f) => f.units))
      : null;
    const platforms = world.platforms(id);
    out.set(id, {
      status,
      estimate: estimateV2(model.json, {
        asOf,
        firstRelease: input.firstRelease,
        model: total,
        modelPc: pc,
        steamReviews: input.steamReviews,
        onPc: platforms.includes('PC'),
        onPlaystation: platforms.includes('PLAYSTATION'),
        onXbox: platforms.includes('XBOX'),
        psRatings: input.psRatings,
        xboxRatings: input.xboxRatings,
        gamePass: world.gamePass(id),
        anchor,
        bestPublished,
      }),
      model: total,
      modelPc: platforms.includes('PC') ? Math.min(pc, total.units) : null,
      steamReviews: input.steamReviews,
      anchor,
      bestPublished,
    });
  }
  return out;
}
