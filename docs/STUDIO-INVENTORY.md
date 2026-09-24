# What came from Hyphy Studio

Hyphy Studio (`Hyphycodes/hyphy-studio`) was inspected read-only on 2026-09-24. Nothing in it was
changed; its tools keep working there.

## Found in Studio

| Area                              | Studio files                                                                                           | State                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| PDF Merge                         | `components/pdf-merger.tsx`, `/tools/pdf`                                                              | Working, browser-only (pdf-lib). 20 files, 50 MB, 500 pages.                                       |
| QR Codes                          | `lib/qr.ts`, `components/tools/qr-tool.tsx`, `qr-live.tsx`, `/tools/qr-codes`                          | Working. UTF-8 encoder, contrast check, sharp PNG, SVG.                                            |
| Image Resize                      | `components/tools/image-tool.tsx`, `/tools/images`                                                     | Working, browser-only canvas pipeline.                                                             |
| Gas Receipts                      | `/tools/gas-receipts` (marketing page + screenshots)                                                   | The app itself is a separate private portal for one team.                                          |
| Link Hub, Mileage Log, Bulk Files | `data/tools.ts` concepts                                                                               | Concepts only, no build.                                                                           |
| Tool catalog                      | `data/tools.ts`, `lib/tools/catalog.ts`, `access.ts`, `membership.ts`                                  | Public catalog + fail-closed access + closed $29 membership.                                       |
| Accounts & billing                | `lib/auth.ts`, `lib/supabase/*`, `lib/billing/stripe.ts`, `/account`, `/login`, `proxy.ts`, migrations | Supabase Auth (email links), Stripe Checkout/Portal/webhook, subscriptions mirror — built, closed. |
| Operations                        | `/admin`, leads, client projects, intake, email templates                                              | Studio's own business operations.                                                                  |
| Tool pictograms                   | `components/tools/tool-icon.tsx`                                                                       | Hand-drawn 24px icons per tool.                                                                    |
| Design tokens                     | `app/globals.css`, `docs/DESIGN.md`                                                                    | Hubot/Mona/Martian, signal blue, tool colors.                                                      |

## Ported into Hyphy Tools

| From Studio                              | To                                                           | Kept                                                     | New here                                    |
| ---------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------- |
| `lib/qr.ts`                              | `src/lib/tools/qr.ts`                                        | Unchanged                                                | —                                           |
| `components/tools/qr-tool.tsx`           | `src/components/tools/qr-tool.tsx`                           | Levels, contrast math, PNG renderer, SVG, limits         | Color presets, save to Space, saved codes   |
| `components/pdf-merger.tsx`              | `src/components/tools/pdf-tool.tsx`                          | Merge logic, limits, error messages                      | Extract pages, drag and drop, save to Files |
| `components/tools/image-tool.tsx`        | `src/components/tools/image-tool.tsx`                        | Conversion pipeline, limits, messages (verbatim)         | Save results to Files                       |
| Tool pictograms                          | `src/components/ui/icon.tsx`                                 | Paths for PDF, QR, image, receipt, link, folders         | Used as tool glyphs everywhere              |
| Design tokens                            | `src/app/globals.css`                                        | Typefaces, signal blue, tool colors                      | Product-scale tokens (paper, sheets)        |
| Gas Receipts idea                        | Receipts tool                                                | Fields: date, station, total, gallons, odometer, vehicle | Projects, approvals, personal use           |
| Mileage / Link Hub / Bulk Files concepts | Mileage (Beta), Link Pages (Beta), Bulk Rename (Coming soon) | Names and promises                                       | Built (Mileage, Link Pages)                 |
| Supabase/Stripe patterns                 | `docs/AUTH.md`                                               | The approach (verified sessions, webhook-only access)    | Not copied yet — Phase 2                    |

Not opened: the Gas Receipts portal repository (it holds one company's vehicles and fuel cards and
is read-only under the repository rules). Its receipt-reading logic is the main thing to bring
over next, with explicit permission.

## What stays in Studio

Studio remains the marketing site: work, case studies, Websites / Tools / Systems pages, pricing,
contact and lead handling, client intake and admin. Its free tool pages can stay as public
demonstrations and, once Hyphy Tools is public, link into it. Studio's closed membership code
should not grow further; paid access belongs to Hyphy Tools.
