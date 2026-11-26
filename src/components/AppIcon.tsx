import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lightbulb,
  LogOut,
  Mail,
  MapPin,
  Minus,
  Plus,
  Play,
  Power,
  Radar,
  QrCode,
  Send,
  SlidersHorizontal,
  ShieldAlert,
  ShieldCheck,
  Share,
  Smartphone,
  TriangleAlert,
  Unlock,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { FC } from 'react';

const ICONS: Record<string, LucideIcon> = {
  add: Plus,
  analytics: BarChart3,
  arrow_back: ArrowLeft,
  check_circle: CheckCircle2,
  check_circle_outline: CheckCircle2,
  check_circle_filled: CheckCircle2,
  close: X,
  cloud_off: CloudOff,
  dynamic_form: SlidersHorizontal,
  expand_less: ChevronUp,
  expand_more: ChevronDown,
  info: Info,
  install_mobile: Smartphone,
  ios_share: Share,
  key: KeyRound,
  lightbulb: Lightbulb,
  location_on: MapPin,
  lock_open: Unlock,
  logout: LogOut,
  mail: Mail,
  play_arrow: Play,
  policy: ShieldCheck,
  power_settings_new: Power,
  qr_code_scanner: QrCode,
  radar: Radar,
  remove: Minus,
  security: ShieldAlert,
  send: Send,
  shield_person: ShieldCheck,
  verified_user: BadgeCheck,
  visibility: Eye,
  visibility_off: EyeOff,
  warning: TriangleAlert,
};

interface AppIconProps {
  name: string;
  className?: string;
  id?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export const AppIcon: FC<AppIconProps> = ({ name, className, ...props }) => {
  const Icon = ICONS[name] ?? Activity;
  return <Icon aria-hidden="true" className={className} style={{ width: '1em', height: '1em' }} {...props} />;
};
