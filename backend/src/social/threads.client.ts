import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialCredential } from '../entities';

const API = 'https://graph.threads.net/v1.0';
const REFRESH_URL = 'https://graph.threads.net/refresh_access_token';
// A token lasts 60 days and can be refreshed once it is a day old; a weekly
// refresh keeps it far from expiry without calling Meta every day.
const REFRESH_EVERY_MS = 7 * 24 * 3600 * 1000;
// Meta advises waiting for a container to be processed before publishing it.
const PUBLISH_ATTEMPTS = 5;
const PUBLISH_WAIT_MS = 3000;

/**
 * Publishes text posts on the site's Threads account (Meta Threads API,
 * free). The account owner is a tester of the Meta app, so it needs no app
 * review. Env: `THREADS_ACCESS_TOKEN` (long-lived token, seeds
 * `social_credential` once; later tokens come from the weekly refresh).
 */
@Injectable()
export class ThreadsClient {
  private readonly logger = new Logger(ThreadsClient.name);

  constructor(
    @InjectRepository(SocialCredential)
    private readonly credentials: Repository<SocialCredential>,
  ) {}

  async configured(): Promise<boolean> {
    return (await this.token()) !== null;
  }

  /** Publishes a text post with a link preview; returns its id and URL. */
  async publishText(
    text: string,
    linkUrl: string,
  ): Promise<{ id: string; url: string | null }> {
    const token = await this.token();
    if (!token) {
      throw new Error('THREADS_ACCESS_TOKEN is not set.');
    }
    const container = await this.post<{ id: string }>('/me/threads', {
      media_type: 'TEXT',
      text,
      link_attachment: linkUrl,
      access_token: token,
    });

    let published: { id: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < PUBLISH_ATTEMPTS && !published; attempt++) {
      await sleep(PUBLISH_WAIT_MS);
      try {
        published = await this.post<{ id: string }>('/me/threads_publish', {
          creation_id: container.id,
          access_token: token,
        });
      } catch (error) {
        lastError = error;
      }
    }
    if (!published) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Threads publish failed.');
    }

    let url: string | null = null;
    try {
      const media = await this.get<{ permalink?: string }>(`/${published.id}`, {
        fields: 'permalink',
        access_token: token,
      });
      url = media.permalink ?? null;
    } catch (error) {
      this.logger.warn(`Threads permalink lookup failed: ${error}`);
    }
    return { id: published.id, url };
  }

  /**
   * Swaps the stored token for a fresh 60-day one when the last refresh is a
   * week old. Returns what happened, for the cron log.
   */
  async refreshTokenIfDue(): Promise<string> {
    const current = await this.credential();
    if (!current) return 'no Threads token';
    if (Date.now() - current.refreshedAt.getTime() < REFRESH_EVERY_MS) {
      return 'Threads token fresh';
    }
    const res = await fetch(
      `${REFRESH_URL}?${new URLSearchParams({
        grant_type: 'th_refresh_token',
        access_token: current.accessToken,
      })}`,
    );
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || !body.access_token) {
      throw new Error(
        `Threads token refresh failed (${res.status}): ${body.error?.message ?? 'no token'}`,
      );
    }
    await this.credentials.save({
      network: 'THREADS',
      accessToken: body.access_token,
      expiresAt: body.expires_in
        ? new Date(Date.now() + body.expires_in * 1000)
        : null,
      refreshedAt: new Date(),
    });
    return 'Threads token refreshed';
  }

  private async token(): Promise<string | null> {
    return (await this.credential())?.accessToken ?? null;
  }

  /** The stored token, seeded from the env var the first time. */
  private async credential(): Promise<SocialCredential | null> {
    const stored = await this.credentials.findOne({
      where: { network: 'THREADS' },
    });
    if (stored) return stored;
    const seed = process.env.THREADS_ACCESS_TOKEN?.trim();
    if (!seed) return null;
    return this.credentials.save({
      network: 'THREADS',
      accessToken: seed,
      expiresAt: null,
      refreshedAt: new Date(),
    });
  }

  private async post<T>(path: string, params: Record<string, string>) {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      body: new URLSearchParams(params),
    });
    return this.read<T>(res, path);
  }

  private async get<T>(path: string, params: Record<string, string>) {
    const res = await fetch(`${API}${path}?${new URLSearchParams(params)}`);
    return this.read<T>(res, path);
  }

  private async read<T>(res: Response, path: string): Promise<T> {
    const body = (await res.json().catch(() => ({}))) as T & {
      error?: { message?: string; code?: number };
    };
    if (!res.ok || body.error) {
      throw new Error(
        `Threads ${path} failed (${res.status}): ${body.error?.message ?? 'unknown error'}`,
      );
    }
    return body;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
