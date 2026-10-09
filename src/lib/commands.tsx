/**
 * The command registry.
 *
 * Every command the palette and the keyboard shortcuts can run. Keeping them in
 * one list means a shortcut and a palette entry can never drift apart, and
 * adding an action to the palette is one object rather than three edits.
 */

import type { ReactNode } from 'react';
import {
  Copy,
  FilePlus2,
  FileText,
  LayoutDashboard,
  Package,
  Plus,
  Receipt,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Client, Document } from '@/core/schemas';

export interface Command {
  id: string;
  label: string;
  /** Second line in the palette: context, or what the action does. */
  hint?: string;
  group?: string;
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  run: () => void;
}

interface RegistryArgs {
  clients: Client[];
  documents: Document[];
  navigate: (to: string) => void;
}

const icon = (Icon: LucideIcon) => <Icon className="size-4" aria-hidden />;

/** macOS uses ⌘; everywhere else uses Ctrl. */
export function modifierKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? '⌘' : 'Ctrl';
}

export function shortcutLabel(combo: string): string {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const mods = parts.map((p) =>
    p === 'cmd' || p === 'ctrl' ? modifierKey() : p === 'shift' ? '⇧' : p === 'alt' ? '⌥' : p,
  );
  return [...mods, key.length === 1 ? key.toUpperCase() : key.replace(/^./, (c) => c.toUpperCase())].join('');
}

export function commandRegistry({ clients, documents, navigate }: RegistryArgs): Command[] {
  const commands: Command[] = [];

  /* ---- navigation ---- */

  const screens: { to: string; label: string; group: string; Icon: LucideIcon }[] = [
    { to: '/', label: 'Dashboard', group: 'Go to', Icon: LayoutDashboard },
    { to: '/invoices', label: 'Invoices', group: 'Go to', Icon: Receipt },
    { to: '/quotes', label: 'Quotes', group: 'Go to', Icon: FileText },
    { to: '/clients', label: 'Clients', group: 'Go to', Icon: Users },
    { to: '/items', label: 'Item catalogue', group: 'Go to', Icon: Package },
    { to: '/templates', label: 'Templates', group: 'Go to', Icon: Settings },
    { to: '/settings', label: 'Settings', group: 'Go to', Icon: Settings },
    { to: '/settings/businesses', label: 'Business profiles', group: 'Go to', Icon: Settings },
    { to: '/settings/files', label: 'Output folders', group: 'Go to', Icon: Settings },
    { to: '/settings/tax-codes', label: 'Tax codes', group: 'Go to', Icon: Settings },
    { to: '/settings/data', label: 'Data and backups', group: 'Go to', Icon: Settings },
  ];

  for (const screen of screens) {
    commands.push({
      id: `go:${screen.to}`,
      label: screen.label,
      group: screen.group,
      keywords: 'navigate open screen',
      icon: icon(screen.Icon),
      run: () => navigate(screen.to),
    });
  }

  /* ---- create ---- */

  commands.push(
    {
      id: 'new:invoice',
      label: 'New invoice',
      hint: 'Blank invoice for the current business',
      group: 'Create',
      keywords: 'create make add bill',
      icon: icon(Plus),
      shortcut: shortcutLabel('cmd+n'),
      run: () => navigate('/invoices/new'),
    },
    {
      id: 'new:quote',
      label: 'New quote',
      group: 'Create',
      keywords: 'create estimate proposal',
      icon: icon(FilePlus2),
      run: () => navigate('/quotes/new'),
    },
    {
      id: 'new:credit-note',
      label: 'New credit note',
      group: 'Create',
      keywords: 'create refund reverse',
      icon: icon(FilePlus2),
      run: () => navigate('/credit-notes/new'),
    },
    {
      id: 'new:client',
      label: 'New client',
      group: 'Create',
      keywords: 'create add contact customer',
      icon: icon(Users),
      run: () => navigate('/clients/new'),
    },
    {
      id: 'new:item',
      label: 'New catalogue item',
      group: 'Create',
      keywords: 'create add product service price',
      icon: icon(Plus),
      run: () => navigate('/items/new'),
    },
  );

  /* ---- "new invoice for X", one command per client ---- */

  for (const client of clients.filter((c) => !c.archived).slice(0, 60)) {
    commands.push({
      id: `new:invoice:${client.id}`,
      label: `New invoice for ${client.displayName}`,
      hint: client.email || undefined,
      group: 'Create',
      keywords: `invoice ${client.displayName} ${client.tags.join(' ')} bill`,
      icon: icon(Receipt),
      run: () => navigate(`/invoices/new?clientId=${client.id}`),
    });
  }

  /* ---- open recent documents ---- */

  const recent = [...documents]
    .filter((d) => !d.deletedAt && d.number)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);

  for (const doc of recent) {
    commands.push({
      id: `open:${doc.id}`,
      label: `${doc.number} — ${doc.clientId ? clientName(doc, clients) : 'No client'}`,
      hint: `${doc.issueDate} · ${doc.status}`,
      group: 'Open',
      keywords: `open ${doc.number} invoice quote`,
      icon: icon(FileText),
      run: () => navigate(documentPath(doc)),
    });
  }

  return commands;
}

function clientName(doc: Document, clients: Client[]): string {
  return clients.find((c) => c.id === doc.clientId)?.displayName ?? 'No client';
}

/** The canonical route for a document, whatever its type. */
export function documentPath(doc: Pick<Document, 'id' | 'type'>): string {
  switch (doc.type) {
    case 'quote':
      return `/quotes/${doc.id}`;
    case 'credit_note':
      return `/credit-notes/${doc.id}`;
    case 'delivery_note':
      return `/delivery-notes/${doc.id}`;
    case 'proforma':
      return `/proformas/${doc.id}`;
    case 'payment_receipt':
      return `/receipts/${doc.id}`;
    case 'invoice':
    default:
      return `/invoices/${doc.id}`;
  }
}

/** The route for creating a document of a type. */
export function newDocumentPath(type: Document['type']): string {
  switch (type) {
    case 'quote':
      return '/quotes/new';
    case 'credit_note':
      return '/credit-notes/new';
    case 'delivery_note':
      return '/delivery-notes/new';
    case 'proforma':
      return '/proformas/new';
    case 'payment_receipt':
      return '/receipts/new';
    case 'invoice':
    default:
      return '/invoices/new';
  }
}

/** Copy text to the clipboard, for the "copy invoice number" action. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export { Copy };
