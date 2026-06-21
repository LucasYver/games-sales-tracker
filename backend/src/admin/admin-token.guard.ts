import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Single-token admin guard. The token is configured via the `ADMIN_TOKEN`
 * environment variable and must be presented on every admin request through
 * the `X-Admin-Token` header. If the env var is not set, the guard refuses
 * everything (fail-closed) so the admin surface is never exposed by accident.
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  private readonly logger = new Logger(AdminTokenGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected) {
      this.logger.warn('ADMIN_TOKEN is not set — admin endpoints are disabled.');
      throw new UnauthorizedException('Admin endpoints disabled');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('X-Admin-Token');
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing admin token');
    }
    return true;
  }
}
