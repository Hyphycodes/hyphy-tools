import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { FileButtons, FilePicture } from '@/components/files/file-media';
import { FileManage } from '@/components/files/file-manage';
import { Relations, type Relation } from '@/components/records/relations';
import { FileRow } from '@/components/records/rows';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { LinkSelect } from '@/components/ui/link-select';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { viewsFor } from '@/lib/files/access';
import { originOf } from '@/lib/files/origin';
import { typeByMime } from '@/lib/files/rules';
import { storageFor } from '@/lib/files/storage';
import { openPage } from '@/lib/page';
import { daysUntil, formatBytes, formatDate, formatRelative } from '@/lib/platform/format';
import { workProfile } from '@/lib/platform/work';
import type { AttachmentRef, FileRecord } from '@/lib/platform/types';

export const metadata = { title: 'Files' };

/** How many rows a view shows before "Show all". */
const PAGE = 60;

/** Files are attached to the work they belong to, so the list can answer "whose is this?" */
export default async function FilesPage({ params, searchParams }: PageProps<'/[space]/files'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'files');
  const query = await searchParams;
  const view = String(query.view ?? 'all');
  const folder = typeof query.folder === 'string' ? query.folder : undefined;
  const by = typeof query.by === 'string' ? query.by : undefined;
  const all = query.all === '1';
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const me = workspace.person.id;
  const managesFiles = can('files.manage');
  const [files, inTrash, projects, vehicles, members, receipts, stored] = await Promise.all([
    repo.files(),
    repo.files({ trash: true }),
    repo.projects(),
    repo.vehicles(),
    repo.members(),
    repo.receipts(),
    can('space.manage') ? repo.storageBytes() : Promise.resolve(null),
  ]);
  // Trash is for whoever added a file and the people who manage files.
  const trash = inTrash.filter((file) => file.createdBy === me || managesFiles);

  const name = (ref: AttachmentRef) =>
    ref.type === 'project'
      ? projects.find((project) => project.id === ref.id)?.name
      : ref.type === 'vehicle'
        ? vehicles.find((vehicle) => vehicle.id === ref.id)?.name
        : ref.type === 'person'
          ? people.get(ref.id)?.name
          : receipts.find((receipt) => receipt.id === ref.id)?.vendor &&
            `${receipts.find((receipt) => receipt.id === ref.id)!.vendor} receipt`;
  const visibleRef = (ref: AttachmentRef) => Boolean(name(ref));
  const personal = workspace.space.kind === 'personal';
  const device = storageFor(workspace).storage === 'device';

  const expiring = files.filter((file) => file.expiresAt && daysUntil(file.expiresAt) <= 30);
  const on = (file: FileRecord, type: AttachmentRef['type']) =>
    file.attachedTo.some((ref) => ref.type === type && visibleRef(ref));
  // Views follow what a file belongs to and where it came from, not a folder tree.
  const views: { id: string; label: string; match: (file: FileRecord) => boolean }[] = [
    { id: 'expiring', label: 'Expiring soon', match: (file) => expiring.includes(file) },
    {
      id: 'projects',
      label: workProfile(workspace.space).plural,
      match: (file) => on(file, 'project'),
    },
    { id: 'vehicles', label: 'Vehicles', match: (file) => on(file, 'vehicle') },
    { id: 'people', label: 'People', match: (file) => on(file, 'person') },
    { id: 'photos', label: 'Photos', match: (file) => file.kind === 'image' && !file.source },
    { id: 'receipts', label: 'Receipt photos', match: (file) => file.source === 'receipts' },
    {
      id: 'made',
      label: 'Made with tools',
      match: (file) => ['pdf', 'images', 'qr'].includes(file.source ?? ''),
    },
    {
      id: 'loose',
      label: personal ? 'Documents' : 'Company',
      match: (file) => !file.attachedTo.some(visibleRef) && !file.source && file.kind !== 'image',
    },
  ];
  const counted = views
    .map((item) => ({ ...item, count: files.filter(item.match).length }))
    .filter((item) => item.count > 0);
  const inTrashView = view === 'trash' && trash.length > 0;
  const current = counted.find((item) => item.id === view);
  const matching = (inTrashView ? trash : files)
    .filter((file) => !folder || file.folder === folder)
    .filter((file) => inTrashView || !current || current.match(file))
    .filter((file) => !by || file.createdBy === by)
    .filter(
      (file) =>
        !q ||
        file.name.toLowerCase().includes(q) ||
        file.originalName?.toLowerCase().includes(q) ||
        file.folder.toLowerCase().includes(q) ||
        originOf(file).label.toLowerCase().includes(q) ||
        file.attachedTo.some((ref) => name(ref)?.toLowerCase().includes(q)),
    );
  const shown = all ? matching : matching.slice(0, PAGE);
  const linksFor = (file: FileRecord) =>
    file.attachedTo
      .filter(visibleRef)
      .filter((ref) => ref.type !== 'receipt')
      .map((ref) => ({ type: ref.type, label: name(ref)! }));
  const wanted = typeof query.file === 'string' ? query.file : undefined;
  const selected = wanted
    ? (files.find((file) => file.id === wanted) ?? trash.find((file) => file.id === wanted))
    : undefined;
  // Previews for what's on screen, signed together — one request, not one per photo.
  const fileViews = await viewsFor(workspace, selected ? [...shown, selected] : shown);
  const uploaders = Array.from(new Set(files.map((file) => file.createdBy)))
    .map((id) => people.get(id))
    .filter((person): person is NonNullable<typeof person> => Boolean(person))
    .sort((a, b) => a.name.localeCompare(b.name));
  const receiptOf = (file: FileRecord) =>
    receipts.find((receipt) => receipt.fileId === file.id) ??
    receipts.find((receipt) =>
      file.attachedTo.some((ref) => ref.type === 'receipt' && ref.id === receipt.id),
    );

  const access = (file: FileRecord) => {
    const onRecords = file.attachedTo.filter(visibleRef).map((ref) => name(ref));
    if (file.source === 'brand') return `Everyone in ${workspace.space.name}, guests included.`;
    if (file.source === 'receipts')
      return receiptOf(file)
        ? 'Whoever sent the receipt, and the people who review receipts here.'
        : 'Only you, until it’s on a receipt.';
    switch (file.access) {
      case 'private':
        return personal
          ? 'Only you. Personal Spaces are private.'
          : 'Only the person who uploaded it.';
      case 'managers':
        return `Owners, admins and managers of ${workspace.space.name}.`;
      case 'shared': {
        const guests = members.filter(
          (member) =>
            member.role === 'guest' &&
            file.attachedTo.some((ref) => member.projectIds?.includes(ref.id)),
        );
        return `Everyone on ${onRecords.join(', ') || 'the project'}${guests.length ? `, including guest ${guests.map((guest) => guest.person.name).join(', ')}` : ''}.`;
      }
      default:
        return onRecords.length
          ? `Everyone who can open ${onRecords.join(', ')}, plus managers.`
          : `Everyone in ${workspace.space.name} except guests.`;
    }
  };

  const link = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({
      view: view === 'all' ? undefined : view,
      folder,
      by,
      q: q || undefined,
      ...params,
    }))
      if (value) next.set(key, value);
    const text = next.toString();
    return `${base}/files${text ? `?${text}` : ''}`;
  };

  const selectedView = selected ? fileViews[selected.id] : undefined;
  const selectedType = selected ? typeByMime(selected.mimeType) : undefined;
  const receipt = selected ? receiptOf(selected) : undefined;
  const locked = selected
    ? selected.source === 'brand' && workspace.space.logo?.fileId === selected.id
      ? 'This is the business logo. Change it in Settings.'
      : receipt
        ? 'This photo belongs to a receipt, so it stays with the receipt.'
        : undefined
    : undefined;

  return (
    <Page wide>
      <PageHeader
        title="Files"
        description={
          personal
            ? 'Your documents and everything your tools made. Private to you.'
            : 'Contracts, permits, photos and paperwork — each one attached to the project, vehicle or person it belongs to.'
        }
        actions={
          <CreateButton request="file" variant="primary" icon="upload">
            Upload
          </CreateButton>
        }
      />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Chips
          active={folder ? '' : inTrashView ? 'trash' : (current?.id ?? 'all')}
          items={[
            { id: 'all', label: 'All files', href: `${base}/files`, count: files.length },
            ...counted.map((item) => ({
              id: item.id,
              label: item.label,
              href: link({ view: item.id, folder: undefined, file: undefined }),
              count: item.count,
            })),
            ...(trash.length
              ? [
                  {
                    id: 'trash',
                    label: 'Trash',
                    href: link({ view: 'trash', folder: undefined, file: undefined }),
                    count: trash.length,
                  },
                ]
              : []),
            ...(folder
              ? [{ id: '', label: `Folder: ${folder}`, href: link({ folder: undefined }) }]
              : []),
          ]}
        />
        <div className="flex gap-2 lg:ml-auto">
          {!personal && uploaders.length > 1 && (
            <LinkSelect
              label="Added by"
              value={by ?? ''}
              className="lg:w-44"
              options={[
                { value: '', label: 'Anyone', href: link({ by: undefined, file: undefined }) },
                ...uploaders.map((person) => ({
                  value: person.id,
                  label: person.id === me ? 'You' : person.name,
                  href: link({ by: person.id, file: undefined }),
                })),
              ]}
            />
          )}
          <form
            action={`${base}/files`}
            className="relative flex-1 lg:w-64 lg:flex-none"
            role="search"
          >
            {view !== 'all' && <input type="hidden" name="view" value={view} />}
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              name="q"
              defaultValue={q}
              placeholder="Search files"
              aria-label="Search files"
              className={cn(inputClass, 'pl-9 lg:pl-9')}
            />
          </form>
        </div>
      </div>

      <div className={cn('grid gap-5', selected && 'lg:grid-cols-[minmax(0,1fr)_380px]')}>
        {selected && (
          <aside className="order-first lg:order-last" aria-label={`File: ${selected.name}`}>
            <Panel className="sticky top-16 overflow-hidden">
              <div className="relative grid h-56 place-items-center overflow-hidden bg-subtle">
                {selected.kind === 'image' &&
                (selectedView?.preview || selectedView?.state === 'device') ? (
                  <FilePicture
                    file={selected}
                    view={selectedView}
                    fit="contain"
                    iconSize={30}
                    className="absolute inset-0 size-full p-2"
                  />
                ) : selected.kind === 'image' && selected.preview ? (
                  <span className="absolute inset-0" style={{ background: selected.preview }} />
                ) : (
                  <FilePicture
                    file={selected}
                    view={selectedView}
                    iconSize={30}
                    className="size-20 rounded-[18px] shadow-card"
                  />
                )}
                <Link
                  href={link({ file: undefined })}
                  scroll={false}
                  aria-label="Close"
                  className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-surface/90 text-ink shadow-card hover:bg-surface"
                >
                  <Icon name="x" size={16} />
                </Link>
              </div>
              <div className="grid gap-4 p-4">
                <div>
                  <h2 className="text-[16px] leading-snug font-semibold break-words">
                    {selected.name}
                  </h2>
                  <p className="mt-1 text-[12.5px] text-muted">
                    {[
                      selectedType?.label ?? selected.kind.toUpperCase(),
                      formatBytes(selected.size),
                      selected.pages ? `${selected.pages} pages` : undefined,
                      selected.width && selected.height
                        ? `${selected.width} × ${selected.height}`
                        : undefined,
                      selected.folder,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {selected.originalName && selected.originalName !== selected.name && (
                    <p className="mt-0.5 text-[12px] text-faint">
                      Originally {selected.originalName}
                    </p>
                  )}
                </div>
                {selected.expiresAt && (
                  <p
                    className={cn(
                      'flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px]',
                      daysUntil(selected.expiresAt) <= 30
                        ? 'bg-caution-soft text-caution'
                        : 'bg-subtle text-ink-2',
                    )}
                  >
                    <Icon name="clock" size={15} /> Expires{' '}
                    {formatDate(selected.expiresAt, tz, true)} · in {daysUntil(selected.expiresAt)}{' '}
                    days
                  </p>
                )}
                {!selected.deletedAt && <FileButtons file={selected} view={selectedView} />}
                <dl className="grid gap-3 text-[13px]">
                  <div>
                    <dt className="label mb-1.5">Where it came from</dt>
                    <dd className="flex items-center gap-2 text-ink-2">
                      <Icon name={originOf(selected).icon} size={15} className="text-muted" />
                      {selected.source && ['pdf', 'images', 'qr'].includes(selected.source) ? (
                        <Link
                          href={`${base}/tools/${selected.source}`}
                          className="font-medium text-ink hover:underline"
                        >
                          {originOf(selected).label}
                        </Link>
                      ) : receipt ? (
                        <Link
                          href={`${base}/tools/receipts?receipt=${receipt.id}`}
                          className="font-medium text-ink hover:underline"
                        >
                          Photo of the {receipt.vendor} receipt
                        </Link>
                      ) : (
                        originOf(selected).label
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="label mb-1.5">Belongs to</dt>
                    <dd>
                      {linksFor(selected).length ? (
                        <Relations
                          base={base}
                          label="Belongs to"
                          items={selected.attachedTo
                            .filter(visibleRef)
                            .flatMap((ref): Relation[] => {
                              if (ref.type === 'project') {
                                const project = projects.find((item) => item.id === ref.id)!;
                                return [
                                  {
                                    type: 'project' as const,
                                    id: ref.id,
                                    label: project.name,
                                    color: project.color,
                                  },
                                ];
                              }
                              if (ref.type === 'vehicle')
                                return [
                                  { type: 'vehicle' as const, id: ref.id, label: name(ref)! },
                                ];
                              if (ref.type === 'person') {
                                const person = people.get(ref.id)!;
                                return [
                                  {
                                    type: 'person' as const,
                                    id: ref.id,
                                    label: person.name,
                                    person,
                                  },
                                ];
                              }
                              return [];
                            })}
                          canOpen={{
                            person: can('people.view') && workspace.space.kind === 'business',
                          }}
                        />
                      ) : (
                        <span className="text-muted">Nothing — it lives in {selected.folder}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="label mb-1.5">Added by</dt>
                    <dd className="flex items-center gap-2">
                      {people.get(selected.createdBy) && (
                        <Avatar person={people.get(selected.createdBy)!} size="sm" />
                      )}
                      {people.get(selected.createdBy)?.name ?? 'A former member'} ·{' '}
                      {formatRelative(selected.createdAt, tz)}
                    </dd>
                  </div>
                  <div>
                    <dt className="label mb-1.5">Who can open it</dt>
                    <dd className="flex gap-2 text-ink-2">
                      <Icon name="lock" size={14} className="mt-0.5 shrink-0 text-muted" />
                      {access(selected)}
                    </dd>
                  </div>
                </dl>
                <FileManage
                  file={selected}
                  canChange={selected.createdBy === me || managesFiles}
                  locked={locked}
                />
                {selected.kind === 'pdf' && !selected.deletedAt && (
                  <Link
                    href={`${base}/tools/pdf`}
                    className="flex items-center gap-2 text-[13px] font-medium text-ink-2 hover:text-ink"
                  >
                    <Icon name="pdf" size={15} /> Merge or split PDFs with the PDF tool
                  </Link>
                )}
              </div>
            </Panel>
          </aside>
        )}

        <div className="grid content-start gap-3">
          <Panel className="self-start">
            {shown.length ? (
              <ul className="row-divide py-1">
                {shown.map((file) => (
                  <li key={file.id} className={cn(selected?.id === file.id && 'bg-signal-soft/60')}>
                    <FileRow
                      file={file}
                      base={base}
                      people={people}
                      timezone={tz}
                      links={linksFor(file)}
                      context={file.folder}
                      view={fileViews[file.id]}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={inTrashView ? 'trash' : 'files'}
                title={
                  q ? `No files match “${q}”` : inTrashView ? 'Trash is empty' : 'No files here yet'
                }
                action={
                  inTrashView ? undefined : (
                    <CreateButton request="file" variant="primary">
                      Upload files
                    </CreateButton>
                  )
                }
              >
                {personal
                  ? 'Merged PDFs, resized images, QR codes and your own documents live here.'
                  : 'Upload a file and attach it to a project, vehicle or person.'}
              </EmptyState>
            )}
            {matching.length > shown.length && (
              <div className="border-t border-line px-4 py-3 text-center">
                <Link
                  href={link({ all: '1' })}
                  scroll={false}
                  className="text-[13.5px] font-medium text-signal-ink hover:underline"
                >
                  Show all {matching.length}
                </Link>
              </div>
            )}
          </Panel>
          <p className="px-1 text-[12px] text-faint">
            {device
              ? 'Preview: files you add are kept in this browser until you reset the demo. Samples keep their details only.'
              : stored !== null
                ? `${formatBytes(stored)} stored in ${workspace.space.name}, Trash included.`
                : 'Files are private to this Space. Links to open them last a minute.'}
          </p>
        </div>
      </div>
    </Page>
  );
}
