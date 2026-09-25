import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  Calendar,
  Camera,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDashed,
  ClipboardList,
  Clock,
  Command,
  Copy,
  CornerDownLeft,
  Download,
  Eye,
  EyeOff,
  FileText,
  Filter,
  FolderKanban,
  Fuel,
  Gauge,
  GripVertical,
  House,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Route,
  ScanLine,
  Search,
  Settings2,
  Share2,
  Shield,
  Sparkles,
  Split,
  Trash2,
  Truck,
  Upload,
  User,
  UserPlus,
  Users,
  Wifi,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';

/*
 * One icon set for the whole product: Lucide at a 1.75 stroke, plus Hyphy's own tool
 * pictograms (drawn for Hyphy Studio and kept here so tools look the same in both products).
 */

const brand = {
  pdf: (
    <>
      <path d="M8 3h6.5L19 7.5V18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M4.5 7v12.5A1.5 1.5 0 0 0 6 21h9" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1" />
      <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 20.5h2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m3 16 5-5 4.5 4.5L15 13l6 6" />
      <circle cx="16" cy="9" r="1.6" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.2 1.2" />
      <path d="M13.5 10.5a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.2-1.2" />
    </>
  ),
  folders: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M6 3.5h4l2 2" />
    </>
  ),
  files: (
    <>
      <path d="M14.5 3H8a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 8 19h9a1.5 1.5 0 0 0 1.5-1.5V7Z" />
      <path d="M14.5 3v4h4M3.5 7.5V20a1 1 0 0 0 1 1h9.5" />
    </>
  ),
  spark: (
    <g strokeWidth="2.6">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </g>
  ),
} as const;

const lucide = {
  activity: Activity,
  alert: AlertTriangle,
  archive: Archive,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up-right': ArrowUpRight,
  bell: Bell,
  building: Building2,
  calendar: Calendar,
  camera: Camera,
  car: Car,
  check: Check,
  'check-circle': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  chevrons: ChevronsUpDown,
  circle: CircleDashed,
  clock: Clock,
  command: Command,
  copy: Copy,
  download: Download,
  enter: CornerDownLeft,
  eye: Eye,
  'eye-off': EyeOff,
  'file-text': FileText,
  filter: Filter,
  form: ClipboardList,
  fuel: Fuel,
  gauge: Gauge,
  grip: GripVertical,
  home: House,
  inbox: Inbox,
  key: KeyRound,
  lock: Lock,
  logout: LogOut,
  mail: Mail,
  'map-pin': MapPin,
  message: MessageSquare,
  minus: Minus,
  more: MoreHorizontal,
  pencil: Pencil,
  people: Users,
  pin: Pin,
  plus: Plus,
  projects: FolderKanban,
  refresh: RefreshCw,
  route: Route,
  scan: ScanLine,
  search: Search,
  settings: Settings2,
  share: Share2,
  shield: Shield,
  sparkles: Sparkles,
  split: Split,
  tools: LayoutGrid,
  trash: Trash2,
  truck: Truck,
  upload: Upload,
  user: User,
  'user-plus': UserPlus,
  wifi: Wifi,
  wrench: Wrench,
  x: X,
  'image-lucide': ImageIcon,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof brand | keyof typeof lucide;

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.75,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  /** Give meaningful standalone icons a label; decorative ones stay hidden. */
  label?: string;
}) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  if (name in brand)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...a11y}
      >
        {brand[name as keyof typeof brand]}
      </svg>
    );
  const Component = lucide[name as keyof typeof lucide];
  return <Component size={size} strokeWidth={strokeWidth} className={className} {...a11y} />;
}
