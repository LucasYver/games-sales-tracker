/**
 * Log the followers bot on to Steam once and save its refresh token, for
 * `STEAM_BOT_REFRESH_TOKEN` (see `SteamNetworkClient`).
 *
 *   npm run steam:bot-login [-- <output file>]
 *
 * Asks for the account name, the password (hidden) and the Steam Guard code,
 * then writes the token to the output file (default `./steam-bot-token.txt`,
 * readable by you only). Paste it into the Vercel env var, then delete the
 * file. The token lasts ~200 days; run this again before it expires.
 * Use a dedicated Steam account, not a personal one.
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import SteamUser from 'steam-user';

function ask(question: string, hidden = false): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (hidden) {
      // Echo the prompt only, not what is typed.
      const output = rl as unknown as { _writeToOutput: (s: string) => void };
      output._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      done(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const outFile = resolve(process.argv[2] ?? 'steam-bot-token.txt');
  const accountName = await ask('Steam account name: ');
  const password = await ask('Password (hidden): ', true);

  const client = new SteamUser({ autoRelogin: false });
  client.on('refreshToken', (token) => {
    writeFileSync(outFile, token, { mode: 0o600 });
    console.log(`Refresh token saved to ${outFile}.`);
    client.logOff();
    setTimeout(() => process.exit(0), 500);
  });
  client.on('error', (error) => {
    console.error(`Logon failed: ${error.message}`);
    process.exit(1);
  });
  // steam-user asks for the Steam Guard code on stdin by itself.
  client.logOn({ accountName, password });
}

void main();
