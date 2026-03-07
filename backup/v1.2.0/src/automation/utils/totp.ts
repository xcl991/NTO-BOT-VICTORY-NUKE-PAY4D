import * as OTPAuth from 'otpauth';
import logger from '../../utils/logger';

/**
 * Time-corrected TOTP generator.
 *
 * Fetches real time from an HTTP server (via Date header) and calculates
 * the offset from the local PC clock. This offset is then applied when
 * generating TOTP codes, so codes are correct even if the PC clock is wrong.
 *
 * Without this, a PC clock that's off by >30 seconds produces TOTP codes
 * from a different time window, which the server rejects as "Invalid".
 */

let clockOffsetMs = 0;
let offsetInitialized = false;

/**
 * Sync clock offset by comparing local time with a reliable server's Date header.
 * Called once at startup or on first TOTP generation.
 */
export async function syncClockOffset(): Promise<number> {
  const servers = [
    'https://www.google.com',
    'https://www.cloudflare.com',
    'https://www.microsoft.com',
  ];

  for (const url of servers) {
    try {
      const before = Date.now();
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      const after = Date.now();
      const dateHeader = res.headers.get('date');
      if (!dateHeader) continue;

      const serverTime = new Date(dateHeader).getTime();
      const localTime = (before + after) / 2; // midpoint for accuracy
      clockOffsetMs = serverTime - localTime;
      offsetInitialized = true;

      const offsetSec = Math.round(clockOffsetMs / 1000);
      logger.info(`Clock offset synced: ${offsetSec}s (from ${url})`);
      if (Math.abs(offsetSec) > 5) {
        logger.warn(`PC clock is ${Math.abs(offsetSec)}s ${offsetSec < 0 ? 'ahead' : 'behind'} — TOTP codes will be time-corrected`);
      }
      return clockOffsetMs;
    } catch (err) {
      logger.debug(`Clock sync failed for ${url}: ${err}`);
      continue;
    }
  }

  logger.warn('Could not sync clock offset from any server — using local time');
  offsetInitialized = true;
  return 0;
}

/**
 * Generate a time-corrected TOTP code.
 */
export async function generateTOTP(secret: string): Promise<string> {
  if (!offsetInitialized) {
    await syncClockOffset();
  }

  const totp = new OTPAuth.TOTP({ secret });
  const correctedTimestamp = Date.now() + clockOffsetMs;
  return totp.generate({ timestamp: correctedTimestamp });
}

/**
 * Get current clock offset in seconds (for logging).
 */
export function getClockOffsetSeconds(): number {
  return Math.round(clockOffsetMs / 1000);
}
