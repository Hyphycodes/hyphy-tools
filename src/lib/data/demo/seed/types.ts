import type {
  ActivityEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  Person,
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
};

export type TableName = keyof Dataset;

export type SeedSlice = Partial<Omit<Dataset, 'people' | 'spaces' | 'memberships'>>;
