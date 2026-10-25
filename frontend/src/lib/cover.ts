/** How to display `game.coverUrl` — IGDB box art is portrait, Steam headers are wide. */

export type CoverKind = 'portrait' | 'landscape';

export function displayCover(url: string): { src: string; kind: CoverKind } {
  if (url.includes('images.igdb.com') && /\/t_cover/.test(url)) {
    return {
      src: url.replace('/t_cover_big/', '/t_cover_big_2x/'),
      kind: 'portrait',
    };
  }
  if (/\/apps\/\d+\/header/i.test(url)) {
    return {
      src: url.replace(/\/header(\.[a-z]+)$/i, '/capsule_616x353$1'),
      kind: 'landscape',
    };
  }
  return { src: url, kind: 'portrait' };
}
