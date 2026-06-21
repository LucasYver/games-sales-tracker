import { SalesSource, SourceCategory } from '../entities';

export interface SeedSource {
  slug: string;
  name: string;
  category: SourceCategory;
  salesSource: SalesSource;
  host: string | null;
  handle: string | null;
  url: string | null;
  language: string;
  weight: number;
  searchUrlTemplate?: string | null;
  feedUrl?: string | null;
}

// Curated registry of trusted sales-information sources. Figures are only
// trusted when they come from one of these; each declares the sales tier it
// maps to and a reliability weight (1-100).
export const TRUSTED_SOURCES: SeedSource[] = [
  // --- Official investor relations / publisher channels (OFFICIAL) ---
  { slug: 'nintendo-ir', name: 'Nintendo Investor Relations', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'nintendo.co.jp', handle: null, url: 'https://www.nintendo.co.jp/ir/en/', language: 'en', weight: 100 },
  { slug: 'sony-ir', name: 'Sony Group Investor Relations', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'sony.com', handle: null, url: 'https://www.sony.com/en/SonyInfo/IR/', language: 'en', weight: 100 },
  { slug: 'microsoft-ir', name: 'Microsoft Investor Relations', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'microsoft.com', handle: null, url: 'https://www.microsoft.com/en-us/investor', language: 'en', weight: 95 },
  { slug: 'take-two-ir', name: 'Take-Two Interactive IR', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'take2games.com', handle: null, url: 'https://ir.take2games.com/', language: 'en', weight: 100 },
  { slug: 'ea-ir', name: 'Electronic Arts IR', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'ea.com', handle: null, url: 'https://ir.ea.com/', language: 'en', weight: 100 },
  { slug: 'ubisoft-ir', name: 'Ubisoft Investor Relations', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'ubisoft.com', handle: null, url: 'https://www.ubisoft.com/en-us/company/investors', language: 'en', weight: 100 },
  { slug: 'cdprojekt-ir', name: 'CD Projekt Investor Relations', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.OFFICIAL, host: 'cdprojekt.com', handle: null, url: 'https://www.cdprojekt.com/en/investors/', language: 'en', weight: 100 },
  { slug: 'playstation-blog', name: 'PlayStation Blog', category: SourceCategory.OFFICIAL_IR, salesSource: SalesSource.ANNOUNCEMENT, host: 'blog.playstation.com', handle: null, url: 'https://blog.playstation.com/', language: 'en', weight: 90 },

  // --- Market analysts (MEDIA tier, high weight) ---
  { slug: 'circana', name: 'Circana (ex-NPD)', category: SourceCategory.ANALYST, salesSource: SalesSource.MEDIA, host: 'circana.com', handle: null, url: 'https://www.circana.com/', language: 'en', weight: 90 },
  { slug: 'niko-partners', name: 'Niko Partners', category: SourceCategory.ANALYST, salesSource: SalesSource.MEDIA, host: 'nikopartners.com', handle: null, url: 'https://nikopartners.com/', language: 'en', weight: 85 },
  { slug: 'gamediscoverco', name: 'GameDiscoverCo', category: SourceCategory.ANALYST, salesSource: SalesSource.MEDIA, host: 'gamediscover.co', handle: null, url: 'https://newsletter.gamediscover.co/', language: 'en', weight: 82 },
  { slug: 'ampere-analysis', name: 'Ampere Analysis', category: SourceCategory.ANALYST, salesSource: SalesSource.MEDIA, host: 'ampereanalysis.com', handle: null, url: 'https://www.ampereanalysis.com/', language: 'en', weight: 80 },

  // --- Press / editorial outlets (MEDIA tier) ---
  { slug: 'gamesindustry-biz', name: 'GamesIndustry.biz', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'gamesindustry.biz', handle: null, url: 'https://www.gamesindustry.biz/', language: 'en', weight: 85, searchUrlTemplate: 'https://www.gamesindustry.biz/search?q={q}', feedUrl: 'https://www.gamesindustry.biz/feed' },
  { slug: 'vgc', name: 'Video Games Chronicle', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'videogameschronicle.com', handle: null, url: 'https://www.videogameschronicle.com/', language: 'en', weight: 78, searchUrlTemplate: 'https://www.videogameschronicle.com/?s={q}', feedUrl: 'https://www.videogameschronicle.com/feed/' },
  { slug: 'eurogamer', name: 'Eurogamer', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'eurogamer.net', handle: null, url: 'https://www.eurogamer.net/', language: 'en', weight: 72, searchUrlTemplate: 'https://www.eurogamer.net/search?q={q}', feedUrl: 'https://www.eurogamer.net/feed' },
  { slug: 'pc-gamer', name: 'PC Gamer', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'pcgamer.com', handle: null, url: 'https://www.pcgamer.com/', language: 'en', weight: 65, searchUrlTemplate: 'https://www.pcgamer.com/search/?searchTerm={q}', feedUrl: 'https://www.pcgamer.com/rss/' },
  { slug: 'famitsu', name: 'Famitsu', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'famitsu.com', handle: null, url: 'https://www.famitsu.com/', language: 'ja', weight: 82 },
  { slug: 'ign', name: 'IGN', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'ign.com', handle: null, url: 'https://www.ign.com/', language: 'en', weight: 62, feedUrl: 'https://feeds.feedburner.com/ign/all' },
  { slug: 'push-square', name: 'Push Square', category: SourceCategory.MEDIA, salesSource: SalesSource.MEDIA, host: 'pushsquare.com', handle: null, url: 'https://www.pushsquare.com/', language: 'en', weight: 60, searchUrlTemplate: 'https://www.pushsquare.com/search?q={q}', feedUrl: 'https://www.pushsquare.com/feeds/latest' },
];
