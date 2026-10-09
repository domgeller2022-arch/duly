/**
 * The template studio.
 *
 * One scrollable form is enough: the template is a seeded record, and the
 * fields are the styling knobs the plan lists. The live preview lives in its
 * own component so this file stays a form rather than a render loop.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Download, Save, Upload } from 'lucide-react';
import type { DesignTemplate } from '@/core/schemas';
import {
  designTemplateSchema,
  LAYOUT_KEYS,
  FONT_STACK_LIST,
  COLUMN_KEYS,
  EN_LABELS,
  type ColumnKey,
  type LabelSet,
} from '@/core/schemas/template';
import { useAppStore } from '@/state/app';
import { Alert, Button, Card, Checkbox, Field, Select, TextInput, useToast } from '@/ui/components/base';
import { PageHeader } from '@/ui/components/layout';
import { newEntity } from '@/core/schemas/common';
import { TemplatePreview } from './TemplatePreview';

export function TemplateStudioScreen() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const templates = useAppStore((s) => s.designTemplates);
  const saveDesignTemplate = useAppStore((s) => s.saveDesignTemplate);

  const existing = useMemo(() => templates.find((t) => t.id === templateId) ?? null, [templates, templateId]);
  const [draft, setDraft] = useState<DesignTemplate | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (existing) setDraft(existing);
  }, [existing]);

  if (!existing) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <Alert tone="warning" title="Template not found">
          It may have been deleted on another device.
        </Alert>
        <Button className="mt-3" size="sm" onClick={() => navigate('/templates')}>
          <ArrowLeft className="size-3.5" aria-hidden /> Back to templates
        </Button>
      </div>
    );
  }

  if (!draft) return null;

  const patch = (changes: Partial<DesignTemplate>) => setDraft({ ...draft, ...changes });
  const patchColours = (changes: Partial<DesignTemplate['colours']>) =>
    setDraft({ ...draft, colours: { ...draft.colours, ...changes } });
  const patchFonts = (changes: Partial<DesignTemplate['fonts']>) =>
    setDraft({ ...draft, fonts: { ...draft.fonts, ...changes } });
  const patchHeader = (changes: Partial<DesignTemplate['header']>) =>
    setDraft({ ...draft, header: { ...draft.header, ...changes } });
  const patchFooter = (changes: Partial<DesignTemplate['footer']>) =>
    setDraft({ ...draft, footer: { ...draft.footer, ...changes } });
  const patchExtras = (changes: Partial<DesignTemplate['extras']>) =>
    setDraft({ ...draft, extras: { ...draft.extras, ...changes } });
  const patchPage = (changes: Partial<DesignTemplate['page']>) =>
    setDraft({ ...draft, page: { ...draft.page, ...changes } });
  const patchColumns = (cols: ColumnKey[]) => setDraft({ ...draft, columns: cols });
  const patchLabels = (labels: Partial<LabelSet>) =>
    setDraft({ ...draft, labels: { ...draft.labels, ...labels } });

  const save = async () => {
    try {
      const parsed = designTemplateSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
      await saveDesignTemplate(parsed as DesignTemplate);
      push({ tone: 'success', title: 'Template saved' });
    } catch (error) {
      push({
        tone: 'error',
        title: 'Could not save',
        description: error instanceof Error ? error.message : '',
      });
    }
  };

  const duplicate = async () => {
    const now = new Date().toISOString();
    const copy = designTemplateSchema.parse({
      ...draft,
      id: newEntity({}).id,
      createdAt: now,
      updatedAt: now,
      name: `${draft.name} (copy)`,
      builtin: false,
    });
    await saveDesignTemplate(copy as DesignTemplate);
    navigate(`/templates/${copy.id}`);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.name.replace(/\s+/g, '-').toLowerCase()}.dulytemplate.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const parsed = designTemplateSchema.parse({
          ...json,
          builtin: false,
          updatedAt: new Date().toISOString(),
        });
        await saveDesignTemplate(parsed as DesignTemplate);
        push({ tone: 'success', title: 'Template imported' });
        navigate(`/templates/${parsed.id}`);
      } catch (error) {
        push({
          tone: 'error',
          title: 'Import failed',
          description: error instanceof Error ? error.message : 'Invalid template file',
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={existing.builtin ? `${draft.name} (built-in)` : draft.name}
        subtitle="Colours, fonts, layout, and what appears on the page."
        actions={
          <>
            <input
              type="file"
              accept=".json,.dulytemplate.json"
              onChange={(e) => e.target.files?.[0] && handleImport(e.target.files[0])}
              className="hidden"
              ref={importRef}
            />
            <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" aria-hidden />} onClick={() => importRef.current?.click()}>
              Import
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Copy className="size-3.5" aria-hidden />}
              onClick={() => void duplicate()}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="size-3.5" aria-hidden />}
              onClick={download}
            >
              Export
            </Button>
            <Button size="sm" icon={<Save className="size-3.5" aria-hidden />} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      />

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-4">
          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Details</h2>
            <Field label="Name">
              <TextInput value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Layout">
              <Select
                value={draft.layout}
                onChange={(e) => patch({ layout: e.target.value as DesignTemplate['layout'] })}
              >
                {LAYOUT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Colours</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['primary', 'accent', 'text', 'muted', 'rule', 'tableHeadFill'] as const).map((k) => (
                <Field key={k} label={k.replace(/([A-Z])/g, ' $1').toLowerCase()}>
                  <input
                    type="color"
                    value={draft.colours[k]}
                    onChange={(e) => patchColours({ [k]: e.target.value })}
                    className="h-8 w-full cursor-pointer rounded-[6px] border border-rule bg-transparent"
                  />
                </Field>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Typography</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['heading', 'body', 'signature'] as const).map((k) => (
                <Field key={k} label={k}>
                  <Select
                    value={draft.fonts[k]}
                    onChange={(e) => patchFonts({ [k]: e.target.value as DesignTemplate['fonts'][typeof k] })}
                  >
                    {FONT_STACK_LIST.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
              <Field label="Base size (pt)">
                <TextInput
                  value={String(draft.fonts.baseSize)}
                  onChange={(e) => patchFonts({ baseSize: Number(e.target.value) || 9.5 })}
                />
              </Field>
              <Field label="Heading scale">
                <TextInput
                  value={String(draft.fonts.headingScale)}
                  onChange={(e) => patchFonts({ headingScale: Number(e.target.value) || 1 })}
                />
              </Field>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Table columns</h2>
            <div className="flex flex-wrap gap-4">
              {COLUMN_KEYS.map((key) => {
                const on = draft.columns.includes(key);
                return (
                  <Checkbox
                    key={key}
                    checked={on}
                    label={EN_LABELS[key as keyof LabelSet] ?? key}
                    disabled={on && draft.columns.length === 1}
                    onChange={(v) =>
                      patchColumns(v ? [...draft.columns, key] : draft.columns.filter((c) => c !== key))
                    }
                  />
                );
              })}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Labels</h2>
            <p className="mb-3 text-[13px] text-muted">
              Rename any printed label — this is how a second language set works.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(EN_LABELS) as (keyof LabelSet)[]).map((key) => (
                <Field key={key} label={key}>
                  <TextInput
                    value={draft.labels[key] ?? EN_LABELS[key]}
                    placeholder={EN_LABELS[key]}
                    onChange={(e) => patchLabels({ [key]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Header & footer</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Header mode">
                <Select
                  value={draft.header.mode}
                  onChange={(e) => patchHeader({ mode: e.target.value as DesignTemplate['header']['mode'] })}
                >
                  <option value="designed">Designed</option>
                  <option value="letterhead">Letterhead</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Logo position">
                <Select
                  value={draft.header.logoPosition}
                  onChange={(e) =>
                    patchHeader({ logoPosition: e.target.value as DesignTemplate['header']['logoPosition'] })
                  }
                >
                  <option value="left">Left</option>
                  <option value="centre">Centre</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
              <Field label="Footer mode">
                <Select
                  value={draft.footer.mode}
                  onChange={(e) => patchFooter({ mode: e.target.value as DesignTemplate['footer']['mode'] })}
                >
                  <option value="standard">Standard</option>
                  <option value="letterhead">Letterhead</option>
                  <option value="none">None</option>
                </Select>
              </Field>
              <Field label="Thank-you text">
                <TextInput
                  value={draft.footer.thankYouText}
                  onChange={(e) => patchFooter({ thankYouText: e.target.value })}
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <Checkbox
                checked={draft.footer.showPageNumbers}
                label="Page numbers"
                onChange={(v) => patchFooter({ showPageNumbers: v })}
              />
              <Checkbox
                checked={draft.footer.showThankYou}
                label="Thank-you note"
                onChange={(v) => patchFooter({ showThankYou: v })}
              />
              <Checkbox
                checked={draft.footer.showPaymentDetails}
                label="Payment details"
                onChange={(v) => patchFooter({ showPaymentDetails: v })}
              />
              <Checkbox
                checked={draft.footer.showTerms}
                label="Terms"
                onChange={(v) => patchFooter({ showTerms: v })}
              />
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-medium text-ink">Page & extras</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Size">
                <Select
                  value={draft.page.size}
                  onChange={(e) => patchPage({ size: e.target.value as DesignTemplate['page']['size'] })}
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                  <option value="Legal">Legal</option>
                </Select>
              </Field>
              <Field label="Orientation">
                <Select
                  value={draft.page.orientation}
                  onChange={(e) =>
                    patchPage({ orientation: e.target.value as DesignTemplate['page']['orientation'] })
                  }
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </Select>
              </Field>
              <Field label="Margin (mm)">
                <TextInput
                  value={String(draft.page.marginMm)}
                  onChange={(e) => patchPage({ marginMm: Number(e.target.value) || 15 })}
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <Checkbox
                checked={draft.extras.taxMarkerKey}
                label="Tax marker key"
                onChange={(v) => patchExtras({ taxMarkerKey: v })}
              />
              <Checkbox checked={draft.extras.paymentQr} label="Payment QR" disabled onChange={() => {}} />
              <Checkbox
                checked={draft.extras.photoGrid}
                label="Job photo grid"
                disabled
                onChange={() => {}}
              />
            </div>
          </Card>
        </div>

        <div className="lg:order-last">
          <TemplatePreview templateId={existing.id} />
        </div>
      </div>
    </div>
  );
}
