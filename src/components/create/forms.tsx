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
import { FormFooter, Section, SubmitButton, Toggle, todayInput } from './parts';

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
    request.attachTo?.type === 'project' ? request.attachTo.id : '',
  );
  const [purpose, setPurpose] = useState('');

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
      <div className="mt-1 flex items-end justify-between rounded-[16px] bg-tool-miles/35 px-4 py-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/.05)]">
        <div>
          <p className="label !text-ink/60">Trip</p>
          <p className="display mt-1 text-[40px] leading-none text-ink">
            <span className="num">
              {total ? (Math.round(total * 10) / 10).toLocaleString('en-US') : '0'}
            </span>
            <span className="ml-1 text-[18px] text-ink/50">mi</span>
          </p>
        </div>
        <Icon name="route" size={28} className="mb-1 text-ink/40" />
      </div>

      <Section>
        <Segmented
          name={`${id}-mode`}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'miles', label: 'Enter miles' },
            { value: 'odometer', label: 'Odometer' },
          ]}
        />
        {mode === 'miles' ? (
          <>
            <Field label="Miles one way" htmlFor={`${id}-miles`}>
              <Input
                id={`${id}-miles`}
                value={miles}
                onChange={(event) => setMiles(event.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="num"
                autoFocus
              />
            </Field>
            <Toggle
              checked={roundTrip}
              onChange={setRoundTrip}
              label="Round trip"
              description="Counts the miles twice"
            />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" htmlFor={`${id}-start`}>
              <Input
                id={`${id}-start`}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                inputMode="numeric"
                className="num"
              />
            </Field>
            <Field label="End" htmlFor={`${id}-end`}>
              <Input
                id={`${id}-end`}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                inputMode="numeric"
                className="num"
                placeholder={start}
              />
            </Field>
          </div>
        )}
      </Section>

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
            onChange={(event) => setTo(event.target.value)}
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
          <div className="scrollbar-none -mt-1 flex gap-1.5 overflow-x-auto">
            {places.slice(1, 6).map((place) => (
              <button
                key={place}
                type="button"
                onClick={() => setTo(place)}
                className="shrink-0 rounded-full bg-well px-3 py-1.5 text-[13px] text-ink-2 hover:bg-ink/10"
              >
                {place}
              </button>
            ))}
          </div>
        )}
        <Field label="Date" htmlFor={`${id}-date`}>
          <Input
            id={`${id}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </Field>
      </Section>

      <Section title="Details">
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
            autoFocus
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
          <Field label="Budget" htmlFor={`${id}-budget`} optional>
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
            autoFocus
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
            autoFocus
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
