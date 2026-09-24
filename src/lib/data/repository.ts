import type {
  ActivityEvent,
  ApprovalStatus,
  AttachmentRef,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  ModuleId,
  ObjectRef,
  Person,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';

/**
 * Everything the product reads and writes, scoped to one Workspace (a person in a Space).
 *
 * The contract every implementation keeps: results only ever contain records from the
 * Workspace's Space, and only the records this person may see (their own submissions, their
 * projects, their vehicle — or everything, for roles that see everything). In the demo the
 * repository applies those rules itself; with Supabase, Row Level Security applies them in the
 * database and the queries stay simple.
 */

export type Member = Membership & { person: Person };

export type RecordFilter = {
  projectId?: string;
  vehicleId?: string;
  createdBy?: string;
  status?: ApprovalStatus;
};

export type ReceiptInput = Pick<
  Receipt,
  | 'vendor'
  | 'category'
  | 'total'
  | 'date'
  | 'gallons'
  | 'odometer'
  | 'vehicleId'
  | 'projectId'
  | 'paymentMethod'
  | 'notes'
> & { draft?: boolean };

export type MileageInput = Pick<
  MileageEntry,
  'date' | 'from' | 'to' | 'miles' | 'roundTrip' | 'purpose' | 'vehicleId' | 'projectId'
>;

export type ProjectInput = Pick<
  Project,
  | 'name'
  | 'location'
  | 'client'
  | 'summary'
  | 'dueDate'
  | 'leadId'
  | 'teamIds'
  | 'budget'
  | 'status'
>;

export type InviteInput = {
  name: string;
  email: string;
  role: Membership['role'];
  title: string;
  projectIds?: string[];
};

export type VehicleInput = Pick<
  Vehicle,
  'name' | 'year' | 'make' | 'model' | 'plate' | 'fuel' | 'assignedTo' | 'odometer'
>;

export type FileInput = Pick<
  FileRecord,
  'name' | 'kind' | 'size' | 'folder' | 'attachedTo' | 'access' | 'source' | 'pages' | 'preview'
>;

export type QrInput = Pick<QrCode, 'label' | 'content' | 'fg' | 'bg' | 'placement'>;

export type LinkPageInput = Pick<LinkPage, 'title' | 'handle' | 'bio' | 'theme' | 'links'> & {
  id?: string;
};

export type ActivityFilter = {
  limit?: number;
  /** Events whose object or context is this record. */
  about?: Pick<ObjectRef, 'type' | 'id'>;
  actorId?: string;
};

export interface Repository {
  members(): Promise<Member[]>;
  member(personId: string): Promise<Member | null>;
  /** Everyone mentioned anywhere in this Space, for names in activity and files. */
  directory(): Promise<Person[]>;

  projects(): Promise<Project[]>;
  project(id: string): Promise<Project | null>;
  vehicles(): Promise<Vehicle[]>;
  vehicle(id: string): Promise<Vehicle | null>;

  receipts(filter?: RecordFilter): Promise<Receipt[]>;
  receipt(id: string): Promise<Receipt | null>;
  mileage(filter?: RecordFilter): Promise<MileageEntry[]>;

  files(filter?: { attachedTo?: AttachmentRef }): Promise<FileRecord[]>;
  qrCodes(): Promise<QrCode[]>;
  linkPages(): Promise<LinkPage[]>;

  activity(filter?: ActivityFilter): Promise<ActivityEvent[]>;
  inbox(options?: { includeDone?: boolean }): Promise<InboxItem[]>;

  createReceipt(input: ReceiptInput): Promise<Receipt>;
  createMileage(input: MileageInput): Promise<MileageEntry>;
  createProject(input: ProjectInput): Promise<Project>;
  invite(input: InviteInput): Promise<Member>;
  createVehicle(input: VehicleInput): Promise<Vehicle>;
  addFiles(inputs: FileInput[]): Promise<FileRecord[]>;
  saveQrCode(input: QrInput): Promise<QrCode>;
  saveLinkPage(input: LinkPageInput): Promise<LinkPage>;
  review(
    table: 'receipts' | 'mileage',
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<void>;
  resolveInbox(id: string): Promise<void>;
  setModules(modules: ModuleId[]): Promise<void>;
}
