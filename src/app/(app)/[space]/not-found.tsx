import { EmptyState } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';

export default function SpaceNotFound() {
  return (
    <Page>
      <Panel className="mt-10">
        <EmptyState icon="lock" title="Not available to you here">
          It doesn’t exist, or your role in this Space doesn’t include it. Try another Space, or
          preview as someone else.
        </EmptyState>
      </Panel>
    </Page>
  );
}
