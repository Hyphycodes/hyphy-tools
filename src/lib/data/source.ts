import type {
  ActivityEvent,
  ApprovalEvent,
  FieldDefinition,
  FieldValue,
  FileRecord,
  InboxItem,
  LinkPage,
  MileageEntry,
  Person,
  PinTarget,
  Project,
  RecordType,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';
import type { InviteInput, Member, UploadOutcome } from './repository';

/**
 * Where the repository's rows come from and where its changes go. There are two:
 *
 * - `demo`: the seed plus this browser's journal. Visibility is applied in code
 *   (`demo/source.ts`), mirroring the database policies.
 * - `supabase`: the Hyphy Tools database, queried as the signed-in person, so Row Level Security
 *   decides what comes back and what may change (`supabase/source.ts`).
 *
 * Everything above this line — approvals, the derived inbox, names, filters — is shared
 * (`core.ts`), so both backends behave the same by construction.
 */

/** Rows of the current Space this person may see. Unsorted; the core sorts. */
export type Visible = {
  projects: Project[];
  vehicles: Vehicle[];
  receipts: Receipt[];
  mileage: MileageEntry[];
  files: FileRecord[];
  qrCodes: QrCode[];
  linkPages: LinkPage[];
  activity: ActivityEvent[];
  /** Stored notifications addressed to this person or their role. */
  inbox: InboxItem[];
  /** Memberships this person may see, with the person. */
  members: Member[];
  /** Everyone who belongs to this Space, for names on records. */
  directory: Person[];
  approvalEvents: ApprovalEvent[];
  /**
   * The business's own fields (every one, archived too), for the records this person can see:
   * a guest gets only what their shared projects need.
   */
  fields: FieldDefinition[];
};

export type WritableTable =
  | 'projects'
  | 'vehicles'
  | 'receipts'
  | 'mileage'
  | 'files'
  /** One more record for a file: `{ fileId, type, id }`. */
  | 'fileAttachments'
  | 'qrCodes'
  | 'linkPages'
  | 'inbox'
  | 'spaces';

export type Change =
  | { op: 'insert'; table: WritableTable; row: Record<string, unknown> }
  | { op: 'update'; table: WritableTable; id: string; patch: Record<string, unknown> }
  /** Only files are ever deleted: an unfinished upload, or one from Trash. */
  | { op: 'delete'; table: 'files'; id: string };

/** A change to the business's own fields. A field is named by its record type and key. */
export type FieldChange =
  | { op: 'insert'; field: FieldDefinition }
  | {
      op: 'update';
      appliesTo: RecordType;
      id: string;
      patch: Partial<
        Pick<
          FieldDefinition,
          'label' | 'type' | 'options' | 'required' | 'help' | 'showInList' | 'position'
        >
      > & { archivedAt?: string | null };
    }
  | { op: 'delete'; appliesTo: RecordType; id: string };

export interface DataSource {
  readonly kind: 'demo' | 'supabase';
  load<K extends keyof Visible>(key: K): Promise<Visible[K]>;
  /** A new record id in this backend's format. */
  newId(prefix: string): string;
  /**
   * Applies changes together, as this person. An update that matches nothing they may change
   * fails the whole write (`RuleError`), so nothing is half-saved.
   */
  write(changes: Change[]): Promise<void>;
  invite(input: InviteInput): Promise<Member>;
  /** Changes the business's fields together; the database refuses what would harm saved values. */
  writeFields(changes: FieldChange[]): Promise<void>;
  /** A person's answers to the business's People fields (only people managers). */
  setMemberFields(personId: string, custom: Record<string, FieldValue>): Promise<void>;
  pins(): Promise<PinTarget[]>;
  setPins(pins: PinTarget[]): Promise<void>;
  /** Finishes an upload as its uploader; the database checks the bytes arrived as promised. */
  finishUpload(id: string): Promise<UploadOutcome>;
  /** Sets (or clears) the business's logo; returns the one it replaced. */
  setLogo(fileId: string | null): Promise<string | null>;
  storageBytes(): Promise<number | null>;
}
