import { QrMini } from '@/components/records/qr-mini';
import { Icon } from '@/components/ui/icon';

/*
 * Small, honest renditions of each tool's interface for the library. Decorative only — every
 * one of these tools opens to the real thing.
 */

export function ToolPreview({ id }: { id: string }) {
  switch (id) {
    case 'receipts':
      return (
        <div className="relative h-full w-full">
          {[
            { rotate: -8, left: '50%', shift: '-88%', vendor: 'SPEEDWAY', total: '$68.90' },
            { rotate: 6, left: '50%', shift: '-12%', vendor: 'MENARDS', total: '$143.27' },
            { rotate: -1, left: '50%', shift: '-50%', vendor: 'SHELL', total: '$71.42', top: true },
          ].map((paper) => (
            <div
              key={paper.vendor}
              className="absolute top-1/2 w-[92px] bg-white px-2.5 pt-3 pb-4 font-mono text-[7.5px] leading-[1.6] text-ink/70 shadow-lift"
              style={{
                left: paper.left,
                transform: `translate(${paper.shift}, -50%) rotate(${paper.rotate}deg)`,
                zIndex: paper.top ? 2 : 1,
              }}
            >
              <p className="text-center text-[8.5px] font-bold text-ink">{paper.vendor}</p>
              <p className="mt-1.5 h-1 w-4/5 rounded bg-ink/10" />
              <p className="mt-1 h-1 w-3/5 rounded bg-ink/10" />
              <p className="mt-1 h-1 w-2/3 rounded bg-ink/10" />
              <p className="mt-2 flex justify-between gap-1 font-bold text-ink">
                <span>TOTAL</span>
                <span>{paper.total}</span>
              </p>
            </div>
          ))}
        </div>
      );
    case 'qr':
      return (
        <div className="grid h-full place-items-center">
          <div className="w-[46%] max-w-[150px] rotate-[-3deg] rounded-[16px] bg-white p-2.5 shadow-lift">
            <QrMini content="https://saltandember.example/menu" fg="#16150F" bg="#FFFFFF" />
            <p className="mt-1.5 text-center text-[10px] font-semibold text-ink">
              Scan for the menu
            </p>
          </div>
        </div>
      );
    case 'pdf':
      return (
        <div className="relative grid h-full place-items-center">
          {[-10, -3, 5].map((rotate, index) => (
            <div
              key={rotate}
              className="absolute w-[30%] rounded-[6px] bg-white p-2.5 shadow-lift"
              style={{ transform: `translateX(${(index - 1) * 34}%) rotate(${rotate}deg)` }}
            >
              <p className="mb-2 h-1.5 w-1/2 rounded bg-tool-pdf/80" />
              {[90, 70, 85, 60, 75].map((width) => (
                <p
                  key={width}
                  className="mt-1 h-1 rounded bg-ink/10"
                  style={{ width: `${width}%` }}
                />
              ))}
              <p className="mt-2 text-[8px] font-medium text-muted">
                {['invoice.pdf', 'permit.pdf', 'photos.pdf'][index]}
              </p>
            </div>
          ))}
        </div>
      );
    case 'mileage':
      return (
        <svg viewBox="0 0 240 150" className="h-full w-full" aria-hidden="true">
          <path
            d="M28 118 C 70 116, 64 60, 112 64 S 170 104, 212 34"
            fill="none"
            stroke="#16150F"
            strokeOpacity=".18"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M28 118 C 70 116, 64 60, 112 64 S 170 104, 212 34"
            fill="none"
            stroke="#16150F"
            strokeWidth="2.5"
            strokeDasharray="1 7"
            strokeLinecap="round"
          />
          <circle cx="28" cy="118" r="7" fill="#fff" stroke="#16150F" strokeWidth="2.5" />
          <circle cx="212" cy="34" r="9" fill="#16150F" />
          <circle cx="212" cy="34" r="3" fill="#7FD4FF" />
          <rect x="122" y="96" width="78" height="30" rx="15" fill="#fff" />
          <text
            x="161"
            y="115.5"
            textAnchor="middle"
            fontSize="13"
            fontWeight="600"
            fill="#16150F"
            fontFamily="var(--font-mona)"
          >
            37 mi
          </text>
        </svg>
      );
    case 'links':
      return (
        <div className="grid h-full place-items-center">
          <div className="w-[38%] max-w-[130px] rounded-[18px] bg-[#2A120E] p-2.5 pt-4 shadow-lift">
            <span className="mx-auto block size-7 rounded-full bg-[#E0492F]" />
            <p className="mt-1.5 text-center text-[9px] font-semibold text-white">@saltandember</p>
            {['Reserve', 'Menu', 'Oysters'].map((label) => (
              <p
                key={label}
                className="mt-1.5 rounded-full bg-white/14 py-1 text-center text-[8px] text-white"
              >
                {label}
              </p>
            ))}
          </div>
        </div>
      );
    case 'images':
      return (
        <div className="grid h-full place-items-center">
          <div className="flex items-center gap-3">
            <div className="w-24 rounded-[10px] bg-white p-1.5 shadow-lift">
              <div
                className="aspect-[4/3] rounded-[6px]"
                style={{ background: 'linear-gradient(160deg,#c9b79c,#6b5a44)' }}
              />
              <p className="mt-1 text-[9px] font-semibold text-ink">4.8 MB</p>
            </div>
            <Icon name="arrow-right" size={18} className="text-ink/50" />
            <div className="w-16 rounded-[8px] bg-white p-1.5 shadow-lift">
              <div
                className="aspect-[4/3] rounded-[5px]"
                style={{ background: 'linear-gradient(160deg,#c9b79c,#6b5a44)' }}
              />
              <p className="mt-1 text-[9px] font-semibold text-ink">312 KB</p>
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}
