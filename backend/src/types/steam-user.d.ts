// Minimal typing for the parts of `steam-user` the follower capture uses.
// `_send` is internal to the library: it is the only way to send
// `ClientGetClanActivityCounts`, which steam-user does not wrap.
declare module 'steam-user' {
  import { EventEmitter } from 'events';

  interface SteamId {
    getSteamID64(): string;
  }

  interface GroupUserCounts {
    members?: number | null;
    online?: number | null;
  }

  interface GroupPersona {
    user_counts?: GroupUserCounts | null;
  }

  interface SteamUserOptions {
    autoRelogin?: boolean;
    renewRefreshTokens?: boolean;
  }

  class SteamUser extends EventEmitter {
    constructor(options?: SteamUserOptions);
    steamID: SteamId | null;
    logOn(
      details:
        | { refreshToken: string }
        | { accountName: string; password: string },
    ): void;
    logOff(): void;
    _send(header: { msg: number; proto: object }, body: Buffer): void;
    on(event: 'loggedOn', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(
      event: 'group',
      listener: (steamId: SteamId, group: GroupPersona) => void,
    ): this;
    on(event: 'refreshToken', listener: (token: string) => void): this;
  }

  export = SteamUser;
}
