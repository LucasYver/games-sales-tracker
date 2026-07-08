import { ConfigService } from '@nestjs/config';
import { Platform } from '../entities';
import { IgdbClient } from './igdb.client';

// `mapGame` is private — it's the one place that turns a raw IGDB payload
// into our `IgdbGame` shape, so it's worth covering directly rather than
// through the network-calling public methods.
type MapGame = (raw: unknown) => {
  releaseDate: Date | null;
  platformReleaseDates: Map<Platform, Date>;
};

function mapGame(client: IgdbClient, raw: unknown) {
  return (client as unknown as { mapGame: MapGame }).mapGame(raw);
}

describe('IgdbClient.mapGame — release_dates grouping', () => {
  const client = new IgdbClient(new ConfigService({}));

  it('buckets platform-family release_dates entries and keeps the earliest per bucket', () => {
    // The Last of Us Part I: PS5 launch year ahead of the PC port.
    const result = mapGame(client, {
      id: 1,
      name: 'The Last of Us Part I',
      first_release_date: 1662076800, // 2022-09-02
      release_dates: [
        { date: 1662076800, platform: { name: 'PlayStation 5' } }, // 2022-09-02
        { date: 1677801600, platform: { name: 'PC (Microsoft Windows)' } }, // 2023-03-03
      ],
    });

    expect(result.platformReleaseDates.get(Platform.PLAYSTATION)).toEqual(
      new Date(1662076800 * 1000),
    );
    expect(result.platformReleaseDates.get(Platform.PC)).toEqual(
      new Date(1677801600 * 1000),
    );
    expect(result.platformReleaseDates.size).toBe(2);
  });

  it('keeps the earliest date within a platform family across regional entries', () => {
    const earlier = 1662076800; // 2022-09-02
    const later = 1665792000; // 2022-10-15

    const result = mapGame(client, {
      id: 2,
      name: 'Some Game',
      release_dates: [
        { date: later, platform: { name: 'PlayStation 5' } },
        { date: earlier, platform: { name: 'PlayStation 4' } },
      ],
    });

    // PS4 + PS5 fold into the same PLAYSTATION bucket; the earlier date wins.
    expect(result.platformReleaseDates.get(Platform.PLAYSTATION)).toEqual(
      new Date(earlier * 1000),
    );
  });

  it('skips entries with no date or an unmappable platform', () => {
    const result = mapGame(client, {
      id: 3,
      name: 'Some Game',
      release_dates: [
        { date: undefined, platform: { name: 'PC (Microsoft Windows)' } },
        { date: 1662076800, platform: { name: 'Nintendo Switch' } },
        { date: 1662076800, platform: undefined },
      ],
    });

    expect(result.platformReleaseDates.size).toBe(0);
  });

  it('returns an empty map when IGDB has no release_dates breakdown', () => {
    const result = mapGame(client, { id: 4, name: 'Some Game' });
    expect(result.platformReleaseDates.size).toBe(0);
  });
});
