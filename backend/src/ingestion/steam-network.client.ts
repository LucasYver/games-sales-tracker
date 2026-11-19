import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type SteamUser from 'steam-user';

/** `EMsg.ClientGetClanActivityCounts`; Steam answers with one `ClientClanState` per group. */
const EMSG_GET_CLAN_ACTIVITY_COUNTS = 5554;

// One request carried 105 groups and was answered in ~0.3 s (2026-11-19).
const BATCH_SIZE = 200;
// A batch is done once every group answered, or after this much silence.
const BATCH_QUIET_MS = 4_000;
const BATCH_MAX_MS = 20_000;
const LOGON_TIMEOUT_MS = 30_000;
// Spacing between batches, to stay a polite client.
const BATCH_GAP_MS = 500;
// Warn in the cron log this long before the bot's refresh token expires.
const TOKEN_WARN_MS = 30 * 24 * 3600 * 1000;

/**
 * Load steam-user only when the follower cron runs, so a problem in it cannot
 * take the whole API down at boot (it did once: see below).
 *
 * steam-user loads `lzma` through a computed `require` (`requireWithFallback`)
 * that Vercel's bundler cannot see, so the deploy shipped without it and every
 * route crashed. The literal `require('lzma')` here gets it bundled.
 */
function loadSteamUser(): typeof SteamUser {
  /* eslint-disable @typescript-eslint/no-require-imports */
  require('lzma');
  return require('steam-user') as typeof SteamUser;
  /* eslint-enable @typescript-eslint/no-require-imports */
}

export interface SteamNetworkFollowerResult {
  /** Group SteamID64 → member count (the game's followers). */
  members: Map<string, number>;
  /** Groups Steam did not answer for (no such group, or cut short). */
  missing: string[];
}

/**
 * Steam followers through the Steam client network (the protocol the Steam
 * app speaks), logged on as a dedicated bot account. A game's followers are the
 * members of its hidden community group; `ClientGetClanActivityCounts` returns
 * them for many groups in one request, with none of steamcommunity.com's rate
 * limit (~60 requests per IP before a 10-minute block).
 *
 * The count is the group's full member count, ~2% above the `groupDetails`
 * figure games-popularity.com reported (and which our history before
 * 2026-11 is on).
 *
 * Needs `STEAM_BOT_REFRESH_TOKEN`: a refresh token of the bot account, made
 * with `npm run steam:bot-login`. It expires after ~200 days; see
 * {@link tokenExpiresAt}. An anonymous logon does not work: Steam ignores the
 * request.
 */
@Injectable()
export class SteamNetworkClient {
  private readonly logger = new Logger(SteamNetworkClient.name);
  private readonly refreshToken: string | null;

  constructor(config: ConfigService) {
    this.refreshToken =
      config.get<string>('STEAM_BOT_REFRESH_TOKEN')?.trim() || null;
    if (!this.refreshToken) {
      this.logger.warn(
        'STEAM_BOT_REFRESH_TOKEN not set: Steam followers come from games-popularity only.',
      );
    }
  }

  get enabled(): boolean {
    return this.refreshToken !== null;
  }

  /** When the bot's refresh token expires (read from the JWT), or null. */
  get tokenExpiresAt(): Date | null {
    if (!this.refreshToken) return null;
    try {
      const payload = this.refreshToken.split('.')[1] ?? '';
      const { exp } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { exp?: number };
      return typeof exp === 'number' ? new Date(exp * 1000) : null;
    } catch {
      return null;
    }
  }

  /**
   * Member counts of the given groups, in batches over one logon. Throws when
   * the logon fails; a batch Steam does not fully answer leaves its groups in
   * `missing`. `budgetMs` stops before a batch that would not fit.
   */
  async fetchFollowerCounts(
    clanIds: string[],
    options: { budgetMs?: number } = {},
  ): Promise<SteamNetworkFollowerResult> {
    const members = new Map<string, number>();
    if (!this.refreshToken || clanIds.length === 0) {
      return { members, missing: [...clanIds] };
    }
    const deadline = Date.now() + (options.budgetMs ?? Infinity);
    const expiresAt = this.tokenExpiresAt;
    if (expiresAt && expiresAt.getTime() - Date.now() < TOKEN_WARN_MS) {
      this.logger.warn(
        `STEAM_BOT_REFRESH_TOKEN expires on ${expiresAt.toISOString().slice(0, 10)}: ` +
          'run `npm run steam:bot-login` and update the Vercel env var.',
      );
    }

    const SteamUserClass = loadSteamUser();
    const client = new SteamUserClass({ autoRelogin: false });
    // Settled per batch: resolves once every group of the batch answered.
    let waiting: { ids: Set<string>; done: () => void } | null = null;
    let lastAnswerAt = 0;
    client.on('group', (steamId, group) => {
      const id = steamId.getSteamID64();
      const count = group.user_counts?.members;
      if (typeof count !== 'number' || !Number.isFinite(count)) return;
      members.set(id, count);
      lastAnswerAt = Date.now();
      if (waiting?.ids.delete(id) && waiting.ids.size === 0) waiting.done();
    });

    try {
      await this.logOn(client, this.refreshToken);
      for (let i = 0; i < clanIds.length; i += BATCH_SIZE) {
        if (Date.now() + BATCH_MAX_MS > deadline) break;
        const batch = clanIds.slice(i, i + BATCH_SIZE);
        const ids = new Set(batch.filter((id) => !members.has(id)));
        if (ids.size === 0) continue;
        const startedAt = Date.now();
        lastAnswerAt = startedAt;
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearInterval(timer);
            waiting = null;
            resolve();
          };
          const timer = setInterval(() => {
            const now = Date.now();
            if (
              now - lastAnswerAt >= BATCH_QUIET_MS ||
              now - startedAt >= BATCH_MAX_MS
            ) {
              finish();
            }
          }, 250);
          waiting = { ids, done: finish };
          client._send(
            { msg: EMSG_GET_CLAN_ACTIVITY_COUNTS, proto: {} },
            encodeClanIds([...ids]),
          );
        });
        await new Promise((r) => setTimeout(r, BATCH_GAP_MS));
      }
    } finally {
      client.logOff();
      client.removeAllListeners();
      // A late disconnect error must not crash the process.
      client.on('error', () => undefined);
    }

    const missing = clanIds.filter((id) => !members.has(id));
    this.logger.log(
      `[steam-network] ${members.size}/${clanIds.length} group(s) answered`,
    );
    return { members, missing };
  }

  private logOn(client: SteamUser, refreshToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Steam logon timed out')),
        LOGON_TIMEOUT_MS,
      );
      client.on('loggedOn', () => {
        clearTimeout(timer);
        resolve();
      });
      client.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Steam logon failed: ${error.message}`));
      });
      client.logOn({ refreshToken });
    });
  }
}

/** `CMsgClientGetClanActivityCounts { repeated uint64 steamid_clans = 1; }`. */
function encodeClanIds(clanIds: string[]): Buffer {
  const bytes: number[] = [];
  for (const id of clanIds) {
    bytes.push(0x08); // field 1, varint
    let value = BigInt(id);
    do {
      let byte = Number(value & 0x7fn);
      value >>= 7n;
      if (value > 0n) byte |= 0x80;
      bytes.push(byte);
    } while (value > 0n);
  }
  return Buffer.from(bytes);
}
