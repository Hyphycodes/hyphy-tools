# Files

One file system for everything Hyphy keeps: uploads on the Files page, photos on projects,
vehicles and people, what the PDF, Image and QR tools save, receipt photos and the business logo.
Phase 2D made the bytes real. This is how it works, who can reach what, and what's still to come.

## The shape

- **The record is the truth.** A file is a row in `files` (its Space, who added it, its name, type,
  size, SHA-256, access, where its bytes are, and its status). Every place it shows up — a project,
  a vehicle, a person, a receipt — is a row in `file_attachments`: one file, many places, never a
  copy. The bytes live in Storage at a path the record names; nothing is found by listing Storage.
- **One private bucket.** `hyphy-files`: not public, 50 MB per object, and a MIME allowlist
  enforced by Storage itself. There is no public URL for anything in it.
- **Paths are Hyphy's, never the person's.**
  `spaces/{space_id}/files/{file_id}/{slug}.{ext}` — the Space and file ids come from the server,
  the slug is a cleaned lowercase version of the name with the type's own extension
  (`objectName()` in `src/lib/files/rules.ts`). The database refuses a record whose path isn't its
  own (`files_path_is_its_own`), so no record can point at another file's bytes or climb out of
  its folder. The name people see is a separate column; renaming never moves bytes.
- **One interface for bytes.** `StorageProvider` (`src/lib/files/storage.ts`): an upload target, the
  first bytes of a stored file, batch read links, one read link, remove. Nothing else in the app
  calls `supabase.storage`.
  - **Supabase Storage** for real accounts (`session.source === 'supabase'`), always as the
    signed-in person — their session, the publishable key. **No secret or service key is used by
    the app, on the server or in the browser.** Storage's own policies (below) decide every
    upload, read and removal.
  - **The device** in Demo Mode, where there's no signed-in account for Storage to check. The bytes
    stay in the uploading browser (IndexedDB `hyphy-demo-files`, `src/lib/files/device.ts`) and
    the server keeps the record. See "Demo Mode" below.

## Lifecycle

```
 browser                         server (file-actions.ts)                   database / Storage
 ───────                         ────────────────────────                   ──────────────────
 pick / drop / capture / save
 check type, size, first 4 KB  → prepareUpload: permission, purpose,     →  files row, status pending
 SHA-256, image size              type + magic bytes again, attach           (+ attachment rows)
                                  target, Space from the URL, path       →  signed upload URL (checks the
                               ←  file id + one-path, one-use target        INSERT policy as the person)
 PUT bytes (progress, cancel)  →──────────────────────────────────────────→ storage.objects row
                               → finishUpload: first bytes read back,    →  finish_upload(): object's
                                  checked against the type again             size and type match → ready
                               ←  ready (activity: uploaded / generated)     else → failed
```

- **pending → ready | failed.** Nobody but the uploader sees a pending file. `finish_upload()`
  compares what Storage recorded (size, content type) with what was promised; a mismatch fails
  the file, and `finishUpload` removes the bytes and the record. The server also reads the first
  bytes back and checks them against the type (`bytesMatch`), so a file renamed to look like
  something else is refused even if the browser was bypassed.
- **Retry never duplicates.** "Try again" asks `retryUpload` for a fresh link to the _same_ record;
  a retry that finds the bytes already there just finishes. Storage never overwrites (no `upsert`,
  and there is no UPDATE policy at all).
- **Cancel** removes the pending record (and any bytes). If the tab closes mid-upload, the next
  upload by that person tidies their unfinished uploads older than an hour. One person may have at
  most 25 uploads waiting.
- **Partial failures.** If signing the upload fails, the record is discarded before the error is
  shown. If the bytes can't be checked, the file is not marked ready.
- **Trash.** Moving to Trash sets `deleted_at`/`deleted_by`; the file leaves every list and
  attachment view, and only its uploader and people who manage files see it (Files → Trash).
  Restore brings it back. A receipt's photo and the current logo can't go to Trash.
- **Delete for good** (from Trash only): the server takes the path **from the record**, never from
  the browser, removes the bytes as the person (Storage checks the removal policy), then deletes
  the record. The database refuses to delete a record whose bytes are still stored
  (`guard_file_delete`), so a record can never vanish and leave bytes nobody can find.
- **Activity**: uploaded (or "generated" for tool output), renamed, moved to Trash, restored,
  attached (receipt photos) — written by the database as the person acting.

## Who can reach what

Storage's policies on `storage.objects` ask the file's record, through three functions
(`supabase/migrations/20261001000000_file_storage.sql`, section 4):

| Policy (bucket `hyphy-files`) | Function                     | Allowed when                                                                                                                |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| SELECT (open, sign a link)    | `can_read_file_object(name)` | pending or failed: its uploader. Ready: whoever `can_see_file()` says. In Trash: its uploader or a file manager             |
| INSERT (upload)               | `can_upload_file_object`     | a pending record at exactly this path, started by this person less than a day ago, who may still upload files in that Space |
| DELETE (remove)               | `can_remove_file_object`     | pending/failed: its uploader; in Trash: its uploader or a file manager. Never a live file                                   |
| UPDATE                        | —                            | none: no overwrite, no move                                                                                                 |

`can_see_file()` (the same function the `files` table's own policy uses) requires a current
membership of the file's Space, then the file's access: team files for members, `managers` for
people who manage files, `private` for the uploader, `shared` for people on a project it's attached
to — which is how guests see only their shared projects' files. Receipt photos follow their receipt
(the submitter and whoever sees all expenses). The logo is visible to every member, guests too.

Also enforced by the database (`private.guard_file`): a new record must be pending, describe its
bytes, and be an accepted type and size (`private.file_allowed`); its Space, creator, type, size,
checksum and path never change; people may change only `name`, `folder`, `expires_at` and
`deleted_at` (column grants). Attachments stay inside the file's Space and what the person can see.

**Tested as real people**: `supabase/tests/files.sql` (owner, admin, manager, member, guest,
removed member, another business — 11 groups, run locally and on `hyphy-tools-dev`), and
`tests/storage.spec.ts` against a real Storage server with real accounts (below).

## Opening and downloading

- **Links are signed when they're needed and never stored.** Image previews on a page are signed
  in one batch request (`createSignedUrls`, ten minutes) — no link per file, no N+1.
- **Open / Download** are app routes: `/{space}/files/{id}/open|download`. Each click checks the
  person's access through their own session (`repo.file(id)` under RLS), then redirects to a
  60-second signed link (`cache-control: no-store`). An id someone can't see answers the same 404
  as one that doesn't exist. Download sets the file's display name.
- **The logo** has its own route (`/{space}/logo`, an hour's link, cached privately for ten minutes)
  so the Space switcher and header don't sign a link on every page.

## What's accepted

A conservative allowlist, the same in the browser, the server (`src/lib/files/rules.ts`), the
database (`private.file_allowed`) and the bucket. Every file's first bytes must match the type its
extension claims — `invoice.pdf` that's really a program is refused. No HTML, SVG, scripts or
programs: nothing a browser would run.

| Kind          | Types                              | Limit    |
| ------------- | ---------------------------------- | -------- |
| Photos        | JPG, PNG, WebP, GIF, HEIC/HEIF     | 20 MB    |
| PDF           | PDF                                | 50 MB    |
| Documents     | DOCX, XLSX, PPTX, DOC, XLS         | 25 MB    |
| Text          | CSV, TXT (no NUL bytes, no markup) | 5 MB     |
| Archives      | ZIP                                | 50 MB    |
| Receipt photo | JPG, PNG, WebP, HEIC, PDF          | as above |
| Logo          | PNG, JPG, WebP                     | 2 MB     |

Up to 20 files at a time. Display names are cleaned: control and direction-override characters
removed, whitespace collapsed, the basename only, at most 140 characters with the extension kept.
HEIC opens as a download outside Safari (browsers can't show it). This is validation, not malware
scanning.

## Where files come from

`source` on the record, shown subtly as the file's origin: Uploaded, PDF tool, Image tool, QR tool,
Receipt photo, Business logo.

- **Files page**: drag and drop or the picker, progress per file, cancel and try again. Views:
  All (most recent first), Expiring soon, by project, vehicle or person, Photos, Receipt photos,
  Made with tools, Company, Trash; an "Added by" filter; folders; search over names and origin.
- **Tools** store bytes only when the person saves: a merged or extracted PDF, a converted image,
  a QR code's PNG. Previewing makes no file.
- **Receipts**: the camera (on phones, `capture`) or a photo/PDF from the device, uploaded as soon as
  it's picked, private to the submitter until it's on the receipt, then seen by the approver
  beside the receipt. **"A photo of the receipt"** can be required (Settings → Receipt rules);
  the server and the database both check that a real, finished photo of the submitter's own is on
  every submitted receipt. Drafts may wait for their photo.
- **Projects, vehicles, people**: "Add" uploads straight onto that record; project photos show as
  photos (QR images excluded).
- **Business logo**: owners and admins only (`set_space_logo`: their own finished `brand` upload,
  PNG/JPG/WebP, 2 MB). The previous logo is moved to Trash and then deleted for good — a new
  object and a new reference each time, never an overwrite. Shown in the Space switcher and header.

## Demo Mode

| Real                                                                   | Simulated                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| The whole upload pipeline, type and magic-byte checks, SHA-256         | The bytes stay in this browser (IndexedDB), not in Hyphy's storage                            |
| The record, attachments, Trash, rename, activity, receipt-photo rule   | Other browsers see the record and are told where the file is ("in the browser that added it") |
| Tools saving real bytes, previews, Open and Download of what you added | Seeded sample files have details only ("A sample from the preview")                           |

Reset clears the journal and this browser's stored files. With `HYPHY_DATA=supabase` and dev
personas (no Auth session), bytes also stay on the device: Storage has no one to check.

## Storage used

Owners and admins see how much their Space stores (Files page footer; `space_storage_bytes()`,
everything in Hyphy's storage except failed uploads, Trash included, in one query). No quotas or prices — those come with plans.

## Checking storage and records agree

`private.file_storage_reconciliation` (operators only; not reachable by people or the API) lists
bytes without a record, finished records without bytes, uploads that never finished (over a day)
and failed uploads. Nothing deletes on its own yet; a scheduled clean-up is future work.

## Testing it

- `supabase/tests/files.sql` — every rule above as the seeded people; plain Postgres (with
  `tests/prelude.sql` standing in for Storage's schema) and hosted. Always rolled back.
- **A real Storage server**: `node supabase/local/stack.mjs up` starts Postgres, GoTrue, Storage
  and Mailpit in Docker behind a small gateway (`supabase/local/`), with secrets generated per run
  into `.hyphy-local/` (gitignored), and applies every migration. `eval "$(node
supabase/local/stack.mjs env)" && npm run test:auth` runs `tests/storage.spec.ts` (Storage's HTTP
  API as owner, admin, manager, member, guest, removed member and another business) and
  `tests/files.spec.ts` (the app in a browser: upload, open, download, rename, Trash, delete for
  good, receipt photos, logo). The service key the stack prints is used only by those tests to
  clean up; the app never sees it.
- `tests/app.spec.ts` "files in Demo Mode", `tests/unit.spec.ts` (rules, names, paths, magic bytes)
  and `tests/data.spec.ts`.

## Later

Not built, on purpose: quotas and pricing, resumable (TUS) uploads for very large files, image
transformations and thumbnails, a scheduled orphan clean-up, malware scanning, OCR and text search,
folders, share links, versions, external drives, e-signatures.

**Cost notes.** Storage is billed by bytes stored and egress. Previews are the original image
(no transformations), signed for ten minutes and cached by the browser for that long; the logo
link is reused for an hour. Thumbnails would be the first saving if photo-heavy Spaces grow.
