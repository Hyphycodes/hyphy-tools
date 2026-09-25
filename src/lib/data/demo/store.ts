import 'server-only';
import { cache } from 'react';
import { applyConfig, readConfig } from './config';
import { applyJournal, readJournal } from './journal';
import { seed } from './seed';

/** The demo world for this request: the seed, this browser's business setup and its changes. */
export const getDemoData = cache(async () => {
  const [journal, config] = await Promise.all([readJournal(), readConfig()]);
  return applyJournal(applyConfig(seed(), config), journal);
});
