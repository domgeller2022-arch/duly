/**
 * The template library.
 *
 * Built-in templates are seeds; a user-made template is a duplicate of one of
 * those, edited in the studio. Keeping the list this small is deliberate: the
 * plan's screen inventory has exactly one row for it, and a catalogue of ten
 * nearly identical templates is more noise than feature.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, FileText, Plus, Star, Trash2, Wand2 } from 'lucide-react';
import { useAppStore } from '@/state/app';
import { Badge, Button, Card, EmptyState, IconButton, Menu, MenuItem } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { newEntity } from '@/core/schemas/common';
import { designTemplateSchema } from '@/core/schemas/template';

export function TemplatesScreen() {
  const navigate = useNavigate();
  const templates = useAppStore((s) => s.designTemplates);
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const saveDesignTemplate = useAppStore((s) => s.saveDesignTemplate);
  const removeDesignTemplate = useAppStore((s) => s.removeDesignTemplate);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const defaultId = activeProfile?.defaultDesignTemplateId;

  const sorted = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);

  const duplicate = async (template: (typeof templates)[number]) => {
    const now = new Date().toISOString();
    const copy = designTemplateSchema.parse({
      ...template,
      id: newEntity({}).id,
      createdAt: now,
      updatedAt: now,
      name: `${template.name} (copy)`,
      builtin: false,
    });
    await saveDesignTemplate(copy);
    navigate(`/templates/${copy.id}`);
  };

  const download = (template: (typeof templates)[number]) => {
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/\s+/g, '-').toLowerCase()}.dulytemplate.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Templates"
        subtitle="How every document looks when it becomes a PDF."
        actions={
          <Button
            size="sm"
            icon={<Plus className="size-3.5" aria-hidden />}
            onClick={() => void duplicate(sorted[0])}
          >
            New from Studio
          </Button>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Wand2 className="size-7" aria-hidden />}
          title="No templates yet"
          hint="Duplicate a built-in to start customising."
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((template) => (
            <Card key={template.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium text-ink">{template.name}</h3>
                  <p className="text-[12px] text-ink-muted capitalize">{template.layout} layout</p>
                </div>
                {template.builtin && <Badge className="bg-paper-sunken">Built-in</Badge>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/templates/${template.id}`}>
                  <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" aria-hidden />}>
                    Edit
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="size-3.5" aria-hidden />}
                  onClick={() => void duplicate(template)}
                >
                  Duplicate
                </Button>
                <IconButton label="Export template" size="sm" onClick={() => download(template)}>
                  <Download className="size-3.5" aria-hidden />
                </IconButton>
                {defaultId === template.id && (
                  <Badge className="bg-accent-soft text-accent">
                    <Star className="size-3" aria-hidden /> Default
                  </Badge>
                )}
                <Menu
                  trigger={
                    <IconButton label="More" size="sm">
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  }
                >
                  {!template.builtin && (
                    <MenuItem danger onClick={() => void removeDesignTemplate(template.id)}>
                      Delete
                    </MenuItem>
                  )}
                </Menu>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
