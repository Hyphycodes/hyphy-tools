import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import { createRepository } from '../core';
import type { Repository } from '../repository';
import { createDemoSource } from './source';

/** Demo Mode's repository: the shared core over the seed and this browser's journal. */
export function createDemoRepository(workspace: Workspace): Repository {
  return createRepository(workspace, createDemoSource(workspace));
}
