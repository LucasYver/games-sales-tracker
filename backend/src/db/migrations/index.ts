import type { MixedList } from 'typeorm';
import { NormalizeJsonbDefaults1782199739719 } from './1782199739719-NormalizeJsonbDefaults';

/**
 * Explicit list of TypeORM migrations. We import each migration class here
 * (instead of using a filesystem glob) so that the Vercel/`@vercel/node`
 * bundler — which performs static import analysis — actually includes the
 * compiled migration files in the serverless function output. Append the
 * newly generated migration class to this array each time you run
 * `npm run migration:generate`.
 */
export const migrations: MixedList<Function | string> = [
  NormalizeJsonbDefaults1782199739719,
];
