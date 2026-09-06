import { CatalogTier } from '../entities';
import { classifyCatalogTier, promoteCatalogTier } from './catalog-tier';

describe('classifyCatalogTier', () => {
  const recentRelease = new Date('2025-01-01T00:00:00Z');

  it('keeps the historical thresholds in the core tier', () => {
    expect(classifyCatalogTier(80, null, recentRelease)).toBe(CatalogTier.CORE);
    expect(classifyCatalogTier(0, 2500, recentRelease)).toBe(CatalogTier.CORE);
  });

  it('admits moderate games in the extended tier', () => {
    expect(classifyCatalogTier(20, null, recentRelease)).toBe(
      CatalogTier.EXTENDED,
    );
    expect(classifyCatalogTier(0, 500, recentRelease)).toBe(
      CatalogTier.EXTENDED,
    );
  });

  it('rejects games below both catalog thresholds', () => {
    expect(classifyCatalogTier(19, 499, recentRelease)).toBeNull();
  });

  it('does not extend the pre-floor catalog', () => {
    const oldRelease = new Date('2010-01-01T00:00:00Z');
    expect(classifyCatalogTier(79, 10000, oldRelease)).toBeNull();
    expect(classifyCatalogTier(500, null, oldRelease)).toBe(CatalogTier.CORE);
  });

  it('promotes extended games without ever demoting core games', () => {
    expect(promoteCatalogTier(CatalogTier.EXTENDED, CatalogTier.CORE)).toBe(
      CatalogTier.CORE,
    );
    expect(promoteCatalogTier(CatalogTier.CORE, CatalogTier.EXTENDED)).toBe(
      CatalogTier.CORE,
    );
  });
});
