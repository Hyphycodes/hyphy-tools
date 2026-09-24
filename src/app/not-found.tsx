import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-sm text-center">
        <p className="label mb-3">Not here</p>
        <h1 className="display text-[34px]">This isn’t in your Spaces.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          The page doesn’t exist, or the person you’re previewing as can’t see it. Switch who you’re
          previewing as, or head home.
        </p>
        <Link href="/" className={buttonClass({ variant: 'primary', className: 'mt-6' })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
