/**
 * Shared screen furniture.
 *
 * Small pieces that every list and detail screen needs, kept here so they look
 * and behave the same everywhere: a page header with optional actions, a filter
 * bar, and a compact "record count" summary.
 */

import type { ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, IconButton, TextInput } from '@/ui/components/base';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={className}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface FilterBarProps {
  search: string;
  onSearch: (value: string) => void;
  placeholder?: string;
  children?: ReactNode;
  className?: string;
}

export function FilterBar({
  search,
  onSearch,
  placeholder = 'Search…',
  children,
  className,
}: FilterBarProps) {
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <TextInput
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="pl-8"
          />
          {search && (
            <IconButton
              label="Clear search"
              size="sm"
              onClick={() => onSearch('')}
              className="absolute right-1 top-1/2 -translate-y-1/2"
            >
              <X className="size-3.5" aria-hidden />
            </IconButton>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export interface EmptyListProps {
  icon?: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}

export function EmptyList({ icon, title, hint, action }: EmptyListProps) {
  return (
    <Card className="p-0">
      <EmptyState icon={icon} title={title} hint={hint} action={action} />
    </Card>
  );
}

/** A count with a pluralised noun, so a summary never reads "1 invoices". */
export function CountBadge({ count, noun, plural }: { count: number; noun: string; plural?: string }) {
  const label =
    count === 0 ? `No ${plural ?? `${noun}s`}` : `${count} ${count === 1 ? noun : (plural ?? `${noun}s`)}`;
  return <Badge className="bg-paper-sunken text-ink-muted">{label}</Badge>;
}

/** A one-line summary of what a list contains. */
export function ListSummary({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">{children}</div>;
}

export { Button, Card };
