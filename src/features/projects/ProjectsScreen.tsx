/**
 * Projects.
 *
 * Time and expenses hang off a project, and a project carries the hourly rate
 * that bills unbilled time. The schema is the record; this is the list and the
 * form.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project } from '@/core/schemas/automation';
import { projectSchema } from '@/core/schemas/automation';
import { newEntity } from '@/core/schemas/common';
import { useAppStore, useActiveProfile } from '@/state/app';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CurrencyInput,
  Field,
  Panel,
  Select,
  Table,
  Td,
  TextInput,
  Th,
  useToast,
} from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { money } from '@/ui/lib/format';

const STATUS_LABELS: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

export function ProjectsScreen() {
  const { push } = useToast();
  const profile = useActiveProfile();
  const projects = useAppStore((s) => s.projects);
  const clients = useAppStore((s) => s.clients);
  const timeEntries = useAppStore((s) => s.timeEntries);
  const settings = useAppStore((s) => s.settings);
  const saveProject = useAppStore((s) => s.saveProject);
  const removeProject = useAppStore((s) => s.removeProject);

  const [draft, setDraft] = useState<Project | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const startNew = () => {
    if (!profile) {
      push({ tone: 'warning', title: 'Create a business first' });
      return;
    }
    setDraft(
      projectSchema.parse({
        ...newEntity({}),
        name: 'New project',
      }),
    );
  };

  const save = async () => {
    if (!draft) return;
    try {
      const parsed = projectSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveProject(parsed as Project);
      push({ tone: 'success', title: 'Project saved' });
      setDraft(null);
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const remove = async (id: string) => {
    await removeProject(id);
    if (draft?.id === id) setDraft(null);
    setConfirmId(null);
    push({ tone: 'success', title: 'Project deleted' });
  };

  const hoursFor = (project: Project) =>
    timeEntries
      .filter((e) => e.projectId === project.id)
      .reduce((acc, e) => acc + (Number.parseFloat(e.hours) || 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Projects"
        subtitle="A project carries the hourly rate that bills unbilled time, and a budget when one exists."
        actions={
          <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={startNew}>
            New project
          </Button>
        }
      />

      <Panel className="mt-4" flush>
        {projects.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-ink-muted">No projects yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Client</Th>
                <Th align="right">Rate</Th>
                <Th align="right">Hours tracked</Th>
                <Th align="right">Budget</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const client = clients.find((c) => c.id === project.clientId);
                return (
                  <tr
                    key={project.id}
                    className="cursor-pointer hover:bg-paper-sunken"
                    onClick={() => setDraft(project)}
                  >
                    <Td className="font-medium text-ink">
                      {project.name} {project.code && <Badge>{project.code}</Badge>}
                    </Td>
                    <Td className="text-ink-muted">{client?.displayName ?? '—'}</Td>
                    <Td numeric className="text-ink-muted">
                      {project.hourlyRate > 0
                        ? money(project.hourlyRate, settings?.defaultCurrency ?? 'AUD')
                        : '—'}
                    </Td>
                    <Td numeric>{hoursFor(project).toFixed(2)}</Td>
                    <Td numeric className="text-ink-muted">
                      {project.budget > 0 ? money(project.budget, settings?.defaultCurrency ?? 'AUD') : '—'}
                    </Td>
                    <Td>{STATUS_LABELS[project.status]}</Td>
                    <Td>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-3.5" aria-hidden />}
                        onClick={() => setConfirmId(project.id)}
                      >
                        Delete
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {draft && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 font-medium text-ink">
            {projects.some((p) => p.id === draft.id) ? `Edit ${draft.name}` : 'New project'}
          </h2>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <TextInput
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Code">
                <TextInput
                  value={draft.code}
                  onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  placeholder="WEB"
                />
              </Field>
              <Field label="Client">
                <Select
                  value={draft.clientId ?? ''}
                  onChange={(e) => setDraft({ ...draft, clientId: e.target.value || null })}
                >
                  <option value="">No client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as Project['status'] })}
                >
                  {(Object.keys(STATUS_LABELS) as Project['status'][]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Hourly rate" hint="Bills unbilled time that has no rate override.">
                <CurrencyInput
                  value={draft.hourlyRate}
                  currency={settings?.defaultCurrency ?? 'AUD'}
                  onChange={(minor) => setDraft({ ...draft, hourlyRate: minor })}
                />
              </Field>
              <Field label="Budget" hint="0 means no budget.">
                <CurrencyInput
                  value={draft.budget}
                  currency={settings?.defaultCurrency ?? 'AUD'}
                  onChange={(minor) => setDraft({ ...draft, budget: minor })}
                />
              </Field>
            </div>
            <Field label="Notes">
              <TextInput
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()}>
                Save project
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && void remove(confirmId)}
        title="Delete this project?"
        body="Time entries and expenses keep their project name in their history."
        confirmLabel="Delete"
      />
    </div>
  );
}
