import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(
    ',',
  );
  app.enableCors({ origin: origins });

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
