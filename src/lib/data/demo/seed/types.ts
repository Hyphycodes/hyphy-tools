import type {
  ActivityEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  Person,
  Pin,
  Project,
  QrCode,
  Receipt,
  Space,
  Vehicle,
} from '@/lib/platform/types';

/** The whole demo world, shaped like the proposed tables. */
export type Dataset = {
  people: Person[];
  spaces: Space[];
  memberships: Membership[];
  projects: Project[];
  vehicles: Vehicle[];
  receipts: Receipt[];
  mileage: MileageEntry[];
  files: FileRecord[];
  qrCodes: QrCode[];
  linkPages: LinkPage[];
  activity: ActivityEvent[];
  inbox: InboxItem[];
  /** Default pins; a visitor's own choices are kept beside the journal (see prefs.ts). */
  pins: Pin[];
};

export type TableName = keyof Dataset;

export type SeedSlice = Partial<Omit<Dataset, 'people' | 'spaces' | 'memberships' | 'pins'>>;
