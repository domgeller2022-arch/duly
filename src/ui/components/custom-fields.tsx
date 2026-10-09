/**
 * Custom-field inputs.
 *
 * Clients, items and documents all carry user-defined fields, and each of those
 * editors should show the same control for the same field. One definition, three
 * call sites — otherwise "Priority" behaves one way on a client and another on an
 * invoice, which is exactly the sort of drift a shared component prevents.
 *
 * Values are plain strings, because that is what every record stores: a dropdown
 * value, a date and a number are all just what the user typed, and the field
 * definition is what gives them meaning.
 */

import { Checkbox, Field, Select, TextInput } from './base';
import { cn } from '../lib/cn';

export interface CustomFieldInputSpec {
  key: string;
  name: string;
  type: string;
  options: string[];
  required?: boolean;
}

export function CustomFieldInputs({
  fields,
  values,
  disabled,
  onChange,
  className,
}: {
  fields: readonly CustomFieldInputSpec[];
  values: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
  className?: string;
}) {
  if (fields.length === 0) return null;

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 border-t border-rule pt-3 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {fields.map((field) => (
        <Field key={field.key} label={field.name} required={field.required}>
          {field.type === 'select' || field.type === 'multiselect' ? (
            <Select
              value={values[field.key] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            >
              <option value="">—</option>
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : field.type === 'date' ? (
            <TextInput
              type="date"
              value={values[field.key] ?? ''}
              disabled={disabled}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          ) : field.type === 'checkbox' ? (
            <Checkbox
              checked={values[field.key] === 'true'}
              disabled={disabled}
              onChange={(checked: boolean) => onChange(field.key, String(checked))}
              label="Yes"
            />
          ) : (
            <TextInput
              value={values[field.key] ?? ''}
              disabled={disabled}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              onChange={(e) => onChange(field.key, e.target.value)}
            />
          )}
        </Field>
      ))}
    </div>
  );
}
