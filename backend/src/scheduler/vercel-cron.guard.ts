import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on scheduled cron
 * invocations. This guard validates that header so only Vercel (or a caller
 * with the secret) can trigger cron endpoints.
 */
@Injectable()
export class VercelCronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      throw new UnauthorizedException('CRON_SECRET is not set');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.header('Authorization');
    if (auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException('Invalid cron secret');
    }
    return true;
  }
}
