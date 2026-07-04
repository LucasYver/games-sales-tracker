import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Game } from './game.entity';

/**
 * Home-grown weekly "rank" aggregates for a game, derived from an OBSERVED
 * units-proxy (review velocity) — never the model's estimated units (circular).
 *
 * Computed by `RankService.recomputeAll`: each week every game is ranked by its
 * review velocity (Δ cumulative STEAM_REVIEWS) among the games that actually
 * moved that week; these per-game aggregates summarise that position series.
 * One row per game, fully recomputed on each run (derived/disposable data).
 *
 * Rank is RELATIVE TO OUR OWN tracked universe (not Steam's whole catalogue) —
 * coherent for the matcher, which only ever compares games within this universe.
 * Percentile variants normalise for the universe growing over time (more games
 * competing in recent weeks than in 2013). Lower rank / percentile = better.
 */
@Entity('game_rank')
export class GameRank {
  @PrimaryColumn('uuid')
  gameId: string;

  @OneToOne(() => Game, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  // Number of weeks the game charted (had positive review velocity, in a week
  // with enough participants to rank).
  @Column('int')
  weeksCharted: number;

  // Best (lowest) weekly position ever reached. Human-readable but era-biased.
  @Column('int')
  peakRank: number;

  // Mean weekly position over charted weeks.
  @Column('float')
  avgRank: number;

  // Best/mean position as a fraction of that week's participants (0..1, lower
  // is better). Era-robust: comparable across weeks with different universe
  // sizes.
  @Column('float')
  peakPercentile: number;

  @Column('float')
  avgPercentile: number;

  // Weeks spent in the top decile (percentile <= 0.10) — the sustain axis,
  // era-robust.
  @Column('int')
  weeksTopDecile: number;

  @Column({ type: 'timestamptz' })
  computedAt: Date;
}
