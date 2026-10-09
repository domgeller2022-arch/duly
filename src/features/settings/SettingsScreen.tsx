/**
 * Settings.
 *
 * One screen with tabbed sections rather than a route per screen, because the whole
 * thing is a form of forms: Businesses, Tax codes, Currencies, Numbering, Locale,
 * Appearance, Custom fields, Files, Data. The section is a path segment, so any of
 * them is linkable and the command palette can jump straight to one.
 *
 * Everything saves on change. There is no "Save settings" button because there is
 * nothing to batch: each field is one write, and the database is the truth. That
 * also means an autosave indicator is unnecessary — the value on screen is always
 * what is on disk.
 */

import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Building2,
  Database,
  FolderOpen,
  Hash,
  Landmark,
  Mail,
  Palette,
  Sliders,
  Sparkles,
  Tag,
} from 'lucide-react';
import { Alert, Tabs } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { BusinessesSection } from './sections/BusinessesSection';
import { TaxCodesSection } from './sections/TaxCodesSection';
import { CurrenciesSection } from './sections/CurrenciesSection';
import { NumberingSection } from './sections/NumberingSection';
import { LocaleSection } from './sections/LocaleSection';
import { EmailTemplatesSection } from './sections/EmailTemplatesSection';
import { EmailAccountsSection } from './sections/EmailAccountsSection';
import { AiSection } from './sections/AiSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { CustomFieldsSection } from './sections/CustomFieldsSection';
import { FilesSection } from './sections/FilesSection';
import { DataSection } from './sections/DataSection';

const SECTIONS = [
  { id: 'businesses', label: 'Businesses', icon: <Building2 className="size-3.5" aria-hidden /> },
  { id: 'tax-codes', label: 'Tax codes', icon: <Tag className="size-3.5" aria-hidden /> },
  { id: 'currencies', label: 'Currencies', icon: <Landmark className="size-3.5" aria-hidden /> },
  { id: 'numbering', label: 'Numbering', icon: <Hash className="size-3.5" aria-hidden /> },
  { id: 'locale', label: 'Locale', icon: <Sliders className="size-3.5" aria-hidden /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="size-3.5" aria-hidden /> },
  { id: 'custom-fields', label: 'Custom fields', icon: <Tag className="size-3.5" aria-hidden /> },
  { id: 'email-templates', label: 'Email templates', icon: <Mail className="size-3.5" aria-hidden /> },
  { id: 'email-accounts', label: 'Email accounts', icon: <Mail className="size-3.5" aria-hidden /> },
  { id: 'files', label: 'Files', icon: <FolderOpen className="size-3.5" aria-hidden /> },
  { id: 'ai', label: 'AI', icon: <Sparkles className="size-3.5" aria-hidden /> },
  { id: 'data', label: 'Data', icon: <Database className="size-3.5" aria-hidden /> },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function isSection(value: string | undefined): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

export function SettingsScreen() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const [fallback] = useState<SectionId>('businesses');

  const active = isSection(section) ? section : fallback;

  // An unknown section is a dead link, so say so rather than silently showing the
  // first one and pretending the URL worked.
  if (section && !isSection(section)) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6" data-print="hide">
      <PageHeader
        title="Settings"
        subtitle="Saved as you go. Nothing here needs an internet connection."
        className="mb-4"
      />

      <Tabs
        className="mb-5 flex-wrap"
        tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon }))}
        active={active}
        onChange={(id) => navigate(id === 'businesses' ? '/settings' : `/settings/${id}`)}
      />

      {active === 'businesses' && <BusinessesSection />}
      {active === 'tax-codes' && <TaxCodesSection />}
      {active === 'currencies' && <CurrenciesSection />}
      {active === 'numbering' && <NumberingSection />}
      {active === 'locale' && <LocaleSection />}
      {active === 'appearance' && <AppearanceSection />}
      {active === 'custom-fields' && <CustomFieldsSection />}
      {active === 'email-templates' && <EmailTemplatesSection />}
      {active === 'email-accounts' && <EmailAccountsSection />}
      {active === 'files' && <FilesSection />}
      {active === 'ai' && <AiSection />}
      {active === 'data' && <DataSection />}
    </div>
  );
}

/** Shown where a section needs a business to exist before it can be edited. */
export function NoBusinessYet() {
  const navigate = useNavigate();
  return (
    <Alert tone="info" title="No business yet">
      Add your first business before changing settings that belong to one.
      <button type="button" className="ml-1 underline" onClick={() => navigate('/setup')}>
        Set up a business
      </button>
    </Alert>
  );
}
