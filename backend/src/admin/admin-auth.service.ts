import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { hashPassword, verifyPassword } from './password';
import { AdminMailService } from './admin-mail.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

type SessionPayload = {
  sub: string;
  email: string;
  exp: number;
};

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  /** In-memory login rate limit: email → timestamps of recent failures. */
  private readonly loginFailures = new Map<string, number[]>();

  constructor(
    @InjectRepository(AdminUser)
    private readonly users: Repository<AdminUser>,
    private readonly mail: AdminMailService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapFromEnv();
  }

  /**
   * Create the first allowlisted admin from env when the table is empty for
   * that email. Never updates an existing password from env.
   */
  private async bootstrapFromEnv(): Promise<void> {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email || !password) return;

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      this.logger.log(`Bootstrap skipped — admin ${email} already exists`);
      return;
    }

    if (password.length < 12) {
      this.logger.warn(
        'ADMIN_BOOTSTRAP_PASSWORD is shorter than 12 chars — refusing bootstrap',
      );
      return;
    }

    await this.createUser(email, password);
    this.logger.log(`Bootstrapped admin user ${email}`);
  }

  /** Secret used to HMAC session tokens. */
  private sessionSecret(): string | null {
    return process.env.ADMIN_SESSION_SECRET?.trim() || null;
  }

  /** Fail-closed when ADMIN_SESSION_SECRET is unset. */
  isAuthConfigured(): boolean {
    return Boolean(this.sessionSecret());
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private assertNotRateLimited(email: string): void {
    const now = Date.now();
    const recent = (this.loginFailures.get(email) ?? []).filter(
      (t) => now - t < LOGIN_WINDOW_MS,
    );
    this.loginFailures.set(email, recent);
    if (recent.length >= LOGIN_MAX_ATTEMPTS) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  private recordFailure(email: string): void {
    const recent = this.loginFailures.get(email) ?? [];
    recent.push(Date.now());
    this.loginFailures.set(email, recent);
  }

  private clearFailures(email: string): void {
    this.loginFailures.delete(email);
  }

  async login(
    emailRaw: string,
    password: string,
  ): Promise<{ token: string; email: string; expiresAt: string }> {
    if (!this.sessionSecret()) {
      throw new ServiceUnavailableException('Admin auth is not configured');
    }

    const email = this.normalizeEmail(emailRaw);
    this.assertNotRateLimited(email);

    const user = await this.users.findOne({
      where: { email, disabledAt: IsNull() },
    });
    const ok =
      user != null && (await verifyPassword(password, user.passwordHash));
    if (!ok || !user) {
      this.recordFailure(email);
      // Uniform message — no user enumeration.
      throw new UnauthorizedException('Invalid credentials');
    }

    this.clearFailures(email);
    user.lastLoginAt = new Date();
    await this.users.save(user);

    const exp = Date.now() + SESSION_TTL_MS;
    const token = this.signSession({ sub: user.id, email: user.email, exp });
    return {
      token,
      email: user.email,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  async createUser(
    emailRaw: string,
    password: string,
  ): Promise<{ id: string; email: string }> {
    const email = this.normalizeEmail(emailRaw);
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('An admin with this email already exists');
    }

    const user = await this.users.save(
      this.users.create({
        email,
        passwordHash: await hashPassword(password),
      }),
    );

    // Welcome mail is best-effort — never roll back account creation.
    await this.mail.sendAdminAccountCreated(user.email);

    return { id: user.id, email: user.email };
  }

  async listUsers(): Promise<
    Array<{
      id: string;
      email: string;
      lastLoginAt: string | null;
      disabledAt: string | null;
      createdAt: string;
    }>
  > {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      disabledAt: u.disabledAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  signSession(payload: SessionPayload): string {
    const secret = this.sessionSecret();
    if (!secret) {
      throw new ServiceUnavailableException('Admin auth is not configured');
    }
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  /**
   * Validate a session token and return the active user, or null.
   */
  async verifySession(token: string): Promise<AdminUser | null> {
    const secret = this.sessionSecret();
    if (!secret) return null;

    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    const expected = createHmac('sha256', secret)
      .update(body)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    let payload: SessionPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as SessionPayload;
    } catch {
      return null;
    }

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }
    if (payload.exp < Date.now()) return null;

    const user = await this.users.findOne({
      where: { id: payload.sub, disabledAt: IsNull() },
    });
    if (!user || user.email !== payload.email) return null;
    return user;
  }
}
