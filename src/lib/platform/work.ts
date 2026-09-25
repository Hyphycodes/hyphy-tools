import type { Space, WorkStyle } from './types';

/**
 * The terminology and emphasis layer for projects. Every Space uses the same Projects module and
 * the same records; the profile decides what it's called and what a project page leads with.
 * A builder's job has a contract value, costs, trips and trucks; a restaurant's event has a date,
 * a team, files and QR codes, and no "percent complete".
 *
 * Words come from `space.labels` when a Space names things itself, else from the style.
 */
export type WorkProfile = {
  style: WorkStyle;
  singular: string;
  plural: string;
  /** Field names on a record. */
  location: string;
  client: string;
  /** Jobs run to a due date; events happen on a day. */
  schedule: 'due' | 'on';
  /** Whether "how far along" means anything for this kind of work. */
  progress: boolean;
  /** What the customer's money is called here, or null where it isn't part of the picture. */
  value: string | null;
  /** Whether vehicles and trips belong on a project page. */
  field: boolean;
  /** What an empty summary invites. */
  placeholder: { name: string; location: string };
};

const profiles: Record<WorkStyle, Omit<WorkProfile, 'style'>> = {
  jobs: {
    singular: 'Project',
    plural: 'Projects',
    location: 'Job site',
    client: 'Client',
    schedule: 'due',
    progress: true,
    value: 'Contract value',
    field: true,
    placeholder: { name: '1845 Oak St', location: 'Street, town' },
  },
  events: {
    singular: 'Event',
    plural: 'Events',
    location: 'Room',
    client: 'Host',
    schedule: 'on',
    progress: false,
    value: 'Booking',
    field: false,
    placeholder: { name: 'Harvest dinner', location: 'Private room' },
  },
  engagements: {
    singular: 'Project',
    plural: 'Projects',
    location: 'Where',
    client: 'Client',
    schedule: 'due',
    progress: true,
    value: 'Project value',
    field: false,
    placeholder: { name: 'Menu redesign', location: 'Client or place' },
  },
};

export function workProfile(space: Pick<Space, 'workStyle' | 'labels'>): WorkProfile {
  const style = space.workStyle ?? 'engagements';
  const base = profiles[style];
  const labels = space.labels?.projects;
  return {
    style,
    ...base,
    singular: labels?.singular ?? base.singular,
    plural: labels?.plural ?? base.plural,
  };
}

/** The day that matters for a project: its due date, or the day an event happens. */
export function keyDate(
  project: { dueDate?: string; startDate: string },
  profile: Pick<WorkProfile, 'schedule'>,
) {
  return profile.schedule === 'on' ? project.startDate : project.dueDate;
}
