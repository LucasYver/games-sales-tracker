import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Raised from the 100kb default: SteamDB CCU CSV uploads (years of daily
  // rows) routinely exceed it.
  app.useBodyParser('json', { limit: '10mb' });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(
    ',',
  );
  app.enableCors({ origin: origins });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
