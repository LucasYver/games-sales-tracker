import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { estimateV2Games, V2GameEstimate } from './v2-catalog';
import { v2Model } from './v2-model';

/** `estimation_method.code` of the worldwide V2 estimate rows. */
export const ML_V2_METHOD_CODE = 'ml-v2';

/**
 * The worldwide sales estimate of the V2 model frozen in `ml2/` (see
 * `v2-catalog.ts`): the figure the site displays for every game it estimates.
 * A game it does not estimate (no signal, or excluded by hand in the frozen
 * file) shows "Not estimated".
 */
@Injectable()
export class V2EstimateService {
  constructor(private readonly dataSource: DataSource) {}

  get version(): string {
    return v2Model.version;
  }

  /**
   * Estimate at `asOf` (default: now) from the signals known then and every
   * published figure entered so far. Null for an unknown game.
   */
  async estimate(gameId: string, asOf?: Date): Promise<V2GameEstimate | null> {
    const now = new Date();
    const result = await estimateV2Games(
      (sql, params) => this.dataSource.query(sql, params),
      v2Model,
      [gameId],
      asOf ?? now,
      now,
    );
    return result.get(gameId) ?? null;
  }
}
