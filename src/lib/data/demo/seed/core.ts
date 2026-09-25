import type { Membership, Person, Space } from '@/lib/platform/types';
import type { Clock } from '../clock';
import { DEMO_TZ } from '../clock';

/*
 * Everyone and every business here is fictional. Emails use the reserved `.example` domain.
 * Hyphy LLC is Hyphy's own Space; its projects are internal or for the fictional businesses below.
 */

const person = (
  id: string,
  name: string,
  hue: string,
  headline: string,
  email: string,
  extra: Partial<Person> = {},
): Person => {
  const parts = name.split(' ');
  return {
    id,
    name,
    firstName: parts[0],
    initials: (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase(),
    hue,
    headline,
    email,
    timezone: DEMO_TZ,
    ...extra,
  };
};

export const people: Person[] = [
  person('jerry', 'Jerry', '#3240FF', 'Founder, Hyphy LLC', 'jerry@hyphy.example'),
  person('sarah', 'Sarah Chen', '#0F8B6C', 'Operations Manager', 'sarah@hyphy.example'),
  person('ava', 'Ava Patel', '#D2489A', 'Designer', 'ava@hyphy.example'),
  person('theo', 'Theo Nguyen', '#5B6CFF', 'Developer', 'theo@hyphy.example'),
  person(
    'dana',
    'Dana Whitfield',
    '#B45309',
    'Owner, ABC Construction',
    'dana@abcconstruction.example',
    {
      phone: '(630) 555-0142',
    },
  ),
  person('luis', 'Luis Ortega', '#7C3AED', 'Office Manager', 'luis@abcconstruction.example', {
    phone: '(630) 555-0178',
  }),
  person('ray', 'Ray Kowalski', '#0E7490', 'Site Superintendent', 'ray@abcconstruction.example', {
    phone: '(630) 555-0123',
  }),
  person('mike', 'Mike Rodriguez', '#DC5B2A', 'Field Employee', 'mike@abcconstruction.example', {
    phone: '(630) 555-0199',
  }),
  person('tasha', 'Tasha Greene', '#15803D', 'Lead Carpenter', 'tasha@abcconstruction.example'),
  person('andre', 'Andre Wallace', '#475569', 'Laborer', 'andre@abcconstruction.example'),
  person('jordan', 'Jordan Pike', '#A16207', 'Apprentice', 'jordan.pike@mail.example'),
  person('chris', 'Chris Okafor', '#1D4ED8', 'Okafor Electric', 'chris@okaforelectric.example', {
    phone: '(708) 555-0164',
  }),
  person(
    'rosa',
    'Rosa Delgado',
    '#BE123C',
    'Owner & Chef, Salt & Ember',
    'rosa@saltandember.example',
  ),
  person('marcus', 'Marcus Bell', '#0369A1', 'General Manager', 'marcus@saltandember.example'),
  person('nia', 'Nia Brooks', '#9333EA', 'Server', 'nia@saltandember.example'),
  person('omar', 'Omar Haddad', '#CA8A04', 'Sous Chef', 'omar@saltandember.example'),
];

/** People who can be previewed get their own personal Space, like every real account would. */
export const personalOwners = ['jerry', 'sarah', 'dana', 'luis', 'mike', 'chris', 'rosa'];

export const personalSpaceId = (personId: string) => `sp_personal_${personId}`;

export function spaces(t: Clock): Space[] {
  const personal: Space[] = personalOwners.map((ownerId) => {
    const owner = people.find((item) => item.id === ownerId)!;
    return {
      id: personalSpaceId(ownerId),
      slug: 'personal',
      kind: 'personal',
      name: 'Personal',
      descriptor: ownerId === 'jerry' ? 'Your own tools and history' : 'Just for you',
      plan: ownerId === 'jerry' ? 'personal-pro' : 'free',
      modules: ['receipts', 'mileage', 'pdf', 'qr', 'links', 'images', 'files'],
      brand: { color: owner.hue, ink: 'light', monogram: owner.initials },
      timezone: DEMO_TZ,
      ownerId,
      createdAt: t.ago(ownerId === 'jerry' ? 210 : 60),
    };
  });

  return [
    ...personal,
    {
      id: 'sp_hyphy',
      slug: 'hyphy',
      kind: 'business',
      name: 'Hyphy LLC',
      descriptor: 'Design & software studio · Chicago',
      plan: 'business',
      modules: [
        'projects',
        'people',
        'files',
        'receipts',
        'mileage',
        'pdf',
        'qr',
        'links',
        'images',
      ],
      brand: { color: '#3240FF', ink: 'light', monogram: 'H' },
      timezone: DEMO_TZ,
      createdAt: t.ago(200),
      customFields: {
        projects: [
          {
            id: 'engagement',
            label: 'Engagement',
            type: 'select',
            options: ['Internal', 'Website', 'System'],
          },
          { id: 'kickoff_doc', label: 'Brief', type: 'file' },
        ],
      },
    },
    {
      id: 'sp_abc',
      slug: 'abc-construction',
      kind: 'business',
      name: 'ABC Construction',
      descriptor: 'Remodeling & additions · Oak Brook, IL',
      plan: 'business-pro',
      modules: [
        'projects',
        'vehicles',
        'people',
        'files',
        'receipts',
        'mileage',
        'pdf',
        'qr',
        'images',
      ],
      brand: { color: '#F2A516', ink: 'dark', monogram: 'AB' },
      timezone: DEMO_TZ,
      createdAt: t.ago(160),
      customFields: {
        projects: [
          { id: 'permit', label: 'Permit #', type: 'text' },
          { id: 'next_inspection', label: 'Next inspection', type: 'date' },
          { id: 'contract', label: 'Contract value', type: 'currency' },
          {
            id: 'job_type',
            label: 'Job type',
            type: 'select',
            options: ['Residential', 'Commercial'],
          },
        ],
        vehicles: [
          { id: 'registration', label: 'Registration renews', type: 'date' },
          { id: 'hitch', label: 'Trailer hitch', type: 'boolean' },
          { id: 'home_site', label: 'Usual job site', type: 'project' },
        ],
        people: [
          { id: 'crew', label: 'Crew', type: 'select', options: ['Framing', 'Finish', 'Office'] },
          { id: 'osha10', label: 'OSHA 10', type: 'boolean' },
        ],
      },
    },
    {
      id: 'sp_se',
      slug: 'salt-and-ember',
      kind: 'business',
      name: 'Salt & Ember',
      descriptor: 'Restaurant & bar · West Loop, Chicago',
      plan: 'business',
      modules: ['projects', 'people', 'files', 'receipts', 'pdf', 'qr', 'links', 'images'],
      labels: { projects: { singular: 'Event', plural: 'Events' } },
      brand: { color: '#E0492F', ink: 'light', monogram: 'SE' },
      timezone: DEMO_TZ,
      createdAt: t.ago(140),
      customFields: {
        projects: [
          { id: 'guests', label: 'Guests', type: 'number' },
          { id: 'deposit', label: 'Deposit', type: 'currency' },
          {
            id: 'room',
            label: 'Room',
            type: 'select',
            options: ['Dining room', 'Private room', 'Bar & patio'],
          },
        ],
      },
    },
  ];
}

const member = (
  spaceId: string,
  personId: string,
  role: Membership['role'],
  title: string,
  joinedDaysAgo: number,
  t: Clock,
  extra: Partial<Membership> = {},
): Membership => ({
  id: `mem_${spaceId}_${personId}`,
  spaceId,
  personId,
  role,
  title,
  status: 'active',
  joinedAt: t.ago(joinedDaysAgo),
  ...extra,
});

export function memberships(t: Clock): Membership[] {
  return [
    ...personalOwners.map((id) => member(personalSpaceId(id), id, 'owner', 'Owner', 60, t)),

    member('sp_hyphy', 'jerry', 'owner', 'Founder', 200, t),
    member('sp_hyphy', 'sarah', 'manager', 'Operations Manager', 120, t),
    member('sp_hyphy', 'ava', 'member', 'Designer', 96, t),
    member('sp_hyphy', 'theo', 'member', 'Developer', 41, t),

    member('sp_abc', 'dana', 'owner', 'Owner', 160, t),
    member('sp_abc', 'luis', 'admin', 'Office Manager', 150, t, {
      department: 'Office',
      custom: { crew: 'Office', osha10: false },
    }),
    member('sp_abc', 'ray', 'manager', 'Site Superintendent', 148, t, {
      department: 'Field',
      custom: { crew: 'Framing', osha10: true },
    }),
    member('sp_abc', 'tasha', 'member', 'Lead Carpenter', 131, t, {
      department: 'Field',
      custom: { crew: 'Finish', osha10: true },
    }),
    member('sp_abc', 'mike', 'member', 'Field Employee', 88, t, {
      department: 'Field',
      custom: { crew: 'Finish', osha10: true },
    }),
    member('sp_abc', 'andre', 'member', 'Laborer', 34, t, {
      department: 'Field',
      custom: { crew: 'Framing', osha10: false },
    }),
    member('sp_abc', 'jordan', 'member', 'Apprentice', 1, t, {
      status: 'invited',
      department: 'Field',
    }),
    member('sp_abc', 'chris', 'guest', 'Electrical subcontractor', 30, t, {
      projectIds: ['prj_oakbrook', 'prj_oak1845'],
    }),
    member('sp_abc', 'jerry', 'guest', 'Website partner · Hyphy', 22, t, {
      projectIds: ['prj_abcweb'],
    }),

    member('sp_se', 'rosa', 'owner', 'Owner & Chef', 140, t),
    member('sp_se', 'marcus', 'manager', 'General Manager', 138, t),
    member('sp_se', 'jerry', 'manager', 'Marketing & digital', 64, t),
    member('sp_se', 'omar', 'member', 'Sous Chef', 120, t),
    member('sp_se', 'nia', 'member', 'Server', 52, t),
  ];
}

/**
 * Hand-picked (person, Space) pairs for Preview As. Changing perspective sets the person; the
 * Space comes from the URL, exactly like it will with real sign-in.
 */
export type Perspective = { id: string; personId: string; spaceSlug: string; note: string };

export const perspectives: Perspective[] = [
  {
    id: 'jerry-personal',
    personId: 'jerry',
    spaceSlug: 'personal',
    note: 'An individual, on their own',
  },
  { id: 'jerry-hyphy', personId: 'jerry', spaceSlug: 'hyphy', note: 'Owner of a small studio' },
  {
    id: 'jerry-se',
    personId: 'jerry',
    spaceSlug: 'salt-and-ember',
    note: 'Helps run a friend’s restaurant',
  },
  {
    id: 'jerry-abc',
    personId: 'jerry',
    spaceSlug: 'abc-construction',
    note: 'Guest on the website project',
  },
  { id: 'sarah-hyphy', personId: 'sarah', spaceSlug: 'hyphy', note: 'Runs operations, no billing' },
  {
    id: 'dana-abc',
    personId: 'dana',
    spaceSlug: 'abc-construction',
    note: 'Owns a construction company',
  },
  {
    id: 'luis-abc',
    personId: 'luis',
    spaceSlug: 'abc-construction',
    note: 'Office admin: people and settings',
  },
  {
    id: 'mike-abc',
    personId: 'mike',
    spaceSlug: 'abc-construction',
    note: 'Field employee, mostly on a phone',
  },
  {
    id: 'chris-abc',
    personId: 'chris',
    spaceSlug: 'abc-construction',
    note: 'Outside contractor, two projects',
  },
  { id: 'rosa-se', personId: 'rosa', spaceSlug: 'salt-and-ember', note: 'Restaurant owner' },
];
