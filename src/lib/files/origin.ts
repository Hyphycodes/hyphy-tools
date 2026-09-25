import type { FileRecord } from '@/lib/platform/types';

/** Where a file came from, as the product says it: "Uploaded", "PDF tool", "Receipt photo"… */
export function originOf(file: Pick<FileRecord, 'source'>): {
  label: string;
  icon: 'upload' | 'pdf' | 'image' | 'qr' | 'receipt' | 'building';
} {
  switch (file.source) {
    case 'pdf':
      return { label: 'PDF tool', icon: 'pdf' };
    case 'images':
      return { label: 'Image tool', icon: 'image' };
    case 'qr':
      return { label: 'QR tool', icon: 'qr' };
    case 'receipts':
      return { label: 'Receipt photo', icon: 'receipt' };
    case 'brand':
      return { label: 'Business logo', icon: 'building' };
    default:
      return { label: 'Uploaded', icon: 'upload' };
  }
}
