'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';

/** A page that couldn't load its data — usually the database was briefly out of reach. */
export default function SpaceError({ error, retry }: { error: Error; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <Page>
      <Panel className="mt-10">
        <EmptyState
          icon="wifi"
          title="This page didn’t load"
          action={
            <Button variant="primary" onClick={() => retry()}>
              Try again
            </Button>
          }
        >
          Hyphy couldn’t reach your data just now. Nothing you saved is lost.
        </EmptyState>
      </Panel>
    </Page>
  );
}
