import 'server-only';
import { cache } from 'react';
import type { Workspace } from '@/lib/identity/types';
import { createRepository } from './core';
import { createDemoRepository } from './demo/repository';
import type { Repository } from './repository';
import { createSupabaseSource } from './supabase/source';

export type { Member, Repository } from './repository';

/** Which data backend this deployment uses: `demo` (default) or `supabase`. */
export function dataBackend(): 'demo' | 'supabase' {
  return process.env.HYPHY_DATA === 'supabase' ? 'supabase' : 'demo';
}

/**
 * The one switch between Demo Mode's in-browser data and the Hyphy Tools database. Both return
 * the same `Repository`: the shared core over a source. With Supabase, Row Level Security does
 * the scoping the demo source does in code.
 *
 * One repository per Workspace per request, so the layout, the page and every widget share the
 * rows read for it instead of each querying again.
 */
export const getRepository = cache((workspace: Workspace): Repository =>
  dataBackend() === 'supabase'
    ? createRepository(workspace, createSupabaseSource(workspace))
    : createDemoRepository(workspace),
);
