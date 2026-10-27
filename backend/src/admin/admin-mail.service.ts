import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AdminUser } from '../entities';
import { publicAppUrl } from '../blog/blog.types';

/**
 * Transactional admin emails via Resend's HTTP API.
 * No-op (warn) when RESEND_API_KEY is unset so local/bootstrap still works.
 */
@Injectable()
export class AdminMailService {
  private readonly logger = new Logger(AdminMailService.name);

  constructor(
    @InjectRepository(AdminUser)
    private readonly admins: Repository<AdminUser>,
  ) {}

  async sendAdminAccountCreated(toEmail: string): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn(
        `Skipping welcome email to ${toEmail} — RESEND_API_KEY is not set`,
      );
      return;
    }

    const from =
      process.env.RESEND_FROM_EMAIL?.trim() ||
      'Game Sales Tracker <onboarding@resend.dev>';
    const adminUrl = this.adminLoginUrl();
    const subject = 'Your admin account is ready';
    const html = buildWelcomeHtml({ email: toEmail, adminUrl });
    const text = [
      'Game Sales Tracker — Admin',
      '',
      'An admin account has just been created for you.',
      '',
      `Sign in: ${adminUrl}`,
      '',
      `Account: ${toEmail}`,
      '',
      'If you did not expect this, ignore this email and tell the person who manages the allowlist.',
    ].join('\n');

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [toEmail],
          subject,
          html,
          text,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `Resend failed for ${toEmail} (${res.status}): ${body}`,
        );
        return;
      }
      this.logger.log(`Welcome email sent to ${toEmail}`);
    } catch (err) {
      this.logger.error(
        `Resend request failed for ${toEmail}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async sendBlogDraftReady(post: {
    id: string;
    gameName: string | null;
    titles: Record<string, string>;
    issueCount: number;
    unverifiedCount: number;
    isRefresh?: boolean;
    translations?: { locale: string; tldr: string[] }[];
    factPack?: Record<string, unknown>;
  }): Promise<void> {
    const tldr = post.translations?.find((t) => t.locale === 'en')?.tldr ?? [];
    const latestFigure = latestFigureLabel(post.factPack);
    const kind = post.isRefresh ? 'Update ready' : 'Draft ready';
    const subject = `${kind} — ${post.gameName ?? 'Untitled'} · ${latestFigure ?? 'review needed'}`;
    const reviewUrl = `${publicAppUrl()}/admin/blog/${post.id}`;
    const html = buildDraftReadyHtml({
      gameName: post.gameName ?? 'Untitled',
      titleEn: post.titles.en ?? '',
      titleFr: post.titles.fr ?? '',
      tldr,
      issueCount: post.issueCount,
      unverifiedCount: post.unverifiedCount,
      reviewUrl,
      heading: post.isRefresh
        ? 'Article update to review'
        : 'New blog draft to review',
    });
    const text = [
      post.isRefresh
        ? `Updated figures for ${post.gameName ?? 'Untitled'}: a new version of the live article is ready. The current version stays online until you publish.`
        : `New blog draft to review: ${post.gameName ?? 'Untitled'}`,
      '',
      `EN: ${post.titles.en ?? ''}`,
      `FR: ${post.titles.fr ?? ''}`,
      '',
      ...tldr.map((line) => `• ${line}`),
      '',
      `Editor issues: ${post.issueCount}. Unverified numbers: ${post.unverifiedCount}.`,
      '',
      `Review: ${reviewUrl}`,
      '',
      'Nothing is public until you publish.',
    ].join('\n');
    await this.sendToAdmins(subject, html, text);
  }

  async sendBlogDraftDigest(
    drafts: {
      id: string;
      gameName: string | null;
      generatedAt: Date | null;
      issueCount: number;
    }[],
  ): Promise<void> {
    if (drafts.length === 0) return;
    const subject = `Blog drafts waiting — ${drafts.length} to review`;
    const html = buildDigestHtml(drafts);
    const text = [
      `${drafts.length} blog draft(s) still waiting for review.`,
      '',
      ...drafts.map(
        (d) =>
          `- ${d.gameName ?? 'Untitled'} (${d.issueCount} issues) ${publicAppUrl()}/admin/blog/${d.id}`,
      ),
    ].join('\n');
    await this.sendToAdmins(subject, html, text);
  }

  private async sendToAdmins(
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    const recipients = await this.admins.find({
      where: { disabledAt: IsNull() },
      select: { email: true },
    });
    for (const user of recipients) {
      await this.sendRaw(user.email, subject, html, text);
    }
  }

  private async sendRaw(
    toEmail: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      this.logger.warn(
        `Skipping email to ${toEmail} — RESEND_API_KEY is not set`,
      );
      return;
    }
    const from =
      process.env.RESEND_FROM_EMAIL?.trim() ||
      'Game Sales Tracker <onboarding@resend.dev>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [toEmail], subject, html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(
          `Resend failed for ${toEmail} (${res.status}): ${body}`,
        );
        return;
      }
      this.logger.log(`Email sent to ${toEmail}: ${subject}`);
    } catch (err) {
      this.logger.error(
        `Resend request failed for ${toEmail}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private adminLoginUrl(): string {
    return `${publicAppUrl()}/admin/login`;
  }
}

/** Chart Room palette — matches public `.chart-scope` in globals.css. */
function buildWelcomeHtml(opts: { email: string; adminUrl: string }): string {
  const { email, adminUrl } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin account ready</title>
</head>
<body style="margin:0;padding:0;background:#0e1420;color:#cfd8e3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0e1420;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#141b28;border:1px solid #26303f;border-radius:4px;">
          <tr>
            <td style="padding:24px 28px 8px;border-bottom:1px solid #26303f;">
              <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:700;letter-spacing:-0.02em;color:#cfd8e3;">
                Game Sales Tracker
              </p>
              <p style="margin:6px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#7c8a9a;">
                Admin
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 12px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:20px;font-weight:600;color:#cfd8e3;line-height:1.3;">
                An admin account has been created
              </h1>
              <p style="margin:0 0 20px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#7c8a9a;">
                You can sign in to the back-office with
                <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfd8e3;">${escapeHtml(email)}</span>
                and the password that was set for you.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:4px;background:#d9a441;">
                    <a href="${escapeAttr(adminUrl)}"
                       style="display:inline-block;padding:12px 20px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#0e1013;text-decoration:none;">
                      Open admin
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.5;color:#5a6675;word-break:break-all;">
                ${escapeHtml(adminUrl)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #1d2634;">
              <p style="margin:0;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5a6675;">
                If you did not expect this account, ignore this email and contact whoever manages the allowlist.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function latestFigureLabel(factPack?: Record<string, unknown>): string | null {
  const facts = factPack?.facts;
  if (!Array.isArray(facts)) return null;
  const sales = facts.filter(
    (f): f is { kind: string; value: number; sourceName: string } =>
      Boolean(
        f &&
        typeof f === 'object' &&
        (f as { kind?: string }).kind === 'sales' &&
        typeof (f as { value?: unknown }).value === 'number',
      ),
  );
  const first = sales[0];
  if (!first) return null;
  const n = first.value;
  const compact =
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : n >= 1_000
        ? `${Math.round(n / 1_000)}k`
        : String(n);
  return `${compact} (${first.sourceName})`;
}

function buildDraftReadyHtml(opts: {
  gameName: string;
  titleEn: string;
  titleFr: string;
  tldr: string[];
  issueCount: number;
  unverifiedCount: number;
  reviewUrl: string;
  heading: string;
}): string {
  const bullets = opts.tldr
    .map(
      (line) =>
        `<li style="margin:0 0 6px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#cfd8e3;">${escapeHtml(line)}</li>`,
    )
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Draft ready</title>
</head>
<body style="margin:0;padding:0;background:#0e1420;color:#cfd8e3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0e1420;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#141b28;border:1px solid #26303f;border-radius:4px;">
          <tr>
            <td style="padding:24px 28px 8px;border-bottom:1px solid #26303f;">
              <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:700;color:#cfd8e3;">Game Sales Tracker</p>
              <p style="margin:6px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#7c8a9a;">${escapeHtml(opts.heading)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 8px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:20px;font-weight:600;color:#cfd8e3;">${escapeHtml(opts.gameName)}</h1>
              <p style="margin:0 0 4px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:13px;color:#7c8a9a;">EN — ${escapeHtml(opts.titleEn)}</p>
              <p style="margin:0 0 16px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:13px;color:#7c8a9a;">FR — ${escapeHtml(opts.titleFr)}</p>
              <ul style="margin:0 0 16px;padding-left:18px;">${bullets}</ul>
              <p style="margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#7c8a9a;">
                ${opts.issueCount} editor issue(s) · ${opts.unverifiedCount} unverified number(s)
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-radius:4px;background:#d9a441;">
                    <a href="${escapeAttr(opts.reviewUrl)}" style="display:inline-block;padding:12px 20px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#0e1013;text-decoration:none;">Review draft</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #1d2634;">
              <p style="margin:0;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:12px;color:#5a6675;">Nothing is public until you publish.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildDigestHtml(
  drafts: {
    id: string;
    gameName: string | null;
    generatedAt: Date | null;
    issueCount: number;
  }[],
): string {
  const rows = drafts
    .map((d) => {
      const when = d.generatedAt
        ? new Date(d.generatedAt).toISOString().slice(0, 10)
        : '—';
      const url = `${publicAppUrl()}/admin/blog/${d.id}`;
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #1d2634;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:14px;color:#cfd8e3;">
          <a href="${escapeAttr(url)}" style="color:#d9a441;text-decoration:none;">${escapeHtml(d.gameName ?? 'Untitled')}</a>
          <span style="color:#7c8a9a;"> · ${escapeHtml(when)} · ${d.issueCount} issues</span>
        </td>
      </tr>`;
    })
    .join('');
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#0e1420;color:#cfd8e3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0e1420;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#141b28;border:1px solid #26303f;border-radius:4px;">
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;font-weight:700;color:#cfd8e3;">Game Sales Tracker</p>
          <h1 style="margin:0 0 16px;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:20px;color:#cfd8e3;">Drafts still waiting</h1>
          <table role="presentation" width="100%">${rows}</table>
          <p style="margin:16px 0 0;font-family:DM Sans,Helvetica,Arial,sans-serif;font-size:12px;color:#5a6675;">Nothing is public until you publish.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
