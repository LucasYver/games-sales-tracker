import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';

/**
 * Admin surface guard. Accepts a signed session in `X-Admin-Session`
 * (or `Authorization: Bearer …`). Fail-closed when `ADMIN_SESSION_SECRET`
 * is unset.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);

  constructor(private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.auth.isAuthConfigured()) {
      this.logger.warn(
        'ADMIN_SESSION_SECRET is not set — admin endpoints disabled.',
      );
      throw new UnauthorizedException('Admin endpoints disabled');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const session =
      req.header('X-Admin-Session') ?? bearerToken(req.header('Authorization'));
    if (session) {
      const user = await this.auth.verifySession(session);
      if (user) {
        (
          req as Request & { adminUser?: { id: string; email: string } }
        ).adminUser = { id: user.id, email: user.email };
        return true;
      }
    }

    throw new UnauthorizedException('Invalid or missing admin credentials');
  }
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
