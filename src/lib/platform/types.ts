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
  labels?: Partial<Record<ModuleId, ModuleLabel>>;
  brand: { color: string; ink: 'light' | 'dark'; monogram: string };
  timezone: string;
  /** Owner of a personal Space. */
  ownerId?: string;
  customFields?: Partial<Record<'projects' | 'vehicles' | 'people', FieldDefinition[]>>;
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
  status: 'active' | 'invited';
  joinedAt: ISODate;
  /** Guests (and members) can be limited to specific projects. */
  projectIds?: string[];
  department?: string;
  /** Space-defined fields about this person here, e.g. crew or certifications. */
  custom?: Record<string, FieldValue>;
};

/* ---------- custom fields (architecture only; see custom-fields.ts) ---------- */

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

export type FieldDefinition = {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  help?: string;
  required?: boolean;
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
  /** 0–100, set by the team. */
  progress: number;
  budget?: number;
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

export type ApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export type ReceiptCategory = 'fuel' | 'materials' | 'meals' | 'supplies' | 'equipment' | 'other';

export type Receipt = Owned & {
  vendor: string;
  category: ReceiptCategory;
  total: number;
  date: ISODate;
  status: ApprovalStatus;
  paymentMethod?: string;
  gallons?: number;
  odometer?: number;
  vehicleId?: string;
  projectId?: string;
  fileId?: string;
  notes?: string;
  reviewedBy?: string;
};

export type MileageEntry = Owned & {
  date: ISODate;
  from: string;
  to: string;
  miles: number;
  purpose: string;
  roundTrip?: boolean;
  vehicleId?: string;
  projectId?: string;
  status: ApprovalStatus;
};

export type FileKind = 'pdf' | 'image' | 'doc' | 'sheet' | 'archive';

export type AttachmentRef = { type: 'project' | 'vehicle' | 'person' | 'receipt'; id: string };

export type FileRecord = Owned & {
  name: string;
  kind: FileKind;
  size: number;
  folder: string;
  attachedTo: AttachmentRef[];
  /** Who can open it. `team` = everyone who can see what it's attached to. */
  access: 'team' | 'managers' | 'private' | 'shared';
  expiresAt?: ISODate;
  /** Photo files show a generated preview swatch in the demo. */
  preview?: string;
  pages?: number;
  /** Which tool produced it, if any. */
  source?: ModuleId;
};

export type QrCode = Owned & {
  label: string;
  content: string;
  fg: string;
  bg: string;
  placement?: string;
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
  type: 'project' | 'vehicle' | 'receipt' | 'mileage' | 'file' | 'person' | 'qr' | 'link' | 'space';
  id: string;
  label: string;
};

export type ActivityVerb =
  | 'created'
  | 'updated'
  | 'uploaded'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'logged'
  | 'assigned'
  | 'joined'
  | 'invited'
  | 'commented'
  | 'completed'
  | 'merged'
  | 'generated';

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

export type InboxKind =
  | 'receipt-approval'
  | 'mileage-review'
  | 'document-uploaded'
  | 'access-request'
  | 'document-expiring'
  | 'unassigned-receipt'
  | 'receipt-returned'
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
};
