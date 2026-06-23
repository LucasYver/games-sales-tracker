import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EstimationMethod, EstimationMethodFamily } from '../entities';

/**
 * Stable code for the synthetic method that holds the weighted combination
 * of every other enabled method for a given (game, platform, computedAt).
 * `GamesService.reconcile` consumes this row by preference.
 */
export const AGGREGATED_METHOD_CODE = 'aggregated';

/**
 * In-memory cache of the `estimation_method` registry. The table is tiny
 * (~20 rows), almost never mutated at runtime, and looked up on every
 * `SalesEstimate` write — perfect fit for an eager cache hydrated once on
 * module init. Code that needs to add new rows at runtime should call
 * `refresh()` afterwards.
 */
@Injectable()
export class EstimationMethodService implements OnModuleInit {
  private byCode = new Map<string, EstimationMethod>();
  private byId = new Map<string, EstimationMethod>();

  constructor(
    @InjectRepository(EstimationMethod)
    private readonly repository: Repository<EstimationMethod>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.repository.find();
    this.byCode = new Map(rows.map((r) => [r.code, r]));
    this.byId = new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Resolve a canonical method by its stable `code`. Throws if the code
   * is not seeded — the caller is expected to know the code at compile
   * time so an unknown code is a programming error, not a data error.
   */
  requireByCode(code: string): EstimationMethod {
    const method = this.byCode.get(code);
    if (!method) {
      throw new Error(
        `Unknown estimation method code: "${code}". Add it to the estimation_method seed before referencing it.`,
      );
    }
    return method;
  }

  findByCode(code: string): EstimationMethod | null {
    return this.byCode.get(code) ?? null;
  }

  findById(id: string): EstimationMethod | null {
    return this.byId.get(id) ?? null;
  }

  /**
   * All methods eligible to be combined by `aggregateMethods` — enabled
   * and not themselves an aggregate output. The aggregator joins this
   * filter with the actual `SalesEstimate` rows present for the
   * (game, platform, computedAt) tuple.
   */
  aggregationInputs(): EstimationMethod[] {
    return Array.from(this.byCode.values()).filter(
      (m) => m.isEnabled && !m.isAggregate,
    );
  }

  family(family: EstimationMethodFamily): EstimationMethod[] {
    return Array.from(this.byCode.values()).filter((m) => m.family === family);
  }
}
