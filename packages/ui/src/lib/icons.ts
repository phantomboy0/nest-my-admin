import {
  Archive, Ban, Bell, BookOpen, Box, Boxes, Briefcase, Building2, Calendar, ChartColumn, Check, Clock, CreditCard, Database,
  DollarSign, File, FileText, Folder, Globe, Heart, History, House, Image, Inbox, Key, Layers, Link, List, Lock, Mail, Map,
  MapPin, MessageSquare, Package, Phone, Printer, Receipt, RefreshCw, Send, Server, Settings, Shield, ShoppingBag,
  ShoppingCart, Star, Store, Tag, Tags, Ticket, Truck, User, Users, Video, Wallet, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react';

/**
 * The icons `@AdminGroup`, `@AdminResource`, `@AdminSettingsPage` and `@AdminAction` can name (lucide names, plus a
 * few aliases).
 * A curated set keeps the bundle small; unknown names fall back to a generic icon.
 */
const ICONS: Record<string, LucideIcon> = {
  archive: Archive, ban: Ban, bell: Bell, book: BookOpen, box: Box, boxes: Boxes, briefcase: Briefcase, building: Building2, calendar: Calendar,
  chart: ChartColumn, check: Check, clock: Clock, 'credit-card': CreditCard, database: Database, dollar: DollarSign, file: File,
  'file-text': FileText, folder: Folder, globe: Globe, heart: Heart, history: History, home: House, image: Image,
  inbox: Inbox, key: Key, layers: Layers, link: Link, list: List, lock: Lock, mail: Mail, map: Map, 'map-pin': MapPin,
  message: MessageSquare, package: Package, phone: Phone, printer: Printer, receipt: Receipt, refresh: RefreshCw, send: Send,
  server: Server,
  settings: Settings, shield: Shield, 'shopping-bag': ShoppingBag, cart: ShoppingCart, 'shopping-cart': ShoppingCart,
  star: Star, store: Store, tag: Tag, tags: Tags, ticket: Ticket, truck: Truck, user: User, users: Users, video: Video,
  wallet: Wallet, wrench: Wrench, x: X, zap: Zap,
};

export const ICON_NAMES = Object.keys(ICONS);

export function iconFor(name: string | undefined, fallback: 'group' | 'resource' | 'page'): LucideIcon {
  return iconNamed(name) ?? (fallback === 'group' ? Folder : fallback === 'page' ? Settings : FileText);
}

/** The icon with that name, or none (action buttons show an icon only when one is named and known). */
export function iconNamed(name: string | undefined): LucideIcon | undefined {
  return name && Object.hasOwn(ICONS, name) ? ICONS[name] : undefined;
}
