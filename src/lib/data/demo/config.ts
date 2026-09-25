import 'server-only';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { cookies } from 'next/headers';
import { RuleError } from '../repository';
import { cleanConfig, emptyConfig, LOG_LIMIT, type DemoConfig } from './config-apply';

/**
 * Demo Mode's memory for business setup (fields, rules, words, tools), kept apart from the record
 * journal so it never ages out, and compressed so a real setup fits in one cookie. Private to this
 * browser; Reset clears it. In production this is `space_settings`, `custom_fields` and the
 * `spaces` row.
 */
export type { DemoConfig } from './config-apply';
export { applyConfig } from './config-apply';

const NAME = 'hyphy_demo_config';
/** One cookie: with the journal's two, request headers stay well inside what servers accept. */
const MAX = 3800;

function encode(config: DemoConfig) {
  return deflateRawSync(Buffer.from(JSON.stringify(config), 'utf8')).toString('base64url');
}

function decode(value: string): DemoConfig {
  try {
    return cleanConfig(
      JSON.parse(inflateRawSync(Buffer.from(value, 'base64url')).toString('utf8')),
    );
  } catch {
    return emptyConfig();
  }
}

export async function readConfig(): Promise<DemoConfig> {
  const value = (await cookies()).get(NAME)?.value;
  return value ? decode(value) : emptyConfig();
}

/**
 * Saves the setup. Older setup activity drops off first; if the setup itself no longer fits, the
 * change is refused (nothing is lost) rather than half-kept.
 */
export async function writeConfig(config: DemoConfig) {
  let next = { ...config, log: config.log.slice(-LOG_LIMIT) };
  let value = encode(next);
  while (value.length > MAX && next.log.length) {
    next = { ...next, log: next.log.slice(1) };
    value = encode(next);
  }
  if (value.length > MAX)
    throw new RuleError(
      'The preview can’t hold more setup changes. Reset the demo to start from the original setup.',
    );
  (await cookies()).set(NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearConfig() {
  (await cookies()).delete(NAME);
}
