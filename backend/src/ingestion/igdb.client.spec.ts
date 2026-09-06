import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Platform } from '../entities';
import { IgdbClient } from './igdb.client';

jest.mock('axios');

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

const mockedAxios = axios as jest.Mocked<typeof axios>;

function getAccessToken(client: IgdbClient): Promise<string> {
  return (
    client as unknown as { getAccessToken: () => Promise<string> }
  ).getAccessToken();
}

function httpError(status?: number) {
  return { response: status === undefined ? undefined : { status, data: {} } };
}

describe('IgdbClient.getAccessToken — Twitch outage handling', () => {
  let client: IgdbClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.isAxiosError.mockReturnValue(true);
    // The backoff is only there to space out real network calls; firing it
    // synchronously keeps the retry assertions instant.
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);

    client = new IgdbClient(
      new ConfigService({
        IGDB_CLIENT_ID: 'id',
        IGDB_CLIENT_SECRET: 'secret',
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries a transient Twitch 500 and returns the token', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(httpError(500))
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce({
        data: { access_token: 'tok', expires_in: 3600 },
      });

    await expect(getAccessToken(client)).resolves.toBe('tok');
    expect(mockedAxios.post.mock.calls).toHaveLength(3);
  });

  it('retries when the request never reaches Twitch', async () => {
    mockedAxios.post.mockRejectedValueOnce(httpError()).mockResolvedValueOnce({
      data: { access_token: 'tok', expires_in: 3600 },
    });

    await expect(getAccessToken(client)).resolves.toBe('tok');
    expect(mockedAxios.post.mock.calls).toHaveLength(2);
  });

  it('gives up after exhausting the retries', async () => {
    mockedAxios.post.mockRejectedValue(httpError(500));

    await expect(getAccessToken(client)).rejects.toBeDefined();
    expect(mockedAxios.post.mock.calls).toHaveLength(3);
  });

  it('does not retry rejected credentials', async () => {
    mockedAxios.post.mockRejectedValue(httpError(400));

    await expect(getAccessToken(client)).rejects.toBeDefined();
    expect(mockedAxios.post.mock.calls).toHaveLength(1);
  });

  it('reuses a cached token instead of re-authenticating', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'tok', expires_in: 3600 },
    });

    await getAccessToken(client);
    await expect(getAccessToken(client)).resolves.toBe('tok');
    expect(mockedAxios.post.mock.calls).toHaveLength(1);
  });
});
