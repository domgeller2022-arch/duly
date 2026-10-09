/**
 * Appearance.
 *
 * The accent here is the app's own interface colour. A business's brand colour is
 * set on the business, and applies to its documents only — the plan is explicit
 * that "only the app interface stays teal", and mixing the two would mean editing
 * one business's colours changed how the whole app looks.
 */

import { useAppStore } from '@/state/app';
import { Card, Field, Select, Switch, TextInput } from '@/ui/components/base';
import { shade } from '@/ui/hooks/usePreferences';

const PRESET_ACCENTS = ['#1F5E5B', '#23395B', '#3F4A3C', '#5B2339', '#4A3728', '#2F3B4A'];

export function AppearanceSection() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);

  if (!settings) return null;
  const set = (changes: Partial<typeof settings>) => void saveSettings({ ...settings, ...changes });

  const accentValid = /^#[0-9a-f]{6}$/i.test(settings.appAccent);

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="eyebrow">Theme</h3>
        <div className="mt-2 max-w-xs">
          <Field label="Appearance" hint="“System” follows your operating system's setting as it changes">
            <Select value={settings.theme} onChange={(e) => set({ theme: e.target.value as 'system' })}>
              <option value="system">Match my system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Select>
          </Field>
        </div>

        <div className="mt-3 max-w-xs">
          <Field label="Density" hint="Compact fits more line items on screen, which helps on long invoices">
            <Select value={settings.density} onChange={(e) => set({ density: e.target.value as 'compact' })}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="eyebrow">Accent colour</h3>
        <p className="-mt-1 mb-3 text-[12px] text-ink-muted">
          The colour of buttons, links and highlights. Your business's own brand colour is set on the business
          and appears on its documents.
        </p>

        <div className="flex flex-wrap gap-2">
          {PRESET_ACCENTS.map((colour) => (
            <button
              key={colour}
              type="button"
              title={`Use ${colour}`}
              onClick={() => set({ appAccent: colour })}
              className={[
                'size-8 rounded-[8px] border-2 transition-transform',
                settings.appAccent === colour ? 'border-ink' : 'border-rule hover:scale-105',
              ].join(' ')}
              style={{ background: colour }}
            >
              <span className="sr-only">Use {colour}</span>
            </button>
          ))}
        </div>

        <div className="mt-3 max-w-xs">
          <Field label="Custom colour" error={accentValid ? undefined : 'Enter a hex colour, e.g. #1F5E5B'}>
            <TextInput
              value={settings.appAccent}
              invalid={!accentValid}
              monospace
              addonBefore={
                <input
                  type="color"
                  aria-label="Accent colour picker"
                  value={accentValid ? settings.appAccent : '#1F5E5B'}
                  onChange={(e) => set({ appAccent: e.target.value.toUpperCase() })}
                  className="size-4 cursor-pointer border-0 bg-transparent p-0"
                />
              }
              onChange={(e) => set({ appAccent: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>

        {accentValid && (
          <p className="mt-3 text-[12px] text-ink-muted">
            Hover state: <span className="font-mono">{shade(settings.appAccent, -0.12)}</span>
          </p>
        )}
      </Card>

      <Card>
        <h3 className="eyebrow">Sidebar</h3>
        <Switch
          checked={settings.sidebarCollapsed}
          label="Collapse the sidebar to icons"
          onChange={(sidebarCollapsed) => set({ sidebarCollapsed })}
        />
      </Card>
    </div>
  );
}
