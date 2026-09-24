import { qrMatrix, qrPath } from '@/lib/tools/qr';
import { cn } from '@/components/ui/cn';

/** A saved QR code, drawn from its content — the same encoder the QR tool uses. */
export function QrMini({
  content,
  fg,
  bg,
  className,
  label,
}: {
  content: string;
  fg: string;
  bg: string;
  className?: string;
  label?: string;
}) {
  let path = '';
  let size = 29;
  try {
    const matrix = qrMatrix(content, 'M');
    path = qrPath(matrix, 2);
    size = matrix.length + 4;
  } catch {
    // Content too long for one code: render the empty frame.
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('block rounded-[8px]', className)}
      role="img"
      aria-label={label ?? `QR code for ${content}`}
    >
      <rect width={size} height={size} fill={bg} />
      <path d={path} fill={fg} />
    </svg>
  );
}
