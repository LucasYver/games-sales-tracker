/** A game as far as its displayed name goes. */
interface NamedGame {
  name: string;
  /** Steam store name per locale, only where it differs from `name`. */
  localizedNames?: Record<string, string> | null;
}

/**
 * The game's name on a `locale` page: its Steam store name in that language
 * when it differs (黑神话：悟空 on /zh-CN), else the English name.
 */
export function gameName(game: NamedGame, locale: string): string {
  return game.localizedNames?.[locale] ?? game.name;
}

/**
 * The localized name followed by the English one, so a meta description still
 * matches searches in English: 黑神话：悟空（Black Myth: Wukong）.
 */
export function gameNameWithOriginal(game: NamedGame, locale: string): string {
  const local = gameName(game, locale);
  if (local === game.name) return local;
  return locale === 'zh-CN'
    ? `${local}（${game.name}）`
    : `${local} (${game.name})`;
}
