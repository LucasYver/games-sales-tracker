import { Injectable, Logger } from '@nestjs/common';

/**
 * Transactional admin emails via Resend's HTTP API.
 * No-op (warn) when RESEND_API_KEY is unset so local/bootstrap still works.
 */
@Injectable()
export class AdminMailService {
  private readonly logger = new Logger(AdminMailService.name);

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

  private adminLoginUrl(): string {
    const base = (
      process.env.PUBLIC_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    return `${base}/admin/login`;
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
