import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseInitService } from './database-init.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Prototype convenience: TypeORM keeps the schema in sync with the
        // entities. Switch to migrations before production.
        synchronize: true,
      }),
    }),
  ],
  providers: [DatabaseInitService],
})
export class DatabaseModule {}
