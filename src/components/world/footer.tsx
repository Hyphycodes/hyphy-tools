import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { categories, catalogFacts, drops, families } from '@/lib/catalog';
import { studio } from '@/lib/public';
import { Spark, Wordmark } from './wordmark';

/** The public world's footer: where everything is, and the promise about data, in plain words. */
export function WorldFooter() {
  const facts = catalogFacts();
  return (
    <footer className="relative mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1320px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_2fr] lg:px-8 lg:py-20">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-5 text-[14.5px] leading-relaxed text-muted">
            Useful little things and serious systems from Hyphy Studio. {facts.local} of{' '}
            {facts.open} tools run entirely on your device, and{' '}
            {facts.noAccount === facts.open
              ? 'none of them needs an account.'
              : `${facts.noAccount} need no account.`}
          </p>
          <a
            href={studio.home}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/[.06] px-4 py-2 text-[14px] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] transition-colors hover:bg-white/10 hover:text-ink"
          >
            <Spark size={12} className="text-[#b9beff]" /> Hyphy Studio: websites, tools and
            systems
          </a>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          <nav aria-label="Browse by what it helps with">
            <p className="label mb-3">Browse</p>
            <ul className="grid gap-2 text-[14px]">
              {categories.map((category) => (
                <li key={category.id}>
                  <Link
                    href={`/tools?c=${category.id}`}
                    className="text-ink-2 transition-colors hover:text-ink"
                  >
                    {category.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Families">
            <p className="label mb-3">Families</p>
            <ul className="grid gap-2 text-[14px]">
              {families.map((family) => (
                <li key={family.id}>
                  <Link
                    href={`/tools#${family.id}`}
                    className="text-ink-2 transition-colors hover:text-ink"
                  >
                    {family.name}
                  </Link>
                </li>
              ))}
              {drops.length > 0 && (
                <li>
                  <Link href="/tools#drops" className="text-ink-2 transition-colors hover:text-ink">
                    Drops
                  </Link>
                </li>
              )}
            </ul>
          </nav>
          <nav aria-label="Hyphy">
            <p className="label mb-3">Hyphy</p>
            <ul className="grid gap-2 text-[14px]">
              <li>
                <a href={studio.work} className="text-ink-2 transition-colors hover:text-ink">
                  Work
                </a>
              </li>
              <li>
                <Link href="/tools#private" className="text-ink-2 transition-colors hover:text-ink">
                  Private by design
                </Link>
              </li>
              <li>
                <a href={studio.contact} className="text-ink-2 transition-colors hover:text-ink">
                  Contact
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </div>
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-6 text-[12.5px] text-faint sm:px-6 lg:px-8">
        <p>© {new Date().getFullYear()} Hyphy LLC</p>
        <p className="flex items-center gap-1.5">
          <Icon name="lock" size={12} /> Hyphy doesn’t sell your data, and most tools never see it.
        </p>
      </div>
    </footer>
  );
}
