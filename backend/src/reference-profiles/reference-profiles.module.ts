import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game, Milestone, ReferenceProfile, SignalSnapshot } from '../entities';
import { ReferenceProfileService } from './reference-profile.service';
import { MatcherService } from './matcher.service';
import { SalesProfileResolverService } from './sales-profile-resolver.service';
import { ReferenceProfilesAdminService } from './reference-profiles-admin.service';

/**
 * Owns the `reference_profile` table, its ETL, the kNN matcher, and
 * the resolver façade the estimation service calls. Consumers depend
 * on this module rather than reaching into individual services so the
 * corpus, the matcher, or the resolver can be swapped without
 * touching the estimation code.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReferenceProfile,
      Game,
      Milestone,
      SignalSnapshot,
    ]),
  ],
  providers: [
    ReferenceProfileService,
    MatcherService,
    SalesProfileResolverService,
    ReferenceProfilesAdminService,
  ],
  exports: [
    ReferenceProfileService,
    MatcherService,
    SalesProfileResolverService,
    ReferenceProfilesAdminService,
  ],
})
export class ReferenceProfilesModule {}
