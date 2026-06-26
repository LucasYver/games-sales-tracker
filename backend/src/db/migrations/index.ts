import type { MixedList } from 'typeorm';
import { NormalizeJsonbDefaults1782199739719 } from './1782199739719-NormalizeJsonbDefaults';
import { AddEstimationMethodRegistry1782205443622 } from './1782205443622-AddEstimationMethodRegistry';
import { AddLifecycleFamilyAndFirstWeekMethod1782219035410 } from './1782219035410-AddLifecycleFamilyAndFirstWeekMethod';
import { AddGenreProfileAndGenre1782220528695 } from './1782220528695-AddGenreProfileAndGenre';
import { AddGenreLifecycle1782221904142 } from './1782221904142-AddGenreLifecycle';
import { AddPlatformSplitFamilyAndGenreSplitMethods1782223100959 } from './1782223100959-AddPlatformSplitFamilyAndGenreSplitMethods';
import { SeedSteamGenreAliases1782223525877 } from './1782223525877-SeedSteamGenreAliases';
import { AddGenrePeakCcuToWeekOne1782224894116 } from './1782224894116-AddGenrePeakCcuToWeekOne';
import { AddPureEstimateToSnapshot1782227318714 } from './1782227318714-AddPureEstimateToSnapshot';
import { AddPureBreakdownToSnapshot1782228030613 } from './1782228030613-AddPureBreakdownToSnapshot';
import { AddIsReferenceToSalesEstimate1782228710396 } from './1782228710396-AddIsReferenceToSalesEstimate';
import { RemoveIsReferenceFromSalesEstimate1782243179245 } from './1782243179245-RemoveIsReferenceFromSalesEstimate';
import { AddPsToXboxGenreSplitMethod1782253500000 } from './1782253500000-AddPsToXboxGenreSplitMethod';
import { CleanupXboxRatingsData1782253600000 } from './1782253600000-CleanupXboxRatingsData';
import { RenameSalesRecordToMilestone1782260000000 } from './1782260000000-RenameSalesRecordToMilestone';
import { AddSteamCategoriesDlcAndPriceSnapshot1782395875937 } from './1782395875937-AddSteamCategoriesDlcAndPriceSnapshot';
import { AddGameGenreProfileOverride1782396500000 } from './1782396500000-AddGameGenreProfileOverride';
import { RecalibrateActionRpgProjection1782397000000 } from './1782397000000-RecalibrateActionRpgProjection';
import { RecalibrateSimulationPeakCcuRatio1782397500000 } from './1782397500000-RecalibrateSimulationPeakCcuRatio';
import { AddGameGenreProfileAuto1782398000000 } from './1782398000000-AddGameGenreProfileAuto';
import { AddRtsGenreProfile1782398500000 } from './1782398500000-AddRtsGenreProfile';
import { AddBoxleiterDefaultsToGenreProfile1782463321472 } from './1782463321472-AddBoxleiterDefaultsToGenreProfile';
import { DropMilestonePlatform1782467589649 } from './1782467589649-DropMilestonePlatform';
import { DropGenreProfileConfidence1782470000000 } from './1782470000000-DropGenreProfileConfidence';
import { DropConfidenceFromSalesEstimate1782490393633 } from './1782490393633-DropConfidenceFromSalesEstimate';

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
  AddPlatformSplitFamilyAndGenreSplitMethods1782223100959,
  SeedSteamGenreAliases1782223525877,
  AddGenrePeakCcuToWeekOne1782224894116,
  AddPureEstimateToSnapshot1782227318714,
  AddPureBreakdownToSnapshot1782228030613,
  AddIsReferenceToSalesEstimate1782228710396,
  RemoveIsReferenceFromSalesEstimate1782243179245,
  AddPsToXboxGenreSplitMethod1782253500000,
  CleanupXboxRatingsData1782253600000,
  RenameSalesRecordToMilestone1782260000000,
  AddSteamCategoriesDlcAndPriceSnapshot1782395875937,
  AddGameGenreProfileOverride1782396500000,
  RecalibrateActionRpgProjection1782397000000,
  RecalibrateSimulationPeakCcuRatio1782397500000,
  AddGameGenreProfileAuto1782398000000,
  AddRtsGenreProfile1782398500000,
  AddBoxleiterDefaultsToGenreProfile1782463321472,
  DropMilestonePlatform1782467589649,
  DropGenreProfileConfidence1782470000000,
  DropConfidenceFromSalesEstimate1782490393633,
];
