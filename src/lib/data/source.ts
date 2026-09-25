import type {
  ActivityEvent,
  ApprovalEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  MileageEntry,
  Person,
  PinTarget,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';
import type { InviteInput, Member } from './repository';

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
};

export type WritableTable =
  | 'projects'
  | 'vehicles'
  | 'receipts'
  | 'mileage'
  | 'files'
  | 'qrCodes'
  | 'linkPages'
  | 'inbox'
  | 'spaces';

export type Change =
  | { op: 'insert'; table: WritableTable; row: Record<string, unknown> }
  | { op: 'update'; table: WritableTable; id: string; patch: Record<string, unknown> };

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
  pins(): Promise<PinTarget[]>;
  setPins(pins: PinTarget[]): Promise<void>;
}
