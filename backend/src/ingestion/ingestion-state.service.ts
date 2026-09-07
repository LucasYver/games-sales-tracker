import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  GameIngestionState,
  IngestionPipeline,
} from '../entities/game-ingestion-state.entity';

@Injectable()
export class IngestionStateService {
  constructor(
    @InjectRepository(GameIngestionState)
    private readonly states: Repository<GameIngestionState>,
  ) {}

  async track<T>(
    gameId: string,
    pipeline: IngestionPipeline,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.states.query(
      `INSERT INTO game_ingestion_state
         ("gameId", pipeline, "lastAttemptAt", "failureCount")
       VALUES ($1, $2, now(), 0)
       ON CONFLICT ("gameId", pipeline)
       DO UPDATE SET "lastAttemptAt" = EXCLUDED."lastAttemptAt"`,
      [gameId, pipeline],
    );

    try {
      const result = await operation();
      await this.states.update(
        { gameId, pipeline },
        {
          lastSuccessAt: new Date(),
          failureCount: 0,
          lastError: null,
        },
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.states.query(
        `UPDATE game_ingestion_state
         SET "failureCount" = "failureCount" + 1,
             "lastError" = $3
         WHERE "gameId" = $1 AND pipeline = $2`,
        [gameId, pipeline, message.slice(0, 2000)],
      );
      throw error;
    }
  }

  async oldestFirst(
    pipeline: IngestionPipeline,
    gameIds: string[],
  ): Promise<string[]> {
    return this.selectDue(pipeline, gameIds, 0);
  }

  /**
   * Games whose last attempt on `pipeline` is older than `minIntervalMs`,
   * stalest first. Never-attempted games sort ahead of everything else, so a
   * budgeted cron drains its backlog instead of starving at the tail of an
   * unordered scan.
   */
  async selectDue(
    pipeline: IngestionPipeline,
    gameIds: string[],
    minIntervalMs: number,
  ): Promise<string[]> {
    if (gameIds.length === 0) return [];
    const rows = await this.states.find({
      where: { pipeline, gameId: In(gameIds) },
      select: ['gameId', 'lastAttemptAt'],
    });
    const attemptedAt = new Map(
      rows.map((row) => [row.gameId, row.lastAttemptAt?.getTime() ?? 0]),
    );
    const threshold = Date.now() - minIntervalMs;
    return gameIds
      .filter((gameId) => (attemptedAt.get(gameId) ?? 0) <= threshold)
      .sort((a, b) => (attemptedAt.get(a) ?? 0) - (attemptedAt.get(b) ?? 0));
  }
}
