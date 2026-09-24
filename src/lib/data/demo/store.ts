import 'server-only';
import { cache } from 'react';
import { applyJournal, readJournal } from './journal';
import { seed } from './seed';

/** The demo world for this request: the seed plus this browser's own changes. */
export const getDemoData = cache(async () => applyJournal(seed(), await readJournal()));
