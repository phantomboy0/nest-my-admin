import {
  Bell, BookOpen, Box, Boxes, Briefcase, Building2, Calendar, ChartColumn, Clock, CreditCard, Database, DollarSign, File,
  FileText, Folder, Globe, Heart, History, House, Image, Inbox, Key, Layers, Link, List, Lock, Mail, Map, MapPin,
  MessageSquare, Package, Phone, Printer, Receipt, Server, Settings, Shield, ShoppingBag, ShoppingCart, Star, Store, Tag,
  Tags, Ticket, Truck, User, Users, Video, Wallet, Wrench, Zap, type LucideIcon,
} from 'lucide-react';

/**
 * The icons `@AdminGroup({ icon })` and `@AdminResource({ icon })` can name (lucide names, plus a few aliases).
 * A curated set keeps the bundle small; unknown names fall back to a generic icon.
 */
const ICONS: Record<string, LucideIcon> = {
  bell: Bell, book: BookOpen, box: Box, boxes: Boxes, briefcase: Briefcase, building: Building2, calendar: Calendar,
  chart: ChartColumn, clock: Clock, 'credit-card': CreditCard, database: Database, dollar: DollarSign, file: File,
  'file-text': FileText, folder: Folder, globe: Globe, heart: Heart, history: History, home: House, image: Image,
  inbox: Inbox, key: Key, layers: Layers, link: Link, list: List, lock: Lock, mail: Mail, map: Map, 'map-pin': MapPin,
  message: MessageSquare, package: Package, phone: Phone, printer: Printer, receipt: Receipt, server: Server,
  settings: Settings, shield: Shield, 'shopping-bag': ShoppingBag, cart: ShoppingCart, 'shopping-cart': ShoppingCart,
  star: Star, store: Store, tag: Tag, tags: Tags, ticket: Ticket, truck: Truck, user: User, users: Users, video: Video,
  wallet: Wallet, wrench: Wrench, zap: Zap,
};

export const ICON_NAMES = Object.keys(ICONS);

export function iconFor(name: string | undefined, fallback: 'group' | 'resource'): LucideIcon {
  return (name ? ICONS[name] : undefined) ?? (fallback === 'group' ? Folder : FileText);
}
