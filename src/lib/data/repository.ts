import type { Submission, SubmissionKind, SubmissionRef } from '@/lib/platform/approvals';
import type { SpaceSettings } from '@/lib/platform/business-settings';
import type {
  ActivityEvent,
  ApprovalEvent,
  ApprovalStatus,
  AttachmentRef,
  FieldDefinition,
  FieldValue,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  ModuleId,
  ObjectRef,
  Person,
  Pin,
  PinTarget,
  Project,
  QrCode,
  Receipt,
  RecordType,
  Space,
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

/** A change the rules refuse ("that one was already decided"), in words the person can act on. */
export class RuleError extends Error {}

/** The data couldn't be reached. Nothing was changed; trying again is safe. */
export class DataUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('We couldn’t reach Hyphy’s data. Nothing was saved — try again in a moment.', { cause });
  }
}

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
  | 'custom'
  | 'fileId'
> & { draft?: boolean };

export type MileageInput = Pick<
  MileageEntry,
  'date' | 'from' | 'to' | 'miles' | 'roundTrip' | 'purpose' | 'vehicleId' | 'projectId' | 'custom'
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
  | 'value'
  | 'costAllowance'
  | 'status'
  | 'custom'
> & {
  /** An event's day; jobs start the day they're created. */
  startDate?: string;
};

export type InviteInput = {
  name: string;
  email: string;
  role: Membership['role'];
  title: string;
  projectIds?: string[];
};

export type VehicleInput = Pick<
  Vehicle,
  'name' | 'year' | 'make' | 'model' | 'plate' | 'fuel' | 'assignedTo' | 'odometer' | 'custom'
>;

/** A file whose bytes are about to be uploaded. Its id is chosen first: the path is built on it. */
export type FileStart = Pick<
  FileRecord,
  | 'id'
  | 'name'
  | 'originalName'
  | 'kind'
  | 'size'
  | 'mimeType'
  | 'folder'
  | 'attachedTo'
  | 'access'
  | 'source'
  | 'pages'
  | 'sha256'
  | 'width'
  | 'height'
  | 'storage'
  | 'storagePath'
>;

/** What finishing an upload found: done, bytes not there (yet), or not what was promised. */
export type UploadOutcome = 'ready' | 'missing' | 'mismatch';

export type QrInput = Pick<
  QrCode,
  'label' | 'content' | 'fg' | 'bg' | 'placement' | 'projectId' | 'linkPageId'
>;

export type LinkPageInput = Pick<LinkPage, 'title' | 'handle' | 'bio' | 'theme' | 'links'> & {
  id?: string;
};

export type SpacePatch = Partial<
  Pick<
    Space,
    | 'name'
    | 'descriptor'
    | 'businessType'
    | 'workStyle'
    | 'labels'
    | 'setupDoneAt'
    | 'brand'
    | 'mileageRate'
    | 'modules'
  >
>;

/** A new field: the key is made from its name by the repository. */
export type FieldInput = Pick<
  FieldDefinition,
  'appliesTo' | 'label' | 'type' | 'options' | 'required' | 'help' | 'showInList'
> & { id?: string };

export type FieldPatch = Partial<
  Pick<FieldDefinition, 'label' | 'type' | 'options' | 'required' | 'help' | 'showInList'>
>;

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

  /** Finished files, newest first; `trash` lists what's in Trash instead. */
  files(filter?: { attachedTo?: AttachmentRef; trash?: boolean }): Promise<FileRecord[]>;
  /** One file this person may see, in any state (uploading, in Trash), or null. */
  file(id: string): Promise<FileRecord | null>;
  qrCodes(): Promise<QrCode[]>;
  linkPages(): Promise<LinkPage[]>;

  /** Receipts and trips as one list, in the shared approval shape. Same visibility as each. */
  submissions(filter?: RecordFilter): Promise<Submission[]>;
  /** A submission's history, oldest first: sent, returned with a reason, fixed, approved. */
  approvalHistory(submissionId: string): Promise<ApprovalEvent[]>;

  activity(filter?: ActivityFilter): Promise<ActivityEvent[]>;
  /**
   * What needs this person: stored notifications, plus items derived from the records themselves
   * (submissions waiting on them, their own returned or unfinished ones). Derived items can't go
   * stale — they disappear when the record changes.
   */
  inbox(options?: { includeDone?: boolean }): Promise<InboxItem[]>;
  /** This person's pins in this Space. */
  pins(): Promise<Pin[]>;

  createReceipt(input: ReceiptInput): Promise<Receipt>;
  createMileage(input: MileageInput): Promise<MileageEntry>;
  createProject(input: ProjectInput): Promise<Project>;
  invite(input: InviteInput): Promise<Member>;
  createVehicle(input: VehicleInput): Promise<Vehicle>;
  /** A new id for a file, in this backend's format. */
  newFileId(): string;
  /** The record for an upload about to start, with its attachments. Not shown until finished. */
  startUpload(input: FileStart): Promise<FileRecord>;
  /** This person's uploads here that haven't finished (nobody else can see them). */
  myUnfinishedUploads(): Promise<FileRecord[]>;
  /** Marks an upload finished once its bytes are stored (the database checks they are). */
  finishUpload(id: string): Promise<UploadOutcome>;
  /** Forgets an upload that didn't finish. Its bytes must already be gone. */
  discardUpload(id: string): Promise<void>;
  renameFile(id: string, name: string): Promise<void>;
  /** To Trash (`true`) or back. A receipt's photo and the logo can't go. */
  trashFile(id: string, trashed: boolean): Promise<void>;
  /** Deletes a file in Trash for good. Its bytes must already be gone. */
  deleteFile(id: string): Promise<void>;
  /** The same file on one more record — never a second copy. */
  attachFile(id: string, ref: AttachmentRef): Promise<void>;
  /** The business's logo (a finished file of the caller's), or none. Returns the previous one. */
  setLogo(fileId: string | null): Promise<string | null>;
  /** Bytes this Space keeps in Storage, for the people who run it; null for everyone else. */
  storageBytes(): Promise<number | null>;
  saveQrCode(input: QrInput): Promise<QrCode>;
  saveLinkPage(input: LinkPageInput): Promise<LinkPage>;
  /** Approve or return one submission. A return can carry a short reason for the submitter. */
  review(
    kind: SubmissionKind,
    id: string,
    decision: 'approved' | 'returned',
    reason?: string,
  ): Promise<void>;
  /** Approves several at once; returns how many were still waiting. Never returns in bulk. */
  approveMany(refs: SubmissionRef[]): Promise<number>;
  /** The submitter's fix for a returned item (or a finished draft), sent again. */
  resubmitReceipt(id: string, input: ReceiptInput): Promise<Receipt>;
  resubmitMileage(id: string, input: MileageInput): Promise<MileageEntry>;
  resolveInbox(id: string): Promise<void>;
  setPinned(target: PinTarget, pinned: boolean): Promise<void>;
  setModules(modules: ModuleId[]): Promise<void>;
  /** The Space's own details: name, type, words, setup. Its address never changes. */
  updateSpace(patch: SpacePatch): Promise<void>;

  /* ---------- the business's own setup (Phase 2C) ---------- */

  /** The business's fields, archived ones too, in order. Only what this person may know about. */
  fields(appliesTo?: RecordType): Promise<FieldDefinition[]>;
  /** Keys of this record type's fields that some record already has an answer for. */
  fieldsInUse(appliesTo: RecordType): Promise<Set<string>>;
  addField(input: FieldInput): Promise<FieldDefinition>;
  /** Changes a field. Its type is fixed once used; a used dropdown only gains choices. */
  updateField(appliesTo: RecordType, id: string, patch: FieldPatch): Promise<FieldDefinition>;
  /** Stops asking for it (`archived`) or asks again. Saved values stay either way. */
  setFieldArchived(appliesTo: RecordType, id: string, archived: boolean): Promise<void>;
  /** Removes a field nothing has used. A used field can only be archived. */
  removeField(appliesTo: RecordType, id: string): Promise<void>;
  /** One step up or down among the fields in use. */
  moveField(appliesTo: RecordType, id: string, direction: -1 | 1): Promise<void>;
  /** Changes some of the business's rules; the rest keep their current answers. */
  updateSettings(patch: SpaceSettings): Promise<SpaceSettings>;
  /** The business's field answers on a project or vehicle. */
  setRecordFields(
    type: 'projects' | 'vehicles',
    id: string,
    custom: Record<string, FieldValue>,
  ): Promise<void>;
  /** The business's field answers about a person here. */
  setMemberFields(personId: string, custom: Record<string, FieldValue>): Promise<void>;
}
