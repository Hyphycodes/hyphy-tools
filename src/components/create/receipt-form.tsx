'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createReceipt, resubmitReceipt } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import {
  answerProblems,
  answersOf,
  FieldInputs,
  firstProblem,
} from '@/components/fields/field-inputs';
import { useWorkspace } from '@/components/shell/workspace-context';
import { acceptFor } from '@/lib/files/rules';
import { retryFile, uploadFile, UploadError, type UploadStage } from '@/lib/files/upload';
import { formatCurrency } from '@/lib/platform/format';
import { PERSONAL_PAYMENT } from '@/lib/platform/payments';
import type { ReceiptCategory } from '@/lib/platform/types';
import { useSubmit, type FormProps } from './create-sheets';
import {
  ChoiceChips,
  dateInput,
  EditNote,
  FormFooter,
  Section,
  SubmitButton,
  todayInput,
} from './parts';

const CATEGORIES: {
  value: ReceiptCategory;
  label: string;
  icon: 'fuel' | 'wrench' | 'receipt' | 'archive' | 'circle';
}[] = [
  { value: 'fuel', label: 'Fuel', icon: 'fuel' },
  { value: 'materials', label: 'Materials', icon: 'wrench' },
  { value: 'meals', label: 'Meals', icon: 'receipt' },
  { value: 'supplies', label: 'Supplies', icon: 'archive' },
  { value: 'equipment', label: 'Equipment', icon: 'wrench' },
  { value: 'other', label: 'Other', icon: 'circle' },
];

type Photo =
  | {
      kind: 'file';
      file: File;
      /** A local preview while (and after) it uploads; null for files a browser can't show. */
      url: string | null;
      pdf: boolean;
      stage: UploadStage | 'done' | 'failed';
      progress: number;
      fileId?: string;
      error?: string;
      retry?: { fileId?: string } | null;
    }
  /** The photo a returned receipt or draft already has. */
  | { kind: 'saved'; fileId: string }
  | { kind: 'sample' };

/**
 * Receipt capture. The photo is uploaded as soon as it's taken — through the same pipeline as
 * every file — so it's stored by the time the details are in; the receipt then points at it, and
 * approvers see the real image. Reading the fields from it automatically comes later.
 */
export function ReceiptForm({ request, onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit, fail } = useSubmit(onDone);
  const mine = workspace.options.vehicles.find(
    (vehicle) => vehicle.assignedTo === workspace.person.id,
  );
  const attached = request.attachTo;
  // What this business asks of a receipt: its rules and its own fields.
  const rules = workspace.setup.rules.receipts;
  const fields = workspace.setup.fields.filter((field) => field.appliesTo === 'receipts');
  // Fixing a returned receipt (or finishing a draft) starts from what was saved.
  const editing = request.edit?.kind === 'receipt' ? request.edit.record : undefined;
  const [photo, setPhoto] = useState<Photo | null>(
    editing?.fileId ? { kind: 'saved', fileId: editing.fileId } : null,
  );
  const uploading = useRef<Promise<string | null> | null>(null);
  const rulesPhoto = workspace.setup.rules.receipts.photo;
  const [category, setCategory] = useState<ReceiptCategory>(
    editing?.category ??
      (request.preset?.category as ReceiptCategory) ??
      rules.defaultCategory ??
      (mine ? 'fuel' : 'materials'),
  );
  const [answers, setAnswers] = useState(() =>
    answersOf(fields, editing?.custom, workspace.space.timezone),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [vendor, setVendor] = useState(editing?.vendor ?? '');
  const [total, setTotal] = useState(editing?.total ? String(editing.total) : '');
  const [date, setDate] = useState(() =>
    editing
      ? dateInput(editing.date, workspace.space.timezone)
      : todayInput(workspace.space.timezone),
  );
  const [gallons, setGallons] = useState(editing?.gallons ? String(editing.gallons) : '');
  const [odometer, setOdometer] = useState(editing?.odometer ? String(editing.odometer) : '');
  const [vehicleId, setVehicleId] = useState(
    editing
      ? (editing.vehicleId ?? '')
      : attached?.type === 'vehicle'
        ? attached.id
        : category === 'fuel'
          ? (mine?.id ?? '')
          : '',
  );
  const [projectId, setProjectId] = useState(
    editing
      ? (editing.projectId ?? '')
      : attached?.type === 'project'
        ? attached.id
        : attached?.type === 'vehicle' || workspace.space.kind === 'personal'
          ? ''
          : (workspace.options.currentProjectId ?? ''),
  );
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const vehicle = workspace.options.vehicles.find((item) => item.id === vehicleId);
  const [payment, setPayment] = useState(editing?.paymentMethod ?? '');
  const fileInput = useRef<HTMLInputElement>(null);

  const previewUrl = photo?.kind === 'file' ? photo.url : null;
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  /** Uploads the photo now; the receipt refers to it once it's stored. */
  function takePhoto(file: File, again?: string) {
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const showable = !pdf && /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    setPhoto((current) => ({
      kind: 'file',
      file,
      url:
        current?.kind === 'file' && current.file === file
          ? current.url
          : showable
            ? URL.createObjectURL(file)
            : null,
      pdf,
      stage: 'checking',
      progress: 0,
    }));
    const patch = (change: Partial<Extract<Photo, { kind: 'file' }>>) =>
      setPhoto((current) =>
        current?.kind === 'file' && current.file === file ? { ...current, ...change } : current,
      );
    const options = {
      purpose: 'receipt' as const,
      onStage: (stage: UploadStage) => patch({ stage }),
      onProgress: (progress: number) => patch({ progress }),
    };
    const work = (
      again
        ? retryFile(workspace.space.slug, again, file, options)
        : uploadFile(workspace.space.slug, file, options)
    ).then(
      (saved) => {
        patch({ stage: 'done', fileId: saved.fileId, error: undefined });
        return saved.fileId;
      },
      (error: unknown) => {
        patch({
          stage: 'failed',
          error:
            error instanceof UploadError ? error.message : 'The photo didn’t upload. Try again.',
          retry: error instanceof UploadError ? error.retry : null,
        });
        return null;
      },
    );
    uploading.current = work;
    return work;
  }

  /** The photo's stored file, once it's there (waiting for an upload still going). */
  async function photoId(): Promise<string | undefined | false> {
    if (!photo || photo.kind === 'sample') return undefined;
    if (photo.kind === 'saved') return photo.fileId;
    if (photo.fileId) return photo.fileId;
    const id = uploading.current ? await uploading.current : null;
    return id ?? false;
  }

  const business = workspace.space.kind === 'business';
  // Approvers file straight through; others wait unless this business doesn't ask (or not below
  // an amount).
  const approval = workspace.setup.approval.receipt;
  const needsApproval =
    Boolean(approval) &&
    (approval!.mode === 'always' ||
      (approval!.mode === 'over' && Number(total || 0) > (approval!.over ?? 0)));
  const payments = [
    ...(vehicle?.fuelCardLast4 ? [`Fuel card ••${vehicle.fuelCardLast4}`] : []),
    ...(business
      ? ['Company card', ...(rules.personalPayment ? [PERSONAL_PAYMENT] : [])]
      : ['Card', 'Cash']),
  ];
  const showVehicle = rules.vehicle !== 'off' && workspace.options.vehicles.length > 0;
  const showProject = rules.project !== 'off' && workspace.options.projects.length > 0;
  /** What the business requires before this can be sent, found before the server has to say it. */
  const missing = () => {
    const found = answerProblems(fields, 'receipts', answers);
    setProblems(found);
    if (!vendor.trim()) return 'Add where it was from.';
    if (showProject && rules.project === 'required' && !projectId)
      return `Choose the ${workspace.labels.project.toLowerCase()} this receipt is for.`;
    if (showVehicle && rules.vehicle === 'required' && !vehicleId)
      return `Choose the ${workspace.labels.vehicle.toLowerCase()} this receipt is for.`;
    return firstProblem(fields, found);
  };
  if (payment && !payments.includes(payment)) payments.unshift(payment);

  function fillSample() {
    const start = vehicle?.odometer ?? mine?.odometer ?? 61204;
    setPhoto({ kind: 'sample' });
    setCategory('fuel');
    setVendor('Shell');
    setTotal('64.18');
    setGallons('17.2');
    setOdometer(String(start + 214));
    if (mine && !vehicleId) setVehicleId(mine.id);
  }

  const values = (fileId?: string) => ({
    fileId,
    vendor,
    total,
    date,
    category,
    gallons: category === 'fuel' ? gallons : '',
    odometer: category === 'fuel' ? odometer : '',
    vehicleId,
    projectId,
    paymentMethod: payment || payments[0],
    notes,
    custom: answers,
  });

  return (
    <form
      id={formId}
      // The business's requirements are said in Hyphy's words, not the browser's bubble.
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const problem = missing();
        if (problem) return fail(problem);
        const fileId = await photoId();
        if (fileId === false)
          return fail('The photo didn’t upload. Try again, or remove it to send without one.');
        if (rulesPhoto === 'required' && !fileId)
          return fail(
            photo?.kind === 'sample'
              ? 'The sample isn’t a real photo. Take a photo of the receipt.'
              : 'Add a photo of the receipt.',
          );
        submit(
          () =>
            editing
              ? resubmitReceipt(workspace.space.slug, editing.id, values(fileId))
              : createReceipt(workspace.space.slug, values(fileId)),
          {
            title: `${vendor || 'Receipt'} · ${total ? formatCurrency(Number(total)) : 'no total yet'}`,
            href: workspace.href(
              editing ? `/tools/receipts?receipt=${editing.id}` : '/tools/receipts',
            ),
          },
        );
      }}
    >
      {request.edit && request.edit.record.status === 'returned' && (
        <EditNote reason={request.edit.reason} reviewer={request.edit.reviewer} />
      )}
      {/* Capture: the camera, or a photo or PDF already on the device. */}
      <input
        ref={fileInput}
        id={`${id}-photo`}
        type="file"
        accept={acceptFor('receipt')}
        capture="environment"
        className="sr-only"
        aria-describedby={`${id}-photo-hint`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void takePhoto(file);
          event.target.value = '';
        }}
      />
      <input
        id={`${id}-pick`}
        type="file"
        accept={acceptFor('receipt')}
        className="sr-only"
        aria-describedby={`${id}-photo-hint`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void takePhoto(file);
          event.target.value = '';
        }}
      />
      {photo ? (
        <div className="mt-1 flex gap-4 rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {photo.kind === 'sample' ? (
            <SampleReceipt odometer={odometer} />
          ) : photo.kind === 'file' && photo.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.url}
              alt="Receipt photo"
              className="h-28 w-20 rounded-[8px] object-cover shadow-card"
            />
          ) : (
            <span className="grid h-28 w-20 place-items-center rounded-[8px] bg-surface text-muted shadow-card">
              <Icon name={photo.kind === 'file' && photo.pdf ? 'pdf' : 'image'} size={26} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-[14px] font-medium text-ink">
              {photo.kind === 'sample'
                ? 'Sample receipt'
                : photo.kind === 'saved'
                  ? 'Photo attached'
                  : photo.file.name}
            </p>
            <p
              className={cn(
                'mt-1 text-[13px] leading-snug',
                photo.kind === 'file' && photo.stage === 'failed' ? 'text-critical' : 'text-muted',
              )}
              role={photo.kind === 'file' && photo.stage === 'failed' ? 'alert' : 'status'}
            >
              {photo.kind === 'sample'
                ? 'Filled in the way automatic reading will. Check each field.'
                : photo.kind === 'saved'
                  ? 'It stays with the receipt. Replace it if it’s wrong.'
                  : photo.stage === 'failed'
                    ? photo.error
                    : photo.stage === 'done'
                      ? workspace.fileStorage === 'device'
                        ? 'Saved in this browser (preview). Fill in the details below.'
                        : 'Uploaded. Fill in the details below.'
                      : photo.stage === 'uploading'
                        ? `Uploading ${Math.round(photo.progress * 100)}%…`
                        : 'Preparing the upload…'}
            </p>
            {photo.kind === 'file' && photo.stage !== 'done' && photo.stage !== 'failed' && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-well" aria-hidden="true">
                <span
                  className="block h-full rounded-full bg-signal transition-[width] duration-200"
                  style={{ width: `${Math.max(6, Math.round(photo.progress * 100))}%` }}
                />
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-2">
              {photo.kind === 'file' && photo.stage === 'failed' && (
                <Button size="sm" onClick={() => void takePhoto(photo.file, photo.retry?.fileId)}>
                  <Icon name="refresh" size={15} /> Try again
                </Button>
              )}
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Icon name="camera" size={15} /> {photo.kind === 'saved' ? 'Replace' : 'Retake'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  uploading.current = null;
                  setPhoto(null);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-1 grid gap-2">
          <label
            htmlFor={`${id}-photo`}
            className="group flex flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong bg-subtle px-4 py-7 text-center transition-colors hover:border-ink/30 hover:bg-well/60"
          >
            <span className="grid size-12 place-items-center rounded-full bg-tool-receipt text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-105">
              <Icon name="camera" size={22} />
            </span>
            <span className="text-[15px] font-semibold text-ink">Take a photo</span>
            <span id={`${id}-photo-hint`} className="text-[13px] text-muted">
              {rulesPhoto === 'required'
                ? `${workspace.space.name} needs a photo of every receipt`
                : 'JPG, PNG, HEIC or PDF, up to 20 MB'}
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <label
              htmlFor={`${id}-pick`}
              className="flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium text-ink-2 hover:bg-ink/5"
            >
              <Icon name="upload" size={15} /> Choose a photo or PDF
            </label>
            <button
              type="button"
              onClick={fillSample}
              className="flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] px-3 py-2 text-[13.5px] font-medium text-signal-ink hover:bg-signal-soft"
            >
              <Icon name="sparkles" size={15} /> Try a sample receipt
            </button>
          </div>
        </div>
      )}

      <Section title="Details">
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Where" htmlFor={`${id}-vendor`}>
            <Input
              id={`${id}-vendor`}
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
              placeholder="Shell, Home Depot…"
              list={`${id}-vendors`}
              required
              autoComplete="off"
            />
            <datalist id={`${id}-vendors`}>
              {[
                'Shell',
                'BP',
                'Speedway',
                'Mobil',
                'Costco Gas',
                'Home Depot',
                'Menards',
                'Lowe’s',
              ].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Total" htmlFor={`${id}-total`}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                $
              </span>
              <Input
                id={`${id}-total`}
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="num pl-7"
              />
            </div>
          </Field>
        </div>
        <Field label="Date" htmlFor={`${id}-date`}>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </Field>
        <div>
          <p className="mb-2 text-[13.5px] font-medium text-ink-2">Category</p>
          <ChoiceChips
            label="Category"
            value={category}
            options={CATEGORIES}
            onChange={setCategory}
          />
        </div>
        {category === 'fuel' && (
          <div className="grid animate-rise grid-cols-2 gap-3">
            <Field label="Gallons" htmlFor={`${id}-gallons`}>
              <Input
                id={`${id}-gallons`}
                value={gallons}
                onChange={(event) => setGallons(event.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="num"
              />
            </Field>
            <Field
              label="Odometer"
              htmlFor={`${id}-odo`}
              hint={vehicle ? `Last: ${vehicle.odometer.toLocaleString('en-US')}` : undefined}
            >
              <Input
                id={`${id}-odo`}
                value={odometer}
                onChange={(event) => setOdometer(event.target.value)}
                inputMode="numeric"
                placeholder="miles"
                className="num"
              />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Where it goes">
        {showProject && (
          <Field
            label={workspace.labels.project}
            htmlFor={`${id}-project`}
            optional={rules.project !== 'required'}
          >
            <Select
              id={`${id}-project`}
              value={projectId}
              required={rules.project === 'required'}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{rules.project === 'required' ? 'Choose one' : 'None'}</option>
              {workspace.options.projects
                .filter((project) => project.status !== 'done')
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {showVehicle && (
          <Field
            label={workspace.labels.vehicle}
            htmlFor={`${id}-vehicle`}
            optional={rules.vehicle !== 'required'}
          >
            <Select
              id={`${id}-vehicle`}
              value={vehicleId}
              required={rules.vehicle === 'required'}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">
                {rules.vehicle === 'required'
                  ? 'Choose one'
                  : `No ${workspace.labels.vehicle.toLowerCase()}`}
              </option>
              {workspace.options.vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.assignedTo === workspace.person.id ? ' (yours)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <FieldInputs
          fields={fields}
          answers={answers}
          errors={problems}
          idPrefix={id}
          onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
        />
        <Field label="Paid with" htmlFor={`${id}-payment`}>
          <Select
            id={`${id}-payment`}
            value={payment || payments[0]}
            onChange={(event) => setPayment(event.target.value)}
          >
            {payments.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note" htmlFor={`${id}-notes`} optional>
          <Textarea
            id={`${id}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="What was it for?"
          />
        </Field>
      </Section>

      <FormFooter
        error={error}
        note={
          needsApproval
            ? 'Goes to your managers for approval'
            : business && approval
              ? 'Filed right away — no approval needed'
              : business
                ? 'Filed as approved'
                : undefined
        }
      >
        {!editing && (
          <Button
            variant="ghost"
            disabled={pending || !vendor}
            onClick={async () => {
              const fileId = await photoId();
              submit(
                () =>
                  createReceipt(workspace.space.slug, {
                    ...values(fileId || undefined),
                    draft: true,
                  }),
                { title: 'Draft saved', href: workspace.href('/tools/receipts') },
              );
            }}
          >
            Save draft
          </Button>
        )}
        <SubmitButton pending={pending}>
          {editing?.status === 'returned'
            ? 'Resubmit receipt'
            : needsApproval
              ? 'Submit for approval'
              : 'Save receipt'}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}

/** A little paper receipt, so the sample reads as a receipt at a glance. */
function SampleReceipt({ odometer }: { odometer: string }) {
  return (
    <div
      aria-label="Sample Shell receipt"
      className="relative w-24 shrink-0 bg-white px-2 pt-2.5 pb-4 font-mono text-[6.5px] leading-[1.45] text-ink/80 shadow-card [clip-path:polygon(0_0,100%_0,100%_calc(100%-4px),92%_100%,84%_calc(100%-4px),76%_100%,68%_calc(100%-4px),60%_100%,52%_calc(100%-4px),44%_100%,36%_calc(100%-4px),28%_100%,20%_calc(100%-4px),12%_100%,4%_calc(100%-4px),0_100%)]"
    >
      <p className="text-center text-[8px] font-bold text-ink">SHELL</p>
      <p className="text-center">OAK BROOK IL</p>
      <p className="mt-1.5">PUMP 06 · UNLEADED</p>
      <p className="flex justify-between">
        <span>GAL</span>
        <span>17.200</span>
      </p>
      <p className="flex justify-between">
        <span>PRICE</span>
        <span>3.731</span>
      </p>
      <p className="mt-1 flex justify-between font-bold text-ink">
        <span>TOTAL</span>
        <span>$64.18</span>
      </p>
      <p className="mt-1">ODO {odometer}</p>
      <p>FLEET ••6041</p>
    </div>
  );
}
