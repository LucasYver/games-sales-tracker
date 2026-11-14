import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

const TWEETS_URL = 'https://api.x.com/2/tweets';

/**
 * Posts text on the site's X account (X API v2, pay-per-use: about $0.015 a
 * post without a link, $0.20 with one — so posts carry no link). Signed with
 * OAuth 1.0a user context. Env: `X_API_KEY`, `X_API_SECRET`,
 * `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (they do not expire).
 */
@Injectable()
export class XClient {
  private keys() {
    const consumerKey = process.env.X_API_KEY?.trim();
    const consumerSecret = process.env.X_API_SECRET?.trim();
    const token = process.env.X_ACCESS_TOKEN?.trim();
    const tokenSecret = process.env.X_ACCESS_TOKEN_SECRET?.trim();
    if (!consumerKey || !consumerSecret || !token || !tokenSecret) return null;
    return { consumerKey, consumerSecret, token, tokenSecret };
  }

  get configured(): boolean {
    return this.keys() !== null;
  }

  async publishText(text: string): Promise<{ id: string; url: string }> {
    const keys = this.keys();
    if (!keys) throw new Error('X API keys are not set.');
    const res = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: {
        Authorization: oauthHeader('POST', TWEETS_URL, keys),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { id: string };
      title?: string;
      detail?: string;
      errors?: { message?: string }[];
    };
    if (!res.ok || !body.data?.id) {
      const reason =
        body.detail ??
        body.errors?.[0]?.message ??
        body.title ??
        'unknown error';
      throw new Error(`X post failed (${res.status}): ${reason}`);
    }
    return {
      id: body.data.id,
      url: `https://x.com/i/web/status/${body.data.id}`,
    };
  }
}

/** RFC 3986 encoding, as OAuth 1.0a requires. */
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * OAuth 1.0a HMAC-SHA1 header. A JSON body is not part of the signature, and
 * the tweets URL has no query string, so only the oauth_* params are signed.
 */
function oauthHeader(
  method: string,
  url: string,
  keys: {
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
  },
): string {
  const params: Record<string, string> = {
    oauth_consumer_key: keys.consumerKey,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: keys.token,
    oauth_version: '1.0',
  };
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join('&');
  const base = [method.toUpperCase(), encode(url), encode(paramString)].join(
    '&',
  );
  const signingKey = `${encode(keys.consumerSecret)}&${encode(keys.tokenSecret)}`;
  params.oauth_signature = createHmac('sha1', signingKey)
    .update(base)
    .digest('base64');
  return (
    'OAuth ' +
    Object.keys(params)
      .sort()
      .map((k) => `${encode(k)}="${encode(params[k])}"`)
      .join(', ')
  );
}
