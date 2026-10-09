/**
 * The router.
 *
 * One route per screen in the plan's inventory. Every route renders inside the
 * app shell, so the sidebar, top bar and command palette are always present and
 * navigation never loses its place.
 *
 * The URL is the source of truth for what is open: a filtered invoice list, a
 * particular document and a particular tab are all linkable, which is what makes
 * the command palette's "jump anywhere" work.
 */

import type { RouteObject } from 'react-router-dom';

import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { SetupWizardScreen } from '@/features/setup/SetupWizardScreen';
import { DocumentsListScreen } from '@/features/documents/DocumentsListScreen';
import { DocumentEditorScreen } from '@/features/documents/editor/DocumentEditorScreen';
import { ClientsScreen } from '@/features/clients/ClientsScreen';
import { ClientEditScreen } from '@/features/clients/ClientEditScreen';
import { ClientDetailScreen } from '@/features/clients/ClientDetailScreen';
import { ItemsScreen } from '@/features/items/ItemsScreen';
import { TemplatesScreen } from '@/features/templates/TemplatesScreen';
import { TemplateStudioScreen } from '@/features/templates/TemplateStudioScreen';
import { AcceptanceScreen } from '@/features/AcceptanceScreen';
import { NotFoundScreen } from '@/features/NotFoundScreen';
import { AutomationLogScreen } from '@/features/automation/AutomationLogScreen';
import { RecurringScreen } from '@/features/automation/RecurringScreen';
import { RemindersScreen } from '@/features/automation/RemindersScreen';
import { RulesScreen } from '@/features/automation/RulesScreen';
import { ReportsScreen } from '@/features/reports/ReportsScreen';
import { BankImportScreen } from '@/features/import/BankImportScreen';
import { TimeTrackingScreen } from '@/features/timetracking/TimeTrackingScreen';
import { ExpensesScreen } from '@/features/expenses/ExpensesScreen';
import { ProjectsScreen } from '@/features/projects/ProjectsScreen';
import { RetainersScreen } from '@/features/retainers/RetainersScreen';
import { StyleGuideScreen } from '@/features/StyleGuideScreen';

export const routes: RouteObject[] = [
  { path: '/', element: <DashboardScreen /> },

  /* ---- invoices, quotes, credit notes, delivery notes, pro-formas, receipts ---- */
  { path: '/invoices', element: <DocumentsListScreen kind="invoice" /> },
  { path: '/invoices/:documentId', element: <DocumentEditorScreen type="invoice" /> },

  { path: '/quotes', element: <DocumentsListScreen kind="quote" /> },
  { path: '/quotes/:documentId', element: <DocumentEditorScreen type="quote" /> },

  { path: '/credit-notes', element: <DocumentsListScreen kind="credit_note" /> },
  { path: '/credit-notes/:documentId', element: <DocumentEditorScreen type="credit_note" /> },

  { path: '/delivery-notes', element: <DocumentsListScreen kind="delivery_note" /> },
  { path: '/delivery-notes/:documentId', element: <DocumentEditorScreen type="delivery_note" /> },

  { path: '/proformas', element: <DocumentsListScreen kind="proforma" /> },
  { path: '/proformas/:documentId', element: <DocumentEditorScreen type="proforma" /> },

  { path: '/receipts', element: <DocumentsListScreen kind="payment_receipt" /> },
  { path: '/receipts/:documentId', element: <DocumentEditorScreen type="payment_receipt" /> },

  /* ---- clients ---- */
  { path: '/clients', element: <ClientsScreen /> },
  { path: '/clients/new', element: <ClientEditScreen /> },
  { path: '/clients/:clientId', element: <ClientDetailScreen /> },
  { path: '/clients/:clientId/edit', element: <ClientEditScreen /> },

  /* ---- item catalogue ---- */
  // Items are edited in place in the catalogue, so `/items/new` is the same screen
  // with a blank row added rather than a separate form.
  { path: '/items', element: <ItemsScreen /> },

  /* ---- templates ---- */
  { path: '/templates', element: <TemplatesScreen /> },
  { path: '/templates/:templateId', element: <TemplateStudioScreen /> },

  /* ---- hidden acceptance ---- */
  { path: '/acceptance', element: <AcceptanceScreen /> },
  { path: '/items/new', element: <ItemsScreen startNew /> },

  /* ---- automation and reports ---- */
  { path: '/recurring', element: <RecurringScreen /> },
  { path: '/reminders', element: <RemindersScreen /> },
  { path: '/rules', element: <RulesScreen /> },
  { path: '/automation-log', element: <AutomationLogScreen /> },
  { path: '/reports', element: <ReportsScreen /> },
  { path: '/bank-import', element: <BankImportScreen /> },
  { path: '/time', element: <TimeTrackingScreen /> },
  { path: '/expenses', element: <ExpensesScreen /> },
  { path: '/projects', element: <ProjectsScreen /> },
  { path: '/retainers', element: <RetainersScreen /> },

  /* ---- settings and setup ---- */
  // The section is a path segment rather than a route of its own, so a settings
  // screen is linkable and back-button friendly without a second router entry per
  // section.
  { path: '/settings', element: <SettingsScreen /> },
  { path: '/settings/:section', element: <SettingsScreen /> },

  { path: '/setup', element: <SetupWizardScreen /> },

  /* ---- design system ---- */
  { path: '/style-guide', element: <StyleGuideScreen /> },

  /* ---- fallbacks ---- */
  { path: '*', element: <NotFoundScreen /> },
];

/**
 * Routes for later phases.
 *
 * Kept as a list rather than spread through the router so the remaining screen
 * inventory stays visible and each phase adds its own entries. A route pointing
 * at a screen that does not exist yet falls through to the not-found page rather
 * than crashing the app.
 */
export const PLANNED_ROUTES: { path: string; screen: string; phase: number }[] = [
  { path: '/presets', screen: 'PresetsScreen', phase: 5 },
];

/** Every sidebar destination, for the navigation tests and the command palette. */
export const NAV_PATHS = [
  '/',
  '/invoices',
  '/quotes',
  '/clients',
  '/items',
  '/time',
  '/expenses',
  '/projects',
  '/retainers',
  '/recurring',
  '/reminders',
  '/rules',
  '/automation-log',
  '/reports',
  '/bank-import',
  '/templates',
  '/settings',
] as const;
