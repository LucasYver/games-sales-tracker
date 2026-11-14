import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';

const TWEETS_URL = 'https://api.x.com/2/tweets';
const MEDIA_URL = 'https://api.x.com/2/media/upload';
// X takes images up to 5 MB; share cards are a few hundred KB.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Posts on the site's X account (X API v2, pay-per-use: about $0.015 a post
 * without a link, $0.20 with one — so posts carry no link; the attached share
 * card is reportedly billed as one more post). Signed with
 * OAuth 1.0a user context. Env: `X_API_KEY`, `X_API_SECRET`,
 * `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (they do not expire).
 */
@Injectable()
export class XClient {
  private readonly logger = new Logger(XClient.name);

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

  /**
   * Posts `text`, with the share card of `imagePageUrl` attached when it can
   * be fetched and uploaded (X carries no link, so the card stands in for the
   * preview). An image that fails never blocks the post.
   */
  async publishText(
    text: string,
    imagePageUrl?: string,
  ): Promise<{ id: string; url: string; withImage: boolean }> {
    const keys = this.keys();
    if (!keys) throw new Error('X API keys are not set.');
    let mediaId: string | null = null;
    if (imagePageUrl) {
      try {
        mediaId = await this.uploadShareCard(imagePageUrl, keys);
      } catch (error) {
        this.logger.warn(`X image skipped: ${error}`);
      }
    }
    const res = await fetch(TWEETS_URL, {
      method: 'POST',
      headers: {
        Authorization: oauthHeader('POST', TWEETS_URL, keys),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        mediaId ? { text, media: { media_ids: [mediaId] } } : { text },
      ),
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
      withImage: mediaId !== null,
    };
  }

  /**
   * Reads the page's `og:image` (the site's own share card), downloads it and
   * uploads it to X in one call. Returns the media id.
   */
  private async uploadShareCard(
    pageUrl: string,
    keys: Parameters<typeof oauthHeader>[2],
  ): Promise<string> {
    const html = await (await fetch(pageUrl)).text();
    const imageUrl = ogImage(html);
    if (!imageUrl) throw new Error(`no og:image on ${pageUrl}`);
    const image = await fetch(new URL(imageUrl, pageUrl));
    if (!image.ok) throw new Error(`share card ${image.status}`);
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`share card is ${bytes.byteLength} bytes`);
    }
    const form = new FormData();
    form.append(
      'media',
      new Blob([bytes], {
        type: image.headers.get('content-type') ?? 'image/png',
      }),
      'card.png',
    );
    form.append('media_category', 'tweet_image');
    // Multipart fields are not part of an OAuth 1.0a signature.
    const res = await fetch(MEDIA_URL, {
      method: 'POST',
      headers: { Authorization: oauthHeader('POST', MEDIA_URL, keys) },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      media_id_string?: string;
      detail?: string;
      title?: string;
    };
    const id = body.data?.id ?? body.media_id_string;
    if (!res.ok || !id) {
      throw new Error(
        `upload failed (${res.status}): ${body.detail ?? body.title ?? 'unknown error'}`,
      );
    }
    return id;
  }
}

/** The `og:image` URL of a page, whatever the attribute order. */
function ogImage(html: string): string | null {
  for (const tag of html.match(/<meta[^>]+>/gi) ?? []) {
    if (!/property=["']og:image["']/i.test(tag)) continue;
    const content = /content=["']([^"']+)["']/i.exec(tag)?.[1];
    if (content) return content.replace(/&amp;/g, '&');
  }
  return null;
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
