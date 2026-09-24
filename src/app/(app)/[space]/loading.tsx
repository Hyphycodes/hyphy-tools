import { Page } from '@/components/ui/page';

/** Shown instantly while a page in the Space renders. */
export default function Loading() {
  return (
    <Page wide>
      <div aria-busy="true" aria-label="Loading">
        <div className="skeleton mb-3 h-3 w-40" />
        <div className="skeleton mb-8 h-10 w-80 max-w-full" />
        <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="skeleton h-14 rounded-[16px]" />
          ))}
        </div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <div className="skeleton h-64 rounded-[16px]" />
            <div className="skeleton h-48 rounded-[16px]" />
          </div>
          <div className="skeleton h-80 rounded-[16px]" />
        </div>
      </div>
    </Page>
  );
}
