import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import {
  ExpressAdapter,
  NestExpressApplication,
} from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import express from 'express';
import type { Request, Response } from 'express';

const server = express();
let isInitialized = false;

async function initApp() {
  if (!isInitialized) {
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule,
      new ExpressAdapter(server),
    );
    // Raised from the 100kb default: SteamDB CCU CSV uploads (years of
    // daily rows) routinely exceed it.
    app.useBodyParser('json', { limit: '10mb' });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',');
    app.enableCors({ origin: origins });
    await app.init();
    isInitialized = true;
  }
  return server;
}

export default async function handler(req: Request, res: Response) {
  const app = await initApp();
  app(req, res);
}
