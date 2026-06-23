import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseInitService } from './database-init.service';
import { runPendingMigrations } from './migration-runner';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) {
          throw new Error('DATABASE_URL is required');
        }
        const isProd = process.env.NODE_ENV === 'production';

        // Run migrations against the direct (non-pooled) URL when provided.
        // The runtime DataSource below can stay on the pooler URL — only DDL
        // is sensitive to transaction-mode pooling. See migration-runner.ts.
        await runPendingMigrations({
          url: config.get<string>('DATABASE_URL_DIRECT') ?? url,
          isProd,
        });

        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: false,
          ssl: isProd ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
  providers: [DatabaseInitService],
})
export class DatabaseModule {}
