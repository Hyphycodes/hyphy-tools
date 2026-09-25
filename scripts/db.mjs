#!/usr/bin/env node
/*
 * Development database helper. Never points at production: every command that writes checks the
 * database is marked as the Hyphy Tools development world (supabase/dev/dev_tools.sql).
 *
 *   node scripts/db.mjs local   Rebuild a plain local Postgres from scratch: Supabase stand-ins,
 *                               every migration, the dev tools, then the seeded world.
 *   node scripts/db.mjs seed    Re-seed the development world (the same thing Reset does).
 *   node scripts/db.mjs sql     Print the seed SQL (for applying to a hosted dev project).
 *
 * Reads DATABASE_URL (default: the local Postgres on port 54322).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import postgres from 'postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/hyphy';
const command = process.argv[2];

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(root, 'src') } });
const { worldSql, applyWorld } = await jiti.import(
  path.join(root, 'src/lib/data/supabase/world.ts'),
);

const read = (file) => readFileSync(path.join(root, file), 'utf8');

async function local() {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(target.hostname))
    throw new Error('`local` only rebuilds a database on this machine.');
  const name = target.pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.href, options());
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
  await admin.unsafe(`create database "${name}"`);
  await admin.end();
  const sql = postgres(url, options());
  await sql.unsafe(read('supabase/tests/prelude.sql'));
  for (const file of readdirSync(path.join(root, 'supabase/migrations')).sort())
    await sql.unsafe(read(`supabase/migrations/${file}`));
  await sql.unsafe(read('supabase/dev/dev_tools.sql'));
  await applyWorld(sql);
  await sql.end();
  console.log(`Rebuilt and seeded ${name}.`);
}

async function seed() {
  const sql = postgres(url, options());
  await applyWorld(sql);
  await sql.end();
  console.log('Seeded the development world.');
}

function options() {
  return { onnotice: () => {}, prepare: false, max: 1 };
}

if (command === 'local') await local();
else if (command === 'seed') await seed();
else if (command === 'sql') process.stdout.write(worldSql());
else {
  console.error('Usage: node scripts/db.mjs local|seed|sql');
  process.exit(1);
}
