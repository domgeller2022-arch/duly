/**
 * Numbering.
 *
 * One pattern and one reset rule per document type per business. The plan requires
 * that numbers are "reserved inside a database transaction so two invoices can
 * never share a number" and are "never reused" — that guarantee lives in the
 * storage adapter, and this screen only chooses the shape. It shows the next number
 * that would be issued so a pattern is never a guess.
 *
 * A pattern with no counter at all (`INV-{YYYY}`) is refused: every invoice issued
 * in the same year would get the same number, which is the one bug an accounting
 * package cannot have.
 */

import { useEffect } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { DOCUMENT_TYPES } from '@/core/schemas';
import { NUMBER_TOKENS, hasCounter } from '@/core/engines/numbering';
import { documentTypeLabel } from '@/core/engines/numbering';
import type { ResetRule } from '@/core/schemas/automation';
import { useAppStore } from '@/state/app';
import { Alert, Card, Chip, Panel, Select, Table, Td, TextInput, Th } from '@/ui/components/base';
import { ensureNumberSequences, previewFor, sequenceFor } from '../numbering';

const RESET_OPTIONS: { id: ResetRule; label: string; hint: string }[] = [
  { id: 'yearly', label: 'Every calendar year', hint: 'INV-2026-0001, then INV-2027-0001' },
  { id: 'financial_year', label: 'Every financial year', hint: 'Restarts on 1 July, the Australian year' },
  {
    id: 'never',
    label: 'Never reset',
    hint: 'One counter forever, which is why credit notes never reuse a number',
  },
];

export function NumberingSection() {
  const profiles = useAppStore((s) => s.profiles);
  const activeProfileId = useAppStore((s) => s.activeProfileId);
  const numberSequences = useAppStore((s) => s.numberSequences);
  const today = useAppStore((s) => s.today);
  const settings = useAppStore((s) => s.settings);
  const saveNumberSequence = useAppStore((s) => s.saveNumberSequence);

  const profile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  // Create the rows on first visit so every type has something to edit and preview.
  useEffect(() => {
    if (profile) void ensureNumberSequences(profile.id, today, 'yearly');
  }, [profile, today]);

  if (!profile) {
    return (
      <Alert tone="info" title="No business yet">
        Numbering belongs to a business, so add one first.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Document numbers"
        description={`For ${profile.name}. The preview is the next number that would be issued.`}
        flush
      >
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Pattern</Th>
              <Th>Resets</Th>
              <Th align="right">Next number</Th>
              <Th align="right">Issued</Th>
            </tr>
          </thead>
          <tbody>
            {DOCUMENT_TYPES.map((documentType) => {
              const sequence = sequenceFor(numberSequences, profile.id, documentType, today);
              const preview = previewFor(
                sequence,
                today,
                documentType,
                settings?.financialYearStartMonth ?? 7,
              );
              const valid = hasCounter(sequence.pattern);

              return (
                <tr key={documentType}>
                  <Td>
                    <span className="font-medium">{documentTypeLabel(documentType)}</span>
                  </Td>
                  <Td>
                    <TextInput
                      inputSize="sm"
                      monospace
                      invalid={!valid}
                      value={sequence.pattern}
                      aria-label={`Number pattern for ${documentTypeLabel(documentType)}`}
                      onChange={(e) => void saveNumberSequence({ ...sequence, pattern: e.target.value })}
                    />
                    {!valid && (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-overdue">
                        <AlertTriangle className="size-3" aria-hidden />
                        Needs a {'{####}'} counter, or every document this year gets the same number.
                      </p>
                    )}
                  </Td>
                  <Td>
                    <Select
                      plain
                      inputSize="sm"
                      aria-label={`Reset rule for ${documentTypeLabel(documentType)}`}
                      value={sequence.resetRule}
                      onChange={(e) =>
                        void saveNumberSequence({ ...sequence, resetRule: e.target.value as ResetRule })
                      }
                    >
                      {RESET_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td align="right">
                    <span className="num font-mono text-[12px] text-ink">{preview}</span>
                  </Td>
                  <Td align="right">
                    {sequence.issued.length > 0 ? (
                      <Chip tone="muted">
                        <Lock className="size-3" aria-hidden />
                        {sequence.issued.length}
                      </Chip>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <Card>
        <h3 className="eyebrow">Tokens</h3>
        <p className="-mt-1 mb-3 text-[12px] text-ink-muted">
          Anything a pattern can contain. An unknown token is left visible rather than blanked, so a typo
          shows up on the document instead of silently deleting part of a number.
        </p>
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {NUMBER_TOKENS.map((token) => (
            <li key={token.token} className="flex items-baseline gap-2">
              <code className="shrink-0 rounded-[4px] bg-paper-sunken px-1.5 py-0.5 font-mono text-[11px] text-accent">
                {token.token}
              </code>
              <span className="text-[12px] text-ink-muted">{token.description}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h3 className="eyebrow">Why numbers are never reused</h3>
        <p className="-mt-1 text-[12px] leading-relaxed text-ink-muted">
          A number is reserved inside a database transaction when a document is submitted, so two invoices
          saved in the same moment cannot be handed the same number. Every issued number is also written to a
          permanent list, which means a reset rule that rolls the counter back still cannot repeat a number
          that has already gone out. The count in the table above is that list.
        </p>
      </Card>
    </div>
  );
}
