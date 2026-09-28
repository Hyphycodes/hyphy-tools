import type { Metadata } from 'next';
import { Home } from '@/components/home/home';
import {
  AllTools,
  Creative,
  Everyday,
  Featured,
  OnTheWay,
  People,
  PrivateByDesign,
} from '@/components/marketplace/sections';

export const metadata: Metadata = {
  title: { absolute: 'Hyphy Tools — small tools that just work' },
  description:
    'Free tools from Hyphy: split a check from a photo of the receipt, find a time, make a QR code, merge PDFs, frame photos for every feed. No sign-up.',
  alternates: { canonical: 'tools' },
};

/**
 * The home. Static: the classic marketplace sections are rendered here from the registry at build
 * time and handed to the home, which arranges them around the person (their mode, their tools,
 * what they left open) in the browser. The full catalog lives at /tools/all.
 */
export default function Marketplace() {
  return (
    <Home
      classic={
        <>
          <Featured />
          <Creative />
          <People />
          <Everyday />
        </>
      }
      browse={
        <>
          <AllTools />
          <PrivateByDesign />
          <OnTheWay />
        </>
      }
    />
  );
}
