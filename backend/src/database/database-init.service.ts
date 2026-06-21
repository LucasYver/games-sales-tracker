import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseInitService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Runs after TypeORM has synchronized the schema. Enables trigram matching
  // and indexes the game name for fast, typo-tolerant search.
  async onApplicationBootstrap() {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS "game_name_trgm_idx"
           ON "game" USING GIN ("name" gin_trgm_ops);`,
      );
      this.logger.log('Trigram extension and index ensured.');
    } catch (error) {
      this.logger.error(`Failed to ensure trigram search: ${error}`);
    }
  }
}
