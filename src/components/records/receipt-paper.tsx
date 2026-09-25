import { cn } from '@/components/ui/cn';
import { formatCurrency } from '@/lib/platform/format';
import type { Receipt } from '@/lib/platform/types';

/**
 * A receipt, drawn from its details. The preview keeps a receipt's fields, not its photo, so this
 * stands in for the image and makes the record read as a receipt at a glance.
 */
export function ReceiptPaper({
  receipt,
  timezone,
  className,
}: {
  receipt: Pick<
    Receipt,
    'vendor' | 'total' | 'date' | 'gallons' | 'odometer' | 'paymentMethod' | 'category'
  >;
  timezone: string;
  className?: string;
}) {
  const when = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(receipt.date));
  const price =
    receipt.gallons && receipt.total ? (receipt.total / receipt.gallons).toFixed(3) : null;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative w-[132px] shrink-0 bg-white px-3 pt-3.5 pb-5 font-mono text-[8px] leading-[1.5] text-ink/75 shadow-lift',
        '[clip-path:polygon(0_0,100%_0,100%_calc(100%-5px),92%_100%,84%_calc(100%-5px),76%_100%,68%_calc(100%-5px),60%_100%,52%_calc(100%-5px),44%_100%,36%_calc(100%-5px),28%_100%,20%_calc(100%-5px),12%_100%,4%_calc(100%-5px),0_100%)]',
        className,
      )}
    >
      <p className="truncate text-center text-[10px] font-bold tracking-wide text-ink uppercase">
        {receipt.vendor}
      </p>
      <p className="text-center">{when}</p>
      <div className="my-1.5 border-t border-dashed border-ink/20" />
      {receipt.gallons ? (
        <>
          <p className="flex justify-between">
            <span>GAL</span>
            <span>{receipt.gallons.toFixed(3)}</span>
          </p>
          {price && (
            <p className="flex justify-between">
              <span>PRICE/G</span>
              <span>{price}</span>
            </p>
          )}
        </>
      ) : (
        [72, 54, 64].map((width) => (
          <p
            key={width}
            className="mt-1 h-[5px] rounded bg-ink/10"
            style={{ width: `${width}%` }}
          />
        ))
      )}
      <p className="mt-1.5 flex justify-between text-[9px] font-bold text-ink">
        <span>TOTAL</span>
        <span>{receipt.total ? formatCurrency(receipt.total) : '$—.——'}</span>
      </p>
      {receipt.odometer ? <p className="mt-1">ODO {receipt.odometer}</p> : null}
      {receipt.paymentMethod && <p className="truncate uppercase">{receipt.paymentMethod}</p>}
    </div>
  );
}
