#!/usr/bin/env node
/*
 * The local Supabase stack for real-account and Storage tests (docker-compose.yml beside this).
 *
 *   node supabase/local/stack.mjs up     fresh secrets → start → every migration → print the env
 *   node supabase/local/stack.mjs env    print the env of the running stack again
 *   node supabase/local/stack.mjs down   stop it and delete its data
 *
 * Secrets are made per run and written only to .hyphy-local/ (ignored by git). The database gets
 * the migrations as they'd reach a production project — no development tools, no Demo world —
 * so the tests meet the same rules real people will.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, '.hyphy-local');
const envFile = path.join(dir, 'stack.env');
const compose = ['compose', '-f', path.join(root, 'supabase/local/docker-compose.yml')];
const APP_PORT = Number(process.env.AUTH_E2E_PORT ?? 3108);

const b64 = (value) => Buffer.from(value).toString('base64url');
function jwt(payload, secret) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

function readEnv() {
  if (!existsSync(envFile)) throw new Error('No local stack. Run `up` first.');
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
}

function testEnv(env) {
  return {
    AUTH_E2E_SUPABASE_URL: 'http://localhost:54421',
    AUTH_E2E_PUBLISHABLE_KEY: env.PUBLISHABLE_KEY,
    AUTH_E2E_DATABASE_URL: `postgres://hyphy_app:${env.APP_PASSWORD}@localhost:54422/postgres`,
    AUTH_E2E_ADMIN_DATABASE_URL: `postgres://postgres:${env.POSTGRES_PASSWORD}@localhost:54422/postgres`,
    AUTH_E2E_MAILPIT_URL: 'http://localhost:54424',
    // Test cleanup only: removes the Storage objects the tests made. Never an app setting.
    STORAGE_E2E_SERVICE_KEY: env.SERVICE_KEY,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, check, seconds = 120) {
  for (let i = 0; i < seconds; i += 1) {
    try {
      if (await check()) return;
    } catch {
      // not yet
    }
    await wait(1000);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function up() {
  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(40).toString('hex');
  const long = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  const env = {
    POSTGRES_PASSWORD: randomBytes(18).toString('hex'),
    APP_PASSWORD: randomBytes(18).toString('hex'),
    JWT_SECRET: secret,
    ANON_KEY: jwt({ role: 'anon', iss: 'hyphy-local', exp: long }, secret),
    SERVICE_KEY: jwt({ role: 'service_role', iss: 'hyphy-local', exp: long }, secret),
    PUBLISHABLE_KEY: `sb_publishable_local${randomBytes(8).toString('hex')}`,
    SITE_URL: `http://localhost:${APP_PORT}/platform`,
  };
  writeFileSync(
    envFile,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  execFileSync('docker', [...compose, '--env-file', envFile, 'down', '-v'], { stdio: 'ignore' });
  execFileSync('docker', [...compose, '--env-file', envFile, 'up', '-d'], { stdio: 'inherit' });

  const admin = () =>
    postgres(`postgres://supabase_admin:${env.POSTGRES_PASSWORD}@localhost:54422/postgres`, {
      max: 1,
      onnotice: () => {},
    });
  await until('Postgres', async () => {
    const sql = admin();
    try {
      await sql`select 1`;
      return true;
    } finally {
      await sql.end();
    }
  });
  // The service roles log in with this run's password (what Supabase's compose file does).
  const sql = admin();
  for (const role of ['supabase_auth_admin', 'supabase_storage_admin', 'authenticator', 'postgres'])
    await sql.unsafe(`alter role ${role} with password '${env.POSTGRES_PASSWORD}'`);
  await until('Auth and Storage to create their schemas', async () => {
    const [row] = await sql`
      select to_regclass('auth.users') is not null as auth,
             to_regclass('storage.buckets') is not null as storage`;
    return row.auth && row.storage;
  });
  await sql.end();
  await until('Storage to finish migrating', async () => {
    const response = await fetch('http://localhost:54421/storage/v1/status');
    return response.ok;
  });
  await until('Auth', async () => (await fetch('http://localhost:54421/auth/v1/health')).ok);
  // Storage keeps migrating its schema for a moment after it answers.
  await wait(3000);

  // Hyphy's migrations, as a project owner applies them (the `postgres` role, like `supabase db push`).
  const owner = postgres(testEnv(env).AUTH_E2E_ADMIN_DATABASE_URL, { max: 1, onnotice: () => {} });
  for (const file of readdirSync(path.join(root, 'supabase/migrations')).sort())
    await owner.unsafe(readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  await owner.unsafe(`alter role hyphy_app login password '${env.APP_PASSWORD}'`);
  await owner.end();
  print(env);
}

function print(env) {
  for (const [key, value] of Object.entries(testEnv(env))) console.log(`export ${key}='${value}'`);
}

const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'env') print(readEnv());
else if (command === 'down') {
  execFileSync('docker', [...compose, '--env-file', envFile, 'down', '-v'], { stdio: 'inherit' });
} else {
  console.error('Usage: node supabase/local/stack.mjs up|env|down');
  process.exit(1);
}
