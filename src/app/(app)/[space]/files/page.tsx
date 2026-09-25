import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { Relations, type Relation } from '@/components/records/relations';
import { FileRow, FileThumb, sourceName } from '@/components/records/rows';
import { ToolGlyph } from '@/components/ui/marks';
import { getTool } from '@/lib/platform/tools';
import { workProfile } from '@/lib/platform/work';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import { daysUntil, formatBytes, formatDate, formatRelative } from '@/lib/platform/format';
import type { AttachmentRef, FileRecord } from '@/lib/platform/types';

export const metadata = { title: 'Files' };

/** Files are attached to the work they belong to, so the list can answer "whose is this?" */
export default async function FilesPage({ params, searchParams }: PageProps<'/[space]/files'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'files');
  const query = await searchParams;
  const view = String(query.view ?? 'all');
  const folder = typeof query.folder === 'string' ? query.folder : undefined;
  const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
  const [files, projects, vehicles, members] = await Promise.all([
    repo.files(),
    repo.projects(),
    repo.vehicles(),
    repo.members(),
  ]);

  const name = (ref: AttachmentRef) =>
    ref.type === 'project'
      ? projects.find((project) => project.id === ref.id)?.name
      : ref.type === 'vehicle'
        ? vehicles.find((vehicle) => vehicle.id === ref.id)?.name
        : ref.type === 'person'
          ? people.get(ref.id)?.name
          : 'Receipt';
  const visibleRef = (ref: AttachmentRef) => Boolean(name(ref));
  const personal = workspace.space.kind === 'personal';

  const expiring = files.filter((file) => file.expiresAt && daysUntil(file.expiresAt) <= 30);
  const on = (file: FileRecord, type: AttachmentRef['type']) =>
    file.attachedTo.some((ref) => ref.type === type && visibleRef(ref));
  // Views follow what a file belongs to, not where it sits in a folder tree.
  const views: { id: string; label: string; match: (file: FileRecord) => boolean }[] = [
    { id: 'expiring', label: 'Expiring soon', match: (file) => expiring.includes(file) },
    {
      id: 'projects',
      label: workProfile(workspace.space).plural,
      match: (file) => on(file, 'project'),
    },
    { id: 'vehicles', label: 'Vehicles', match: (file) => on(file, 'vehicle') },
    { id: 'people', label: 'People', match: (file) => on(file, 'person') },
    { id: 'photos', label: 'Photos', match: (file) => file.kind === 'image' },
    { id: 'made', label: 'Made with tools', match: (file) => Boolean(file.source) },
    {
      id: 'loose',
      label: personal ? 'Documents' : 'Company',
      match: (file) => !file.attachedTo.some(visibleRef) && !file.source && file.kind !== 'image',
    },
  ];
  const counted = views
    .map((item) => ({ ...item, count: files.filter(item.match).length }))
    .filter((item) => item.count > 0);
  const current = counted.find((item) => item.id === view);
  const shown = files
    .filter((file) => !folder || file.folder === folder)
    .filter((file) => !current || current.match(file))
    .filter(
      (file) =>
        !q ||
        file.name.toLowerCase().includes(q) ||
        file.folder.toLowerCase().includes(q) ||
        file.attachedTo.some((ref) => name(ref)?.toLowerCase().includes(q)),
    );
  const linksFor = (file: FileRecord) =>
    file.attachedTo
      .filter(visibleRef)
      .filter((ref) => ref.type !== 'receipt')
      .map((ref) => ({ type: ref.type, label: name(ref)! }));
  const selected =
    typeof query.file === 'string' ? files.find((file) => file.id === query.file) : undefined;

  const access = (file: FileRecord) => {
    const on = file.attachedTo.filter(visibleRef).map((ref) => name(ref));
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
        return `Everyone on ${on.join(', ') || 'the project'}${guests.length ? `, including guest ${guests.map((guest) => guest.person.name).join(', ')}` : ''}.`;
      }
      default:
        return on.length
          ? `Everyone who can open ${on.join(', ')}, plus managers.`
          : `Everyone in ${workspace.space.name} except guests.`;
    }
  };

  const link = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({
      view: view === 'all' ? undefined : view,
      folder,
      q: q || undefined,
      ...params,
    }))
      if (value) next.set(key, value);
    const text = next.toString();
    return `${base}/files${text ? `?${text}` : ''}`;
  };

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
          active={folder ? '' : (current?.id ?? 'all')}
          items={[
            { id: 'all', label: 'All files', href: `${base}/files`, count: files.length },
            ...counted.map((item) => ({
              id: item.id,
              label: item.label,
              href: link({ view: item.id, folder: undefined }),
              count: item.count,
            })),
            ...(folder
              ? [{ id: '', label: `Folder: ${folder}`, href: link({ folder: undefined }) }]
              : []),
          ]}
        />
        <form action={`${base}/files`} className="relative lg:ml-auto lg:w-64" role="search">
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

      <div className={cn('grid gap-5', selected && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        {selected && (
          <aside className="order-first lg:order-last">
            <Panel className="sticky top-16 overflow-hidden">
              <div
                className="relative grid h-44 place-items-center bg-subtle"
                style={
                  selected.kind === 'image' && selected.preview
                    ? { background: selected.preview }
                    : undefined
                }
              >
                {selected.kind !== 'image' && (
                  <div className="flex w-28 flex-col gap-1.5 rounded-[6px] bg-surface p-3 shadow-lift">
                    <FileThumb file={selected} size="sm" />
                    {[80, 100, 64, 92, 50].map((width, index) => (
                      <span
                        key={index}
                        className="h-1 rounded-full bg-well"
                        style={{ width: `${width}%` }}
                      />
                    ))}
                  </div>
                )}
                <Link
                  href={link({ file: undefined })}
                  scroll={false}
                  aria-label="Close"
                  className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-surface/90 text-ink shadow-card hover:bg-surface"
                >
                  <Icon name="x" size={16} />
                </Link>
              </div>
              <div className="p-4">
                <h2 className="text-[16px] leading-snug font-semibold break-words">
                  {selected.name}
                </h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  {[
                    formatBytes(selected.size),
                    selected.pages ? `${selected.pages} pages` : undefined,
                    selected.folder,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {selected.expiresAt && (
                  <p
                    className={cn(
                      'mt-3 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px]',
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
                <dl className="mt-4 grid gap-3 text-[13px]">
                  {selected.source && (
                    <div>
                      <dt className="label mb-1.5">Where it came from</dt>
                      <dd>
                        <Link
                          href={`${base}/tools/${selected.source}`}
                          className="inline-flex items-center gap-2 font-medium text-ink hover:underline"
                        >
                          <ToolGlyph tool={getTool(selected.source)!} size="sm" />
                          Made with the {sourceName[selected.source] ?? selected.source} tool
                        </Link>
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="label mb-1.5">Belongs to</dt>
                    <dd>
                      {selected.attachedTo.filter(visibleRef).length ? (
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
                      {people.get(selected.createdBy)?.name} ·{' '}
                      {formatRelative(selected.createdAt, tz)} · {selected.folder}
                    </dd>
                  </div>
                  <div>
                    <dt className="label mb-1.5">Who can open it</dt>
                    <dd className="flex gap-2 text-ink-2">
                      <Icon name="lock" size={14} className="mt-0.5 text-muted" />
                      {access(selected)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 flex gap-2">
                  <Button
                    variant="primary"
                    disabled
                    className="flex-1"
                    title="Preview files aren’t stored"
                  >
                    <Icon name="download" size={16} /> Download
                  </Button>
                  {selected.kind === 'pdf' && (
                    <Link
                      href={`${base}/tools/pdf`}
                      className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-surface px-4 text-[15px] font-medium shadow-card hover:bg-subtle lg:h-9 lg:text-[13.5px]"
                    >
                      <Icon name="pdf" size={16} /> PDF tools
                    </Link>
                  )}
                </div>
                <p className="mt-2 text-[12px] text-faint">
                  In this preview, Hyphy keeps a file’s details, not the file itself.
                </p>
              </div>
            </Panel>
          </aside>
        )}

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
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon="files"
              title={q ? `No files match “${q}”` : 'No files here yet'}
              action={
                <CreateButton request="file" variant="primary">
                  Upload files
                </CreateButton>
              }
            >
              {personal
                ? 'Merged PDFs, resized images and your own documents live here.'
                : 'Upload a file and attach it to a project, vehicle or person.'}
            </EmptyState>
          )}
        </Panel>
      </div>
    </Page>
  );
}
