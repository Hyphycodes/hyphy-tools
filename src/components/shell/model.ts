import type { CreateAction, CreateActionId } from '@/lib/platform/actions';
import type { ApprovalRule, FormRules } from '@/lib/platform/business-settings';
import type { NavModel } from '@/lib/platform/navigation';
import type { Permission } from '@/lib/platform/roles';
import type { FieldDefinition, FileStorage, Person, Role, Space } from '@/lib/platform/types';

/** What the client shell knows about the current Workspace. Serializable, built on the server. */
export type ShellModel = {
  person: Person;
  /** The sign-in account, for real accounts (sign out, login email). Null in Demo Mode. */
  account: { email: string } | null;
  space: Space;
  role: Role;
  roleLabel: string;
  title: string;
  planName: string;
  permissions: Permission[];
  spaces: {
    id: string;
    slug: string;
    name: string;
    kind: Space['kind'];
    brand: Space['brand'];
    logo?: Space['logo'];
    descriptor: string;
    roleLabel: string;
  }[];
  /**
   * Where this person's new files' bytes go: Hyphy's storage, or — Demo Mode — this browser. The
   * interface says which, so nothing claims a file is stored somewhere it isn't.
   */
  fileStorage: FileStorage;
  nav: NavModel;
  inboxCount: number;
  actions: CreateAction[];
  options: {
    projects: { id: string; name: string; status: string }[];
    vehicles: {
      id: string;
      name: string;
      assignedTo?: string;
      odometer: number;
      fuelCardLast4?: string;
    }[];
    places: string[];
    people: { id: string; name: string; initials: string; hue: string; role: Role }[];
    /** Where this person is working now, so new receipts and trips land there by default. */
    currentProjectId?: string;
    /** Their last few distinct trips, to log the same one again in a tap. */
    recentTrips: {
      from: string;
      to: string;
      miles: number;
      roundTrip: boolean;
      purpose: string;
      vehicleId?: string;
      projectId?: string;
    }[];
  };
  labels: {
    project: string;
    projects: string;
    vehicle: string;
    vehicles: string;
    customer: string;
  };
  /**
   * What this business asks for, for the forms this person fills in: its fields in use (only the
   * record types they can reach) and its rules. They're simply "what ABC needs from you".
   */
  setup: {
    fields: FieldDefinition[];
    rules: FormRules;
    /** When a receipt or trip from this person waits for approval. */
    approval: { receipt: ApprovalRule | null; mileage: ApprovalRule | null };
  };
};

export type { CreateAction, CreateActionId };
