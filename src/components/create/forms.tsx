'use client';
import { useId, useState } from 'react';
import {
  createMileage,
  createProject,
  createVehicle,
  invitePerson,
} from '@/app/(app)/[space]/actions';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/shell/workspace-context';
import { formatMiles } from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';
import type { ProjectStatus, Role } from '@/lib/platform/types';
import { useSubmit, type FormProps } from './create-sheets';
import { FormFooter, Section, SubmitButton, todayInput } from './parts';

/* ---------- Mileage ---------- */

export function MileageForm({ request, onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const mine = workspace.options.vehicles.find(
    (vehicle) => vehicle.assignedTo === workspace.person.id,
  );
  const [mode, setMode] = useState<'miles' | 'odometer'>('miles');
  const [date, setDate] = useState(() => todayInput(workspace.space.timezone));
  const [from, setFrom] = useState(workspace.options.places[0] ?? '');
  const [to, setTo] = useState('');
  const [miles, setMiles] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [vehicleId, setVehicleId] = useState(
    request.attachTo?.type === 'vehicle' ? request.attachTo.id : (mine?.id ?? ''),
  );
  const vehicle = workspace.options.vehicles.find((item) => item.id === vehicleId);
  const [start, setStart] = useState(vehicle ? String(vehicle.odometer) : '');
  const [end, setEnd] = useState('');
  const [projectId, setProjectId] = useState(
    request.attachTo?.type === 'project'
      ? request.attachTo.id
      : workspace.space.kind === 'business'
        ? (workspace.options.currentProjectId ?? '')
        : '',
  );
  const [purpose, setPurpose] = useState('');
  const recent = workspace.options.recentTrips;

  // Heading to a job site files the trip to that job.
  const pickDestination = (place: string) => {
    setTo(place);
    const project = workspace.options.projects.find((item) => item.name === place);
    if (project) setProjectId(project.id);
  };
  const repeat = (trip: (typeof recent)[number]) => {
    setMode('miles');
    setFrom(trip.from);
    setTo(trip.to);
    setRoundTrip(trip.roundTrip);
    setMiles(String(trip.roundTrip ? Math.round((trip.miles / 2) * 10) / 10 : trip.miles));
    setPurpose(trip.purpose);
    if (trip.vehicleId !== undefined) setVehicleId(trip.vehicleId);
    if (trip.projectId) setProjectId(trip.projectId);
  };

  const oneWay = mode === 'miles' ? Number(miles) : Number(end) - Number(start);
  const total =
    Number.isFinite(oneWay) && oneWay > 0
      ? mode === 'miles' && roundTrip
        ? oneWay * 2
        : oneWay
      : 0;
  const needsApproval = workspace.space.kind === 'business' && !workspace.can('expenses.approve');
  const places = workspace.options.places;

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            createMileage(workspace.space.slug, {
              date,
              from,
              to,
              miles: total ? Math.round(total * 10) / 10 : '',
              roundTrip: mode === 'miles' && roundTrip,
              purpose,
              vehicleId,
              projectId,
            }),
          {
            title: `${formatMiles(Math.round(total * 10) / 10)} logged`,
            href: workspace.href('/tools/mileage'),
          },
        );
      }}
    >
      {/* The number is the form: type miles straight into it, or tap a trip you've driven before. */}
      <div className="mt-1 rounded-[18px] bg-tool-miles/35 px-4 pt-3.5 pb-3 shadow-[inset_0_0_0_1px_rgb(0_0_0/.05)] transition-colors focus-within:bg-tool-miles/45">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={`${id}-${mode === 'miles' ? 'miles' : 'end'}`}
            className="label !text-ink/60"
          >
            {mode === 'miles' ? 'Miles one way' : 'Odometer at the end'}
          </label>
          <button
            type="button"
            onClick={() => setMode(mode === 'miles' ? 'odometer' : 'miles')}
            className="-mr-1 flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] text-ink/60 transition-colors hover:bg-white/50 hover:text-ink"
          >
            <Icon name={mode === 'miles' ? 'gauge' : 'route'} size={13} />
            {mode === 'miles' ? 'Use odometer' : 'Enter miles'}
          </button>
        </div>
        {mode === 'miles' ? (
          // The whole row focuses the number, and “mi” rides right behind it as you type.
          <div
            className="mt-1 flex cursor-text items-baseline gap-1.5"
            onClick={(event) => event.currentTarget.querySelector('input')?.focus()}
          >
            <input
              id={`${id}-miles`}
              value={miles}
              onChange={(event) => setMiles(event.target.value.replace(/[^0-9.]/g, ''))}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              size={1}
              style={{
                // Digits are ~0.6em in the display face, the point far narrower.
                width: `${[...(miles || '0')].reduce((sum, char) => sum + (char === '.' ? 0.28 : 0.62), 0.1)}em`,
              }}
              className="display num max-w-full min-w-0 bg-transparent text-[52px] leading-[1.05] text-ink caret-signal outline-none placeholder:text-ink/20"
              data-autofocus
            />
            <span className="text-[20px] font-medium text-ink/45">mi</span>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="rounded-[12px] bg-white/60 px-3 py-2">
              <span className="block text-[11.5px] text-ink/55">Start</span>
              <input
                id={`${id}-start`}
                value={start}
                onChange={(event) => setStart(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="num w-full bg-transparent text-[20px] font-semibold text-ink outline-none"
              />
            </label>
            <label className="rounded-[12px] bg-white px-3 py-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/.06)]">
              <span className="block text-[11.5px] text-ink/55">End</span>
              <input
                id={`${id}-end`}
                value={end}
                onChange={(event) => setEnd(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder={start}
                className="num w-full bg-transparent text-[20px] font-semibold text-ink outline-none placeholder:text-ink/25"
                data-autofocus
              />
            </label>
          </div>
        )}
        <div className="mt-3 flex min-h-8 flex-wrap items-center justify-between gap-2">
          {mode === 'miles' && (
            <div
              role="radiogroup"
              aria-label="Trip type"
              className="inline-flex rounded-full bg-white/55 p-0.5 shadow-[inset_0_0_0_1px_rgb(0_0_0/.05)]"
            >
              {[
                { value: false, label: 'One way' },
                { value: true, label: 'Round trip' },
              ].map((option) => (
                <button
                  key={option.label}
                  type="button"
                  role="radio"
                  aria-checked={roundTrip === option.value}
                  onClick={() => setRoundTrip(option.value)}
                  className={cn(
                    'h-8 rounded-full px-3 text-[13px] font-medium transition-all lg:h-7 lg:text-[12.5px]',
                    roundTrip === option.value
                      ? 'bg-ink text-white shadow-[0_2px_8px_-4px_rgb(22_21_15/.6)]'
                      : 'text-ink/60 hover:text-ink',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <p className="ml-auto text-[13px] text-ink/65" aria-live="polite">
            {total ? (
              <>
                <span className="num font-semibold text-ink">
                  {formatMiles(Math.round(total * 10) / 10)}
                </span>{' '}
                {mode === 'miles' && roundTrip ? 'there and back' : 'this trip'}
              </>
            ) : mode === 'odometer' && end && Number(end) <= Number(start) ? (
              'End is below the start'
            ) : (
              'No miles yet'
            )}
          </p>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[13px] text-muted">Same trip again? One tap fills it in.</p>
          <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
            {recent.map((trip) => {
              const on = from === trip.from && to === trip.to;
              return (
                <button
                  key={`${trip.from}-${trip.to}`}
                  type="button"
                  onClick={() => repeat(trip)}
                  aria-pressed={on}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-[14px] py-2 pr-3.5 pl-2.5 text-left transition-all active:scale-[.97]',
                    on
                      ? 'bg-ink text-white'
                      : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-7 shrink-0 place-items-center rounded-full',
                      on ? 'bg-white/15' : 'bg-tool-miles/45',
                    )}
                    aria-hidden="true"
                  >
                    <Icon name={on ? 'check' : 'route'} size={14} strokeWidth={2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block max-w-[220px] truncate text-[13.5px] font-medium">
                      {trip.from.split(',')[0]} → {trip.to.split(',')[0]}
                    </span>
                    <span className={cn('block text-[12px]', on ? 'text-white/65' : 'text-muted')}>
                      {formatMiles(trip.miles)}
                      {trip.roundTrip ? ' round trip' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Section title="Route">
        <Field label="From" htmlFor={`${id}-from`}>
          <Input
            id={`${id}-from`}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            list={`${id}-places`}
            required
          />
        </Field>
        <Field label="To" htmlFor={`${id}-to`}>
          <Input
            id={`${id}-to`}
            value={to}
            onChange={(event) => pickDestination(event.target.value)}
            list={`${id}-places`}
            required
            placeholder="Job site, supplier…"
          />
        </Field>
        <datalist id={`${id}-places`}>
          {places.map((place) => (
            <option key={place} value={place} />
          ))}
        </datalist>
        {places.length > 1 && (
          <div className="scrollbar-none -mx-5 -mt-1 flex gap-1.5 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
            {places.slice(1, 6).map((place) => (
              <button
                key={place}
                type="button"
                onClick={() => pickDestination(place)}
                aria-pressed={to === place}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors',
                  to === place ? 'bg-ink text-white' : 'bg-well text-ink-2 hover:bg-ink/10',
                )}
              >
                {place}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Details">
        <Field label="Date" htmlFor={`${id}-date`}>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </Field>
        {workspace.options.vehicles.length > 0 && (
          <Field label="Vehicle" htmlFor={`${id}-vehicle`}>
            <Select
              id={`${id}-vehicle`}
              value={vehicleId}
              onChange={(event) => {
                setVehicleId(event.target.value);
                const next = workspace.options.vehicles.find(
                  (item) => item.id === event.target.value,
                );
                if (next) setStart(String(next.odometer));
              }}
            >
              <option value="">My own car</option>
              {workspace.options.vehicles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
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
        <Field label="Purpose" htmlFor={`${id}-purpose`}>
          <Input
            id={`${id}-purpose`}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Material pickup, site visit…"
          />
        </Field>
      </Section>

      <FormFooter
        error={error}
        note={needsApproval ? 'Goes to your managers for approval' : undefined}
      >
        <SubmitButton pending={pending}>{needsApproval ? 'Submit trip' : 'Save trip'}</SubmitButton>
      </FormFooter>
    </form>
  );
}

/* ---------- Project ---------- */

export function ProjectForm({ onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const events = workspace.labels.project === 'Event';
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [client, setClient] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('planning');
  const [leadId, setLeadId] = useState(workspace.person.id);
  const [team, setTeam] = useState<string[]>([workspace.person.id]);
  const [dueDate, setDueDate] = useState('');
  const [budget, setBudget] = useState('');
  const [summary, setSummary] = useState('');
  const people = workspace.options.people.filter((person) => person.role !== 'guest');

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            createProject(workspace.space.slug, {
              name,
              location,
              client,
              status,
              leadId,
              teamIds: team,
              dueDate,
              budget,
              summary,
            }),
          { title: `${name} created`, href: workspace.href('/projects') },
        );
      }}
    >
      <Section>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            data-autofocus
            placeholder={events ? 'Harvest dinner' : '1845 Oak St'}
          />
        </Field>
        <Field label={events ? 'Room' : 'Address'} htmlFor={`${id}-location`} optional>
          <Input
            id={`${id}-location`}
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={events ? 'Private room' : 'Street, town'}
          />
        </Field>
        <Field label={events ? 'Host' : 'Client'} htmlFor={`${id}-client`} optional>
          <Input
            id={`${id}-client`}
            value={client}
            onChange={(event) => setClient(event.target.value)}
          />
        </Field>
        <Field label="Status">
          <Segmented
            name={`${id}-status`}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'planning', label: 'Planning' },
              { value: 'active', label: 'Active' },
            ]}
          />
        </Field>
      </Section>
      <Section title="Team">
        <Field label="Lead" htmlFor={`${id}-lead`}>
          <Select
            id={`${id}-lead`}
            value={leadId}
            onChange={(event) => setLeadId(event.target.value)}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-2">
          {people.map((person) => {
            const on = team.includes(person.id) || person.id === leadId;
            return (
              <button
                key={person.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTeam((current) =>
                    on ? current.filter((item) => item !== person.id) : [...current, person.id],
                  )
                }
                className={cn(
                  'flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13.5px] transition-all',
                  on
                    ? 'bg-ink text-white'
                    : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                )}
              >
                <Avatar person={person} size="sm" />
                {person.name.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Plan">
        <div className="grid grid-cols-2 gap-3">
          <Field label={events ? 'Date' : 'Due'} htmlFor={`${id}-due`} optional>
            <Input
              id={`${id}-due`}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          <Field
            label="Expense budget"
            htmlFor={`${id}-budget`}
            optional
            hint="What receipts on this can add up to."
          >
            <Input
              id={`${id}-budget`}
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              inputMode="numeric"
              placeholder="$"
              className="num"
            />
          </Field>
        </div>
        <Field label="Summary" htmlFor={`${id}-summary`} optional>
          <Textarea
            id={`${id}-summary`}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            placeholder="What's the job?"
          />
        </Field>
      </Section>
      <FormFooter error={error}>
        <SubmitButton pending={pending}>
          Create {workspace.labels.project.toLowerCase()}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}

/* ---------- Person ---------- */

export function PersonForm({ onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const allowed: Role[] =
    workspace.role === 'owner'
      ? ['admin', 'manager', 'member', 'guest']
      : ['manager', 'member', 'guest'];
  const [role, setRole] = useState<Role>('member');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [projects, setProjects] = useState<string[]>([]);

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit(
          () =>
            invitePerson(workspace.space.slug, { name, email, role, title, projectIds: projects }),
          {
            title: `${name.split(' ')[0] || 'They'} can join ${workspace.space.name}`,
            href: workspace.href('/people'),
          },
        );
      }}
    >
      <Section>
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            data-autofocus
            autoComplete="off"
          />
        </Field>
        <Field label="Email" htmlFor={`${id}-email`} hint="In the preview, no email is sent.">
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="off"
            placeholder="name@company.com"
          />
        </Field>
        <Field label="Job title" htmlFor={`${id}-title`} optional>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Field Employee, Server…"
          />
        </Field>
      </Section>
      <Section title="What can they see?">
        <div role="radiogroup" className="grid gap-2">
          {allowed.map((option) => {
            const info = roles[option];
            const selected = role === option;
            return (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer gap-3 rounded-[14px] px-3.5 py-3 transition-all',
                  selected
                    ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                    : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={option}
                  checked={selected}
                  onChange={() => setRole(option)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
                    selected ? 'border-signal bg-signal' : 'border-line-strong',
                  )}
                >
                  {selected && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-ink">{info.label}</span>
                  <span className="block text-[13px] text-muted">{info.summary}</span>
                  {selected && (
                    <span className="mt-2 grid gap-1 text-[12.5px] text-ink-2">
                      {info.can.map((line) => (
                        <span key={line} className="flex items-center gap-1.5">
                          <Icon name="check" size={13} className="text-positive" /> {line}
                        </span>
                      ))}
                      {info.cannot.map((line) => (
                        <span key={line} className="flex items-center gap-1.5 text-muted">
                          <Icon name="minus" size={13} /> {line}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {(role === 'guest' || role === 'member') && workspace.options.projects.length > 0 && (
          <Field
            label={
              role === 'guest'
                ? `${workspace.labels.projects} they can open`
                : `Add to ${workspace.labels.projects.toLowerCase()}`
            }
            optional={role !== 'guest'}
          >
            <div className="grid gap-1.5">
              {workspace.options.projects
                .filter((project) => project.status !== 'done')
                .map((project) => (
                  <label
                    key={project.id}
                    className="flex items-center gap-3 rounded-[10px] px-2 py-2 text-[14px] hover:bg-subtle"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-signal)]"
                      checked={projects.includes(project.id)}
                      onChange={(event) =>
                        setProjects((current) =>
                          event.target.checked
                            ? [...current, project.id]
                            : current.filter((item) => item !== project.id),
                        )
                      }
                    />
                    {project.name}
                  </label>
                ))}
            </div>
          </Field>
        )}
      </Section>
      <FormFooter error={error}>
        <SubmitButton pending={pending}>Add person</SubmitButton>
      </FormFooter>
    </form>
  );
}

/* ---------- Vehicle ---------- */

export function VehicleForm({ onDone, formId }: FormProps) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const [values, setValues] = useState({
    name: '',
    year: '2024',
    make: '',
    model: '',
    plate: '',
    odometer: '',
    assignedTo: '',
  });
  const [fuel, setFuel] = useState<'gas' | 'diesel' | 'electric'>('gas');
  const set =
    (key: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        submit(() => createVehicle(workspace.space.slug, { ...values, fuel }), {
          title: `${values.name} added`,
          href: workspace.href('/vehicles'),
        });
      }}
    >
      <Section>
        <Field label="Name" htmlFor={`${id}-name`} hint="What the crew calls it.">
          <Input
            id={`${id}-name`}
            value={values.name}
            onChange={set('name')}
            required
            data-autofocus
            placeholder="Truck 36"
          />
        </Field>
        <div className="grid grid-cols-[96px_1fr] gap-3">
          <Field label="Year" htmlFor={`${id}-year`}>
            <Input
              id={`${id}-year`}
              value={values.year}
              onChange={set('year')}
              inputMode="numeric"
              className="num"
            />
          </Field>
          <Field label="Make" htmlFor={`${id}-make`}>
            <Input
              id={`${id}-make`}
              value={values.make}
              onChange={set('make')}
              required
              placeholder="Ford"
            />
          </Field>
        </div>
        <Field label="Model" htmlFor={`${id}-model`}>
          <Input
            id={`${id}-model`}
            value={values.model}
            onChange={set('model')}
            required
            placeholder="F-150 XLT"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plate" htmlFor={`${id}-plate`} optional>
            <Input
              id={`${id}-plate`}
              value={values.plate}
              onChange={set('plate')}
              className="uppercase"
            />
          </Field>
          <Field label="Odometer" htmlFor={`${id}-odo`}>
            <Input
              id={`${id}-odo`}
              value={values.odometer}
              onChange={set('odometer')}
              inputMode="numeric"
              className="num"
            />
          </Field>
        </div>
        <Field label="Fuel">
          <Segmented
            name={`${id}-fuel`}
            value={fuel}
            onChange={setFuel}
            options={[
              { value: 'gas', label: 'Gas' },
              { value: 'diesel', label: 'Diesel' },
              { value: 'electric', label: 'Electric' },
            ]}
          />
        </Field>
        <Field label="Assigned to" htmlFor={`${id}-assigned`} optional>
          <Select id={`${id}-assigned`} value={values.assignedTo} onChange={set('assignedTo')}>
            <option value="">Nobody — shared</option>
            {workspace.options.people
              .filter((person) => person.role !== 'guest')
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </Select>
        </Field>
      </Section>
      <FormFooter error={error}>
        <SubmitButton pending={pending}>Add vehicle</SubmitButton>
      </FormFooter>
    </form>
  );
}
