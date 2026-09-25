/**
 * The Hyphy Tools domain model.
 *
 * One person has one identity (`Person`). What they can see and do depends on the Space they are
 * in: a `Membership` joins a person to a Space with a `Role`. Plans belong to Spaces, not people.
 * Modules (tools) are enabled per Space. Role, plan and modules are deliberately separate.
 *
 * Every saved record belongs to exactly one Space (`spaceId`) and records who made it
 * (`createdBy`). These shapes mirror the proposed database tables in
 * `supabase/migrations/` so a real repository can return them unchanged.
 */

import type { BusinessType } from './business-types';
import type { SpaceSettings } from './business-settings';

export type ISODate = string;

/* ---------- identity ---------- */

export type Person = {
  id: string;
  name: string;
  /** Used in greetings. */
  firstName: string;
  email: string;
  initials: string;
  /** Avatar background; people have no photos in the demo. */
  hue: string;
  /** Default professional headline shown outside any one Space. */
  headline?: string;
  phone?: string;
  timezone: string;
};

/* ---------- spaces ---------- */

export type SpaceKind = 'personal' | 'business';

export type PlanId = 'free' | 'personal-pro' | 'business' | 'business-pro';

export type ModuleId =
  | 'projects'
  | 'vehicles'
  | 'people'
  | 'files'
  | 'receipts'
  | 'mileage'
  | 'pdf'
  | 'qr'
  | 'images'
  | 'links';

/** What a Space calls a module, e.g. a restaurant's "Projects" are "Events". */
export type ModuleLabel = { singular: string; plural: string };

/**
 * The words a business chose for the few things Hyphy lets it rename, each from a short curated
 * list (`lib/platform/terms.ts`): its work (Jobs, Events, Properties), the people it works for
 * (Customer, Client) and its vehicles (Trucks, Units). Nothing else is renamed.
 */
export type SpaceLabels = {
  projects?: ModuleLabel;
  vehicles?: ModuleLabel;
  customer?: ModuleLabel;
};

/**
 * How a Space's work is shaped. One Projects module underneath; the words and what a project
 * page emphasises follow the business (see `lib/platform/work.ts`). A builder runs jobs with a
 * contract and costs, a restaurant runs events on a date, a studio runs engagements.
 */
export type WorkStyle = 'jobs' | 'events' | 'engagements';

export type Space = {
  id: string;
  /** URL segment. Personal Spaces all use `personal`; the viewer's own one is resolved. */
  slug: string;
  kind: SpaceKind;
  name: string;
  /** Short line under the name: industry, city. */
  descriptor: string;
  plan: PlanId;
  modules: ModuleId[];
  labels?: SpaceLabels;
  workStyle?: WorkStyle;
  /** Paid back per mile driven in someone's own car. Counts toward a project's tracked costs. */
  mileageRate?: number;
  brand: { color: string; ink: 'light' | 'dark'; monogram: string };
  /** A business's logo, one of its own files. Without one, the mark is its initials. */
  logo?: { fileId: string; storage: FileStorage };
  timezone: string;
  /** Owner of a personal Space. */
  ownerId?: string;
  /**
   * How this business runs its receipts, mileage and approvals (`lib/platform/business-settings.ts`).
   * Only what the business changed is stored; everything else is Hyphy's default. Guests never
   * receive it.
   */
  settings?: SpaceSettings;
  /** What kind of business it is (business Spaces); sets starting words and tools. */
  businessType?: BusinessType;
  /** When its owner finished (or skipped) setup after creating it. */
  setupDoneAt?: ISODate;
  createdAt: ISODate;
};

/* ---------- membership ---------- */

export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'guest';

export type Membership = {
  id: string;
  spaceId: string;
  personId: string;
  role: Role;
  /** Their job in this Space: "Field Employee", "Electrical subcontractor". */
  title: string;
  /** `invited`: Demo Mode's placeholder; `removed`: a former member (kept so names resolve). */
  status: 'active' | 'invited' | 'removed';
  joinedAt: ISODate;
  /** Guests (and members) can be limited to specific projects. */
  projectIds?: string[];
  department?: string;
  /** Space-defined fields about this person here, e.g. crew or certifications. */
  custom?: Record<string, FieldValue>;
};

/* ---------- custom fields (see custom-fields.ts) ---------- */

/** The records a business can add its own fields to. */
export type RecordType = 'projects' | 'vehicles' | 'receipts' | 'mileage' | 'people';

export type FieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  | 'boolean'
  | 'select'
  | 'person'
  | 'project'
  | 'vehicle'
  | 'file';

/**
 * Something a business asks for beyond what Hyphy already knows about a record: a Cost Code on
 * receipts, a Job Number on jobs. Hyphy owns the record (amount, date, who sent it, its status);
 * the business owns these.
 */
export type FieldDefinition = {
  /**
   * The field's key: unique per Space and record type, made from its first name and never changed,
   * so values saved under it stay readable whatever the label becomes.
   */
  id: string;
  spaceId: string;
  appliesTo: RecordType;
  label: string;
  type: FieldType;
  /** Dropdown choices. Once a record uses the field, choices can be added but not taken away. */
  options?: string[];
  help?: string;
  required?: boolean;
  /** Order on forms and pages, lowest first. */
  position: number;
  /** Shown on list rows too (a couple at most). */
  showInList?: boolean;
  /** Stopped using: gone from forms, kept (and shown) on the records that have a value. */
  archivedAt?: ISODate;
  createdBy?: string;
  createdAt?: ISODate;
};

export type FieldValue = string | number | boolean | null;

/* ---------- records ---------- */

type Owned = {
  id: string;
  spaceId: string;
  createdBy: string;
  createdAt: ISODate;
};

export type ProjectStatus = 'planning' | 'active' | 'on-hold' | 'done';

export type Project = Owned & {
  name: string;
  /** Street address for job sites, venue or client for others. */
  location?: string;
  client?: string;
  status: ProjectStatus;
  summary: string;
  leadId: string;
  teamIds: string[];
  startDate: ISODate;
  dueDate?: ISODate;
  /** 0–100, set by the team. Only where "how far along" means something (not events). */
  progress?: number;
  /** What the customer is paying: a signed contract, a booked event. Absent where it isn't known. */
  value?: number;
  /**
   * An internal target for the costs tracked in Hyphy (fuel, trips, purchases). Only set when
   * the business decided on one; it is never the project's value or its full cost.
   */
  costAllowance?: number;
  color: string;
  custom?: Record<string, FieldValue>;
};

export type VehicleStatus = 'active' | 'in-shop' | 'available';

export type Vehicle = Owned & {
  name: string;
  year: number;
  make: string;
  model: string;
  plate: string;
  vinLast6: string;
  odometer: number;
  fuel: 'gas' | 'diesel' | 'electric';
  status: VehicleStatus;
  assignedTo?: string;
  fuelCardLast4?: string;
  nextServiceMiles?: number;
  color: string;
  custom?: Record<string, FieldValue>;
};

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'returned';

/**
 * What every submission carries so it's reviewed the same way, whatever it is (see
 * `lib/platform/approvals.ts`). Receipts and trips today; form entries and expenses later.
 */
export type Review = {
  status: ApprovalStatus;
  /** Who approved or returned it last, and when. */
  reviewedBy?: string;
  reviewedAt?: ISODate;
  /** The reviewer's note when it went back. Kept after a resubmission, as its history. */
  returnReason?: string;
  /** When the submitter fixed a returned item and sent it again. */
  resubmittedAt?: ISODate;
  /** When the submitter read a return and chose to leave it (it stays returned). */
  returnSeenAt?: ISODate;
};

export type ReceiptCategory = 'fuel' | 'materials' | 'meals' | 'supplies' | 'equipment' | 'other';

export type Receipt = Owned &
  Review & {
    vendor: string;
    category: ReceiptCategory;
    total: number;
    date: ISODate;
    paymentMethod?: string;
    gallons?: number;
    odometer?: number;
    vehicleId?: string;
    projectId?: string;
    fileId?: string;
    notes?: string;
    custom?: Record<string, FieldValue>;
  };

export type MileageEntry = Owned &
  Review & {
    date: ISODate;
    from: string;
    to: string;
    miles: number;
    purpose: string;
    roundTrip?: boolean;
    /** Empty means the person's own vehicle, which the business pays back per mile. */
    vehicleId?: string;
    projectId?: string;
    /**
     * The business's per-mile rate when the trip was logged (0: it wasn't paying miles back then).
     * Set by the database, never by the person; a new rate never re-prices old trips.
     */
    rate?: number;
    custom?: Record<string, FieldValue>;
  };

export type FileKind = 'pdf' | 'image' | 'doc' | 'sheet' | 'archive';

export type AttachmentRef = { type: 'project' | 'vehicle' | 'person' | 'receipt'; id: string };

/**
 * Where a file's bytes are: Supabase Storage (`hyphy-files`, the private bucket), or — in Demo
 * Mode only — the browser that uploaded it (`device`). Records from before real storage have
 * neither: their details are kept, not the file.
 */
export type FileStorage = 'hyphy-files' | 'device';

/** Where a file came from: uploaded (none), made by a tool, a receipt's photo, a business logo. */
export type FileSource = ModuleId | 'brand';

export type FileRecord = Owned & {
  /** The name people see. Renaming changes only this. */
  name: string;
  kind: FileKind;
  size: number;
  folder: string;
  attachedTo: AttachmentRef[];
  /** Who can open it. `team` = everyone who can see what it's attached to. */
  access: 'team' | 'managers' | 'private' | 'shared';
  expiresAt?: ISODate;
  /** Sample records show a generated preview swatch in the demo. */
  preview?: string;
  pages?: number;
  /** Where it came from, if not simply uploaded. */
  source?: FileSource;
  /** Its name when it was uploaded or made. */
  originalName?: string;
  mimeType?: string;
  storage?: FileStorage;
  /** Hyphy's own path for the bytes (`spaces/<space>/files/<id>/<name>`). Server-side only. */
  storagePath?: string;
  /** `pending` while its bytes are uploading; only `ready` files are shown. Default ready. */
  status?: 'pending' | 'ready' | 'failed';
  /** SHA-256 of the bytes, as the uploading browser computed it. */
  sha256?: string;
  width?: number;
  height?: number;
  /** In Trash since. */
  deletedAt?: ISODate;
  deletedBy?: string;
};

export type QrCode = Owned & {
  label: string;
  content: string;
  fg: string;
  bg: string;
  placement?: string;
  /** The project or event it was made for (a job-site sign, an RSVP card). */
  projectId?: string;
  /** Set when the code opens one of this Space's link pages. */
  linkPageId?: string;
};

export type LinkItem = { id: string; label: string; url: string };

export type LinkPage = Owned & {
  title: string;
  handle: string;
  bio: string;
  theme: 'paper' | 'ink' | 'signal' | 'ember';
  links: LinkItem[];
  updatedAt: ISODate;
};

/* ---------- activity & inbox ---------- */

export type ObjectRef = {
  type:
    | 'project'
    | 'vehicle'
    | 'receipt'
    | 'mileage'
    | 'file'
    | 'person'
    | 'qr'
    | 'link'
    | 'space'
    /** The business's own setup: its fields, rules and words. `id` is the Space. */
    | 'setting';
  id: string;
  label: string;
};

export type ActivityVerb =
  | 'created'
  | 'updated'
  | 'uploaded'
  | 'submitted'
  | 'approved'
  | 'returned'
  | 'resubmitted'
  | 'logged'
  | 'assigned'
  | 'joined'
  | 'invited'
  | 'removed'
  | 'left'
  | 'commented'
  | 'completed'
  | 'merged'
  | 'generated'
  /** Setup: a field added, a rule changed, a field no longer used. */
  | 'added'
  | 'changed'
  | 'archived'
  /** Files: into Trash, back out, a new name, a photo on a receipt. */
  | 'deleted'
  | 'restored'
  | 'renamed'
  | 'attached';

export type ActivityEvent = {
  id: string;
  spaceId: string;
  actorId: string;
  verb: ActivityVerb;
  object: ObjectRef;
  /** Where it happened, e.g. the project a file was added to. */
  context?: ObjectRef;
  /** A short human detail: "37 mi", "$64.18". */
  detail?: string;
  at: ISODate;
};

/**
 * `approval`, `returned` and `incomplete` are never stored: the repository derives them from the
 * submissions themselves, so a decision can't leave a stale item behind. The rest are
 * notifications written when something happens.
 */
export type InboxKind =
  | 'approval'
  | 'returned'
  | 'incomplete'
  | 'document-uploaded'
  | 'access-request'
  | 'document-expiring'
  | 'mention';

export type InboxItem = {
  id: string;
  spaceId: string;
  kind: InboxKind;
  title: string;
  detail: string;
  at: ISODate;
  subject: ObjectRef;
  /** Everyone with this permission sees it… */
  audience?: import('./roles').Permission;
  /** …or exactly this person. */
  recipientId?: string;
  fromId?: string;
  priority: 'normal' | 'high';
  status: 'open' | 'done';
  /** For approvals and returns: the submission itself, so the item can show and act on it. */
  submission?: import('./approvals').Submission;
};

/**
 * One step in a submission's history. Kept as its own record, never rebuilt from the current
 * status, so the story (sent, returned with a reason, fixed, approved) survives every change.
 */
export type ApprovalEvent = {
  id: string;
  spaceId: string;
  submissionType: 'receipt' | 'mileage';
  submissionId: string;
  action: 'submitted' | 'returned' | 'resubmitted' | 'approved';
  actorId: string;
  reason?: string;
  at: ISODate;
};

/* ---------- personal preferences ---------- */

/** Something a person keeps within reach in one Space. Theirs alone; nobody else sees it. */
export type PinTarget = { type: 'tool' | 'project'; id: string };

export type Pin = PinTarget & { spaceId: string; personId: string };
