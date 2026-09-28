import Link from 'next/link';
import { Icon } from '@/components/ui/icon';

export default function ToolNotFound() {
  return (
    <section className="mx-auto grid min-h-[70dvh] max-w-xl place-items-center px-6 pt-24 text-center">
      <div>
        <p className="label mb-4">Not here</p>
        <h1 className="t-h2">There’s no tool at this address.</h1>
        <p className="t-lead mx-auto mt-4 max-w-md">
          It may have a new name, or it hasn’t been built yet. Every tool Hyphy has made is in the
          marketplace.
        </p>
        <Link
          href="/tools"
          className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-on-ink"
        >
          Browse all tools <Icon name="arrow-right" size={16} />
        </Link>
      </div>
    </section>
  );
}
