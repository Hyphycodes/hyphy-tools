import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { categories, inCategory, isReady } from '@/lib/catalog';
import { studio } from '@/lib/public';
import { Spark, Wordmark } from './wordmark';

/** The public world's footer: where everything is, and the promise about data, in plain words. */
export function WorldFooter() {
  const browse = categories.filter((category) => inCategory(category.id).some(isReady));
  return (
    <footer className="world-footer relative mt-20 border-t border-line">
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_2fr] lg:px-8 lg:py-16">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-4 text-[14.5px] leading-relaxed text-muted">
            Small tools that just work, from Hyphy Studio. Free, and no sign-up.
          </p>
          <a
            href={studio.home}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-ink/[.06] px-4 py-2 text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-ink/10 hover:text-ink"
          >
            <Spark size={12} className="text-[#b9beff]" /> Hyphy Studio: websites, tools and systems
          </a>
        </div>
        <div className="grid grid-cols-2 gap-8">
          <nav aria-label="Browse by what it helps with">
            <p className="label mb-3">Browse</p>
            <ul className="grid gap-1 text-[14px]">
              {browse.map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/tools/all?c=${category.id}`}
                    prefetch={false}
                    className="inline-flex min-h-9 items-center text-ink-2 transition-colors hover:text-ink"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Hyphy">
            <p className="label mb-3">Hyphy</p>
            <ul className="grid gap-1 text-[14px]">
              <li>
                <a
                  href={studio.work}
                  className="inline-flex min-h-9 items-center text-ink-2 transition-colors hover:text-ink"
                >
                  Work
                </a>
              </li>
              <li>
                <a
                  href={studio.contact}
                  className="inline-flex min-h-9 items-center text-ink-2 transition-colors hover:text-ink"
                >
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
      <div className="safe-bottom mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-6 text-[12.5px] text-faint sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} Hyphy LLC</p>
        <p className="flex items-center gap-1.5">
          <Icon name="lock" size={12} /> Hyphy doesn’t sell your data, and most tools never see it.
        </p>
      </div>
    </footer>
  );
}
