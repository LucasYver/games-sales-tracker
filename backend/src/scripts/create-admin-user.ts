/**
 * Allowlist helper: create an admin user without public registration.
 *
 *   cd backend && npm run admin:create-user -- you@example.com 'your-long-password'
 *
 * Sends the Chart Room welcome email when RESEND_API_KEY is set.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminAuthService } from '../admin/admin-auth.service';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3];
  if (!email || !password) {
    console.error(
      'Usage: npm run admin:create-user -- <email> <password (>=12 chars)>',
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const auth = app.get(AdminAuthService);
    const user = await auth.createUser(email, password);
    console.log(`Created admin ${user.email} (${user.id})`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
