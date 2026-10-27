import { findUnverifiedNumbers, parseHumanNumber } from './blog-number-check';
import type { BlogFact } from './blog.types';

function fact(value: number, date: string | null = null): BlogFact {
  return {
    id: 'F1',
    kind: 'sales',
    value,
    unit: 'copies',
    platform: 'GLOBAL',
    source: 'OFFICIAL',
    sourceName: 'Capcom',
    date,
    isEngagement: false,
    isAlinea: false,
  };
}

function body(bodyMarkdown: string) {
  return {
    title: '',
    metaDescription: '',
    excerpt: '',
    tldr: [],
    bodyMarkdown,
    faq: [],
  };
}

const FACTS = [fact(5_200_000, '2025-03-12'), fact(1_200_000, '2024-01-28')];

describe('parseHumanNumber', () => {
  it.each([
    ['5.2 million', 5_200_000],
    ['5,2 millions', 5_200_000],
    ['1 200 000', 1_200_000],
    ['1 200 000', 1_200_000],
    ['1 200 000', 1_200_000],
    ['1,200,000', 1_200_000],
    ['1.200.000', 1_200_000],
    ['1,200', 1_200],
    ['1,5 milliard', 1_500_000_000],
    ['2.1bn', 2_100_000_000],
    ['5.2M', 5_200_000],
    ['850k', 850_000],
  ])('%s → %d', (raw, expected) => {
    expect(parseHumanNumber(raw)).toBeCloseTo(expected);
  });
});

describe('findUnverifiedNumbers', () => {
  it('accepts fact values written in EN and FR styles', () => {
    const text =
      'Capcom said in March 2025 the game had sold 5.2 million copies. ' +
      'En janvier 2024, 1 200 000 exemplaires, puis 5,2 millions.';
    expect(findUnverifiedNumbers(body(text), FACTS)).toEqual([]);
  });

  it('does not read month names as a million suffix', () => {
    expect(
      findUnverifiedNumbers(body('le 12 mars 2025, on 28 January 2024'), FACTS),
    ).toEqual([]);
    expect(findUnverifiedNumbers(body('in 2 months'), FACTS)).toEqual([]);
  });

  it('flags invented figures and derived numbers', () => {
    expect(
      findUnverifiedNumbers(
        body('It sold 6 millions, a 30% jump, about 4 million more.'),
        FACTS,
      ),
    ).toEqual(['6 millions', '30', '4 million']);
  });

  it('reads milliard as a billion, not a million', () => {
    expect(
      findUnverifiedNumbers(body('1,2 milliard'), [fact(1_200_000)]),
    ).toEqual(['1,2 milliard']);
  });

  it('allows numbers that belong to the game name', () => {
    expect(
      findUnverifiedNumbers(body('Cyberpunk 2077 sold 5.2 million'), FACTS, [
        'Cyberpunk 2077',
      ]),
    ).toEqual([]);
  });

  it('ignores link targets', () => {
    expect(
      findUnverifiedNumbers(
        body('[live data](https://example.com/en/game/fifa-23-998)'),
        FACTS,
      ),
    ).toEqual([]);
  });
});
