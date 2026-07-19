---
name: database-connection
description: >-
  Explains how the game-sales-tracker backend connects to its PostgreSQL
  database (TypeORM + pg), how config is provided (DATABASE_URL /
  DATABASE_URL_DIRECT), how to run the DB locally (docker compose, port 5433),
  how migrations work, and the standard code patterns to read/write the DB. Use
  whenever a task involves the database, TypeORM, migrations, entities,
  repositories, raw SQL, connecting from a script, or running the backend
  locally.
---

# Database connection (game-sales-tracker)

## Stack

- **PostgreSQL 16** (`docker-compose.yml`, image `postgres:16-alpine`)
- **TypeORM** `^0.3.30` + **`pg`** driver, integrated via **`@nestjs/typeorm`**
- No Prisma / Drizzle / Knex / SQLite in runtime.

## Config (env vars)

Backend reads env from `backend/.env` (via `ConfigModule.forRoot({ isGlobal: true })`). Copy `backend/.env.example` → `backend/.env`.

| Var | Required | Role |
|-----|----------|------|
| `DATABASE_URL` | Yes | Runtime TypeORM connection. May point at a pooler (Neon/Supabase/pgbouncer). |
| `DATABASE_URL_DIRECT` | Only if `DATABASE_URL` is a transaction-mode pooler | Direct (non-pooled) connection used **exclusively for migrations** (boot + CLI). Falls back to `DATABASE_URL` when unset. |

Local connection string (matches docker-compose):

```
postgresql://gamesales:gamesales@localhost:5433/gamesales
```

- user/password/db: `gamesales` / `gamesales` / `gamesales`
- host/port: `localhost` / **5433** (mapped `5433:5432`)
- SSL: `false` locally, `{ rejectUnauthorized: false }` when `NODE_ENV === 'production'`.

Why two URLs: TypeORM DDL relies on session-scoped state that transaction-mode poolers break, so migrations always use the *direct* URL (`DATABASE_URL_DIRECT ?? DATABASE_URL`), while runtime queries can use the pooler.

## Run locally

From repo root:

```bash
docker compose up -d          # Postgres on 5433 (+ Redis on 6380, not yet used by backend)
```

Then the backend:

```bash
cd backend
cp .env.example .env          # first time only
npm install
npm run start:dev             # API on http://localhost:3001/api
```

On boot, `DatabaseModule` runs pending migrations (against the direct URL) **before** exposing the DataSource, then `DatabaseInitService` creates the `pg_trgm` extension + a GIN trigram index on `game.name`. So in prod/dev you normally don't run `migration:run` manually — starting the app applies them.

## Migrations (TypeORM)

- Files: `backend/src/db/migrations/*.ts`
- **Explicit registry**: `backend/src/db/migrations/index.ts` — every new migration MUST be imported and added to the `migrations[]` array (no glob; Vercel bundler constraint).
- `synchronize: false` — **never enable it**. Any schema change = a migration.
- Full workflow rule: `.cursor/rules/typeorm-migrations.mdc`.

Commands (from `backend/`):

```bash
npm run migration:generate -- src/db/migrations/<MeaningfulName>   # after editing an entity
npm run migration:run
npm run migration:revert
npm run migration:show
```

Caveat: no migration creates the *core* tables (`game`, `estimate_snapshot`, …) — they predate migrations (old `synchronize: true` era). `migration:run` on a truly empty Postgres will likely fail; assume an existing schema.

## Key files

| Role | Path |
|------|------|
| Runtime DataSource (NestJS) | `backend/src/database/database.module.ts` |
| CLI DataSource (typeorm commands) | `backend/src/db/data-source.ts` |
| Boot migration runner (advisory lock) | `backend/src/database/migration-runner.ts` |
| pg_trgm / index init | `backend/src/database/database-init.service.ts` |
| Migration registry | `backend/src/db/migrations/index.ts` |
| Entities (+ barrel `index.ts`) | `backend/src/entities/` |
| Env example | `backend/.env.example` |
| Docker | `docker-compose.yml` |

## Code patterns

### Repository (preferred, in services)

Register entities in the feature module, then inject the repository:

```typescript
// module
TypeOrmModule.forFeature([Game /* , ... */])

// service
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

constructor(
  @InjectRepository(Game) private readonly games: Repository<Game>,
) {}
```

### Raw SQL / DataSource

```typescript
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

await this.dataSource.query('SELECT ...');
```

### Standalone script

Boot a Nest application context (inherits `.env`, runs boot migrations), then grab a service or the DataSource:

```typescript
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';

const app = await NestFactory.createApplicationContext(AppModule);
const dataSource = app.get(DataSource);
await dataSource.query('...');
await app.close();
```

Run scripts from `backend/` (`npm run <script>` or `npx ts-node src/scripts/...`).

For quick read-only inspection outside Nest, `psql` against `DATABASE_URL` from `backend/.env` works too (see `scripts/reset-discovery.sh` for defaults).
