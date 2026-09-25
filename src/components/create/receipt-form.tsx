'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createReceipt, resubmitReceipt } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/shell/workspace-context';
import { formatCurrency } from '@/lib/platform/format';
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

type Photo = { kind: 'file'; url: string; name: string; pdf: boolean } | { kind: 'sample' };

/**
 * Receipt capture. The photo stays on this device in the preview; reading the fields from it
 * automatically arrives with the production build.
 */
export function ReceiptForm({ request, onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const mine = workspace.options.vehicles.find(
    (vehicle) => vehicle.assignedTo === workspace.person.id,
  );
  const attached = request.attachTo;
  // Fixing a returned receipt (or finishing a draft) starts from what was saved.
  const editing = request.edit?.kind === 'receipt' ? request.edit.record : undefined;
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [category, setCategory] = useState<ReceiptCategory>(
    editing?.category ??
      (request.preset?.category as ReceiptCategory) ??
      (mine ? 'fuel' : 'materials'),
  );
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

  useEffect(
    () => () => {
      if (photo?.kind === 'file') URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  const business = workspace.space.kind === 'business';
  const needsApproval = business && !workspace.can('expenses.approve');
  const payments = [
    ...(vehicle?.fuelCardLast4 ? [`Fuel card ••${vehicle.fuelCardLast4}`] : []),
    ...(business ? ['Company card', 'Personal card (reimburse me)'] : ['Card', 'Cash']),
  ];
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

  const values = () => ({
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
  });

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            editing
              ? resubmitReceipt(workspace.space.slug, editing.id, values())
              : createReceipt(workspace.space.slug, values()),
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
      {/* Capture */}
      <input
        ref={fileInput}
        id={`${id}-photo`}
        type="file"
        accept="image/*,application/pdf,.heic,.heif"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setPhoto({
            kind: 'file',
            url: URL.createObjectURL(file),
            name: file.name,
            pdf: file.type === 'application/pdf',
          });
          event.target.value = '';
        }}
      />
      {photo ? (
        <div className="mt-1 flex gap-4 rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {photo.kind === 'sample' ? (
            <SampleReceipt odometer={odometer} />
          ) : photo.pdf ? (
            <span className="grid h-28 w-20 place-items-center rounded-[8px] bg-surface text-muted shadow-card">
              <Icon name="pdf" size={26} />
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.url}
              alt="Receipt photo"
              className="h-28 w-20 rounded-[8px] object-cover shadow-card"
            />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-[14px] font-medium text-ink">
              {photo.kind === 'sample' ? 'Sample receipt' : photo.name}
            </p>
            <p className="mt-1 text-[13px] leading-snug text-muted">
              {photo.kind === 'sample'
                ? 'Filled in the way automatic reading will. Check each field.'
                : 'Automatic reading arrives with the production build. Fill in the details below.'}
            </p>
            <div className="mt-auto flex gap-2 pt-2">
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Icon name="camera" size={15} /> Retake
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPhoto(null)}>
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
            <span className="text-[13px] text-muted">or choose a JPG, HEIC or PDF</span>
          </label>
          <button
            type="button"
            onClick={fillSample}
            className="flex items-center justify-center gap-1.5 rounded-[12px] py-2 text-[13.5px] font-medium text-signal-ink hover:bg-signal-soft"
          >
            <Icon name="sparkles" size={15} /> Try a sample receipt
          </button>
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
        {workspace.options.vehicles.length > 0 && (
          <Field label="Vehicle" htmlFor={`${id}-vehicle`} optional>
            <Select
              id={`${id}-vehicle`}
              value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}
            >
              <option value="">No vehicle</option>
              {workspace.options.vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.assignedTo === workspace.person.id ? ' (yours)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {workspace.options.projects.length > 0 && (
          <Field label={workspace.labels.project} htmlFor={`${id}-project`} optional>
            <Select
              id={`${id}-project`}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">None</option>
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
            : business
              ? 'Filed as approved'
              : undefined
        }
      >
        {!editing && (
          <Button
            variant="ghost"
            disabled={pending || !vendor}
            onClick={() =>
              submit(() => createReceipt(workspace.space.slug, { ...values(), draft: true }), {
                title: 'Draft saved',
                href: workspace.href('/tools/receipts'),
              })
            }
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
