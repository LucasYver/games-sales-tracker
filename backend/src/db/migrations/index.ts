import type { MixedList } from 'typeorm';
import { NormalizeJsonbDefaults1782199739719 } from './1782199739719-NormalizeJsonbDefaults';
import { AddEstimationMethodRegistry1782205443622 } from './1782205443622-AddEstimationMethodRegistry';
import { AddLifecycleFamilyAndFirstWeekMethod1782219035410 } from './1782219035410-AddLifecycleFamilyAndFirstWeekMethod';
import { AddGenreProfileAndGenre1782220528695 } from './1782220528695-AddGenreProfileAndGenre';
import { AddGenreLifecycle1782221904142 } from './1782221904142-AddGenreLifecycle';

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
  AddEstimationMethodRegistry1782205443622,
  AddLifecycleFamilyAndFirstWeekMethod1782219035410,
  AddGenreProfileAndGenre1782220528695,
  AddGenreLifecycle1782221904142,
];
