import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
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
  ExternalLink,
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
  List,
  Lock,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Minus,
  Palette,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
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
  AtSign,
  Braces,
  CalendarClock,
  ChevronLeft,
  ChevronUp,
  Circle,
  Clipboard,
  Coins,
  Contact,
  Contrast,
  CopyCheck,
  CreditCard,
  Crop,
  Dices,
  FileImage,
  FileStack,
  Files,
  FolderOpen,
  FolderSearch,
  Frame,
  Gift,
  Globe,
  Grid3x3,
  Hand,
  Hash,
  Heart,
  Layers,
  Link2,
  ListOrdered,
  LoaderCircle,
  Megaphone,
  Menu,
  MessageSquareText,
  Moon,
  Move,
  Music,
  PartyPopper,
  Phone,
  Pipette,
  Play,
  ReceiptText,
  Repeat,
  Replace,
  RotateCw,
  Save,
  Scissors,
  Send,
  ShieldCheck,
  ShoppingBasket,
  SlidersHorizontal,
  Snowflake,
  Square,
  Star,
  Store,
  Sun,
  SwatchBook,
  Tag,
  Target,
  Ticket,
  Type,
  Undo2,
  UtensilsCrossed,
  Video,
  Wallet,
  ZoomIn,
  ZoomOut,
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
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".6" fill="currentColor" />
    </>
  ),
  tiktok: <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.4 2.6 2.2 4.4 5 4.6" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10.5 9.3 4.2 2.7-4.2 2.7Z" fill="currentColor" />
    </>
  ),
  'x-social': <path d="M4 4l16 16M20 4 4 20" />,
  linkedin: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M8 10.5V16M8 7.6v.1M11.5 16v-5.5M11.5 13c0-1.6 1-2.6 2.3-2.6s2.2.9 2.2 2.6V16" />
    </>
  ),
  facebook: <path d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.5V4.4a20 20 0 0 0-2.3-.1c-2.3 0-3.8 1.4-3.8 3.9v2.3H9v3h2.5V21" />,
  spotify: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 9.6c3-.9 6.6-.6 9.2.9M8 12.7c2.5-.7 5.2-.4 7.3.8M8.6 15.5c1.9-.5 3.8-.3 5.4.6" />
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
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
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
  external: ExternalLink,
  'file-text': FileText,
  filter: Filter,
  form: ClipboardList,
  fuel: Fuel,
  gauge: Gauge,
  grip: GripVertical,
  home: House,
  inbox: Inbox,
  key: KeyRound,
  list: List,
  lock: Lock,
  logout: LogOut,
  mail: Mail,
  'map-pin': MapPin,
  message: MessageSquare,
  minus: Minus,
  more: MoreHorizontal,
  palette: Palette,
  paperclip: Paperclip,
  pencil: Pencil,
  people: Users,
  pin: Pin,
  plus: Plus,
  projects: FolderKanban,
  refresh: RefreshCw,
  restore: RotateCcw,
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
  at: AtSign,
  basket: ShoppingBasket,
  braces: Braces,
  'calendar-clock': CalendarClock,
  card: CreditCard,
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  clipboard: Clipboard,
  coins: Coins,
  contact: Contact,
  contrast: Contrast,
  'copy-check': CopyCheck,
  crop: Crop,
  dice: Dices,
  dot: Circle,
  'file-image': FileImage,
  'file-stack': FileStack,
  'files-stack': Files,
  'folder-open': FolderOpen,
  'folder-search': FolderSearch,
  frame: Frame,
  gift: Gift,
  globe: Globe,
  grid: Grid3x3,
  hand: Hand,
  hash: Hash,
  heart: Heart,
  layers: Layers,
  'link-2': Link2,
  'list-ordered': ListOrdered,
  loader: LoaderCircle,
  megaphone: Megaphone,
  menu: Menu,
  moon: Moon,
  move: Move,
  music: Music,
  party: PartyPopper,
  phone: Phone,
  pipette: Pipette,
  play: Play,
  'receipt-text': ReceiptText,
  repeat: Repeat,
  replace: Replace,
  'rotate-cw': RotateCw,
  save: Save,
  scissors: Scissors,
  send: Send,
  'shield-check': ShieldCheck,
  sliders: SlidersHorizontal,
  sms: MessageSquareText,
  snowflake: Snowflake,
  square: Square,
  star: Star,
  store: Store,
  sun: Sun,
  swatch: SwatchBook,
  tag: Tag,
  target: Target,
  ticket: Ticket,
  type: Type,
  undo: Undo2,
  utensils: UtensilsCrossed,
  video: Video,
  wallet: Wallet,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
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
