/**
 * The base component set.
 *
 * Styled with plain Tailwind classes against the design tokens rather than with a
 * component library, so every surface is exactly the "quiet stationery" the
 * design calls for: hairline borders, 8px corners, no heavy shadows, 150ms
 * transitions. Interactive elements carry real ARIA roles and keyboard handling
 * rather than being divs that look clickable.
 *
 * Everything here is dependency-free React, which keeps the offline bundle
 * small and means nothing can phone home.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X } from 'lucide-react';
import { cn } from '../lib/cn';

/* ================================================================== */
/* Button                                                              */
/* ================================================================== */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent border-transparent hover:bg-accent-hover',
  secondary: 'bg-paper-raised text-ink border-rule hover:bg-paper-sunken',
  ghost: 'bg-transparent text-ink-muted border-transparent hover:bg-paper-sunken hover:text-ink',
  quiet: 'bg-paper-sunken text-ink border-transparent hover:bg-rule',
  danger: 'bg-transparent text-overdue border-transparent hover:bg-overdue-soft',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Rendered before the label. */
  icon?: ReactNode;
  iconAfter?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  iconAfter,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[8px] border font-medium',
        'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
        'disabled:pointer-events-none disabled:opacity-45',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin-slow" aria-hidden /> : icon}
      {children}
      {iconAfter}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[6px] border border-transparent',
        'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
        'disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'size-7' : size === 'lg' ? 'size-11' : 'size-9',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ================================================================== */
/* Field wrapper                                                       */
/* ================================================================== */

/**
 * The id the enclosing `Field` offers to its control.
 *
 * `Field` renders a real `<label htmlFor>`, but a `<label>` points at nothing
 * unless the control inside it carries the matching id — and threading an id through
 * every call site is exactly the thing that gets forgotten once, after which every
 * field in the app is an unlabelled control to a screen reader. So the field
 * publishes its id and the inputs take it when they have none of their own.
 */
const FieldIdContext = createContext<string | undefined>(undefined);

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  /** Laid out side by side, for a compact settings row. */
  inline?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, required, htmlFor, className, inline, children }: FieldProps) {
  const generated = useId();
  const id = htmlFor ?? generated;

  return (
    <FieldIdContext.Provider value={id}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label !== undefined && (
          <label htmlFor={id} className={cn('text-[13px] font-medium text-ink', inline && 'shrink-0')}>
            {label}
            {required && (
              <span className="ml-0.5 text-overdue" aria-hidden>
                *
              </span>
            )}
          </label>
        )}
        {children}
        {error ? (
          <p className="flex items-start gap-1 text-[12px] text-overdue" role="alert">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{error}</span>
          </p>
        ) : hint ? (
          <p className="text-[12px] text-ink-muted">{hint}</p>
        ) : null}
      </div>
    </FieldIdContext.Provider>
  );
}

/** The id from the enclosing `Field`, for a control that was given none. */
function useFieldId(own?: string): string | undefined {
  const fromField = useContext(FieldIdContext);
  return own ?? fromField;
}

/* ================================================================== */
/* Text input                                                          */
/* ================================================================== */

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  /** Rendered inside the field, on the left. */
  addonBefore?: ReactNode;
  addonAfter?: ReactNode;
  inputSize?: 'sm' | 'md' | 'lg';
  monospace?: boolean;
}

export function TextInput({
  invalid,
  addonBefore,
  addonAfter,
  inputSize = 'md',
  monospace,
  className,
  id,
  ...rest
}: TextInputProps) {
  const input = (
    <input
      id={useFieldId(id)}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-[8px] border bg-paper-raised px-3 text-ink placeholder:text-ink-faint',
        'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
        'focus:outline-none focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        inputSize === 'sm' ? 'h-7 text-[12px] px-2' : inputSize === 'lg' ? 'h-11 text-sm' : 'h-9 text-[13px]',
        invalid ? 'border-overdue' : 'border-rule hover:border-rule-strong focus:border-accent',
        monospace && 'font-mono',
        className,
      )}
      {...rest}
    />
  );

  if (!addonBefore && !addonAfter) return input;

  return (
    <div
      className={cn(
        'flex items-stretch overflow-hidden rounded-[8px] border bg-paper-raised',
        invalid ? 'border-overdue' : 'border-rule',
        addonBefore || addonAfter ? 'focus-within:ring-accent focus-within:border-accent' : '',
      )}
    >
      {addonBefore && (
        <span className="flex shrink-0 items-center border-r bg-paper-sunken px-2.5 text-[12px] text-ink-muted">
          {addonBefore}
        </span>
      )}
      {input}
      {addonAfter && (
        <span className="flex shrink-0 items-center border-l bg-paper-sunken px-2.5 text-[12px] text-ink-muted">
          {addonAfter}
        </span>
      )}
    </div>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  monospace?: boolean;
}

export function TextArea({ invalid, monospace, className, rows = 3, id, ...rest }: TextAreaProps) {
  return (
    <textarea
      id={useFieldId(id)}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full resize-y rounded-[8px] border bg-paper-raised px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint',
        'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
        'focus:outline-none focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-55',
        invalid ? 'border-overdue' : 'border-rule hover:border-rule-strong focus:border-accent',
        monospace && 'font-mono',
        className,
      )}
      {...rest}
    />
  );
}

/* ================================================================== */
/* Currency and number input                                           */
/* ================================================================== */

export interface CurrencyInputProps {
  /** Value in minor units. */
  value: number;
  onChange: (minor: number) => void;
  currency: string;
  /** Overrides the currency's own symbol. */
  symbol?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  inputSize?: 'sm' | 'md' | 'lg';
  /** Allow a minus sign, for credit notes and adjustments. */
  allowNegative?: boolean;
}

/**
 * A money field.
 *
 * The value is always an integer count of minor units — no floating point ever
 * reaches storage. While the user is typing, the raw string is kept as local
 * state so `$1,2` is not rewritten under their cursor; the parsed value is
 * reported upward on every change.
 */
export function CurrencyInput({
  value,
  onChange,
  currency,
  symbol,
  className,
  id,
  disabled,
  invalid,
  autoFocus,
  ariaLabel,
  placeholder,
  inputSize = 'md',
  allowNegative,
}: CurrencyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const { decimals, symbol: defaultSymbol } = currencyMeta(currency);
  const shown = symbol ?? defaultSymbol;

  const text =
    draft ??
    (value === 0
      ? ''
      : new Intl.NumberFormat('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: decimals }).format(
          value / Math.pow(10, decimals),
        ));

  return (
    <TextInput
      id={useFieldId(id)}
      inputMode="decimal"
      autoFocus={autoFocus}
      disabled={disabled}
      invalid={invalid}
      aria-label={ariaLabel}
      inputSize={inputSize}
      placeholder={placeholder ?? '0.00'}
      addonBefore={shown || undefined}
      className={cn('num text-right font-mono', className)}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const cleaned = allowNegative ? raw : raw.replace(/-/g, '');
        onChange(parseCurrencyInput(cleaned, currency));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export interface NumberInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  step?: string;
  min?: string;
  max?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Right-align, which is what a quantity or rate column wants. */
  align?: 'left' | 'right';
}

/** A plain numeric field. Quantities live as decimal strings, never as floats. */
export function NumberInput({
  value,
  onChange,
  className,
  step = 'any',
  min,
  max,
  id,
  disabled,
  placeholder,
  ariaLabel,
  align = 'right',
}: NumberInputProps) {
  return (
    <TextInput
      id={id}
      type="text"
      inputMode="decimal"
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(align === 'right' && 'num font-mono text-right', className)}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
    />
  );
}

function currencyMeta(code: string): { decimals: number; symbol: string } {
  const known: Record<string, { decimals: number; symbol: string }> = {
    AUD: { decimals: 2, symbol: '$' },
    NZD: { decimals: 2, symbol: '$' },
    USD: { decimals: 2, symbol: '$' },
    CAD: { decimals: 2, symbol: '$' },
    SGD: { decimals: 2, symbol: '$' },
    HKD: { decimals: 2, symbol: '$' },
    EUR: { decimals: 2, symbol: '€' },
    GBP: { decimals: 2, symbol: '£' },
    JPY: { decimals: 0, symbol: '¥' },
    KRW: { decimals: 0, symbol: '₩' },
    VND: { decimals: 0, symbol: '₫' },
    KWD: { decimals: 3, symbol: 'د.ك' },
    BHD: { decimals: 3, symbol: '.د.ب' },
    INR: { decimals: 2, symbol: '₹' },
  };
  return known[code] ?? { decimals: 2, symbol: code };
}

/** Parse what a person typed into minor units. Tolerant of partial input. */
export function parseCurrencyInput(raw: string, currency: string): number {
  const { decimals } = currencyMeta(currency);
  const factor = Math.pow(10, decimals);
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalised = cleaned;
  if (lastDot >= 0 && lastComma >= 0) {
    normalised =
      lastDot > lastComma ? cleaned.replace(/,/g, '') : cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    const tail = cleaned.length - lastComma - 1;
    normalised = tail === 3 ? cleaned.replace(/,/g, '') : cleaned.replace(',', '.');
  }
  normalised = normalised.replace(/(\.)(?=[^.]*\.)/g, '');

  const n = Number(normalised);
  if (!Number.isFinite(n)) return 0;
  // Half away from zero, matching the calculation engine exactly.
  return Math.sign(n) * Math.round(Math.abs(n) * factor);
}

/* ================================================================== */
/* Select                                                              */
/* ================================================================== */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  inputSize?: 'sm' | 'md' | 'lg';
  /** Hide the chevron, for a select inside a table cell. */
  plain?: boolean;
}

export function Select({ invalid, inputSize = 'md', plain, className, children, id, ...rest }: SelectProps) {
  return (
    <div className={cn('relative', plain && 'after:hidden')}>
      <select
        id={useFieldId(id)}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full appearance-none rounded-[8px] border bg-paper-raised pl-3 pr-8 text-ink',
          'transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
          'focus:outline-none focus-visible:ring-accent',
          'disabled:cursor-not-allowed disabled:opacity-55',
          inputSize === 'sm'
            ? 'h-7 text-[12px] pl-2'
            : inputSize === 'lg'
              ? 'h-11 text-sm'
              : 'h-9 text-[13px]',
          invalid ? 'border-overdue' : 'border-rule hover:border-rule-strong focus:border-accent',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
        aria-hidden
      />
    </div>
  );
}

/* ================================================================== */
/* Currency select                                                     */
/* ================================================================== */

export interface CurrencySelectProps {
  value: string;
  onChange: (code: string) => void;
  options: { code: string; name: string }[];
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

/**
 * A currency picker.
 *
 * A plain select with the code first, because that is what appears on an
 * invoice and what people scan for: `AUD — Australian Dollar`.
 */
export function CurrencySelect({
  value,
  onChange,
  options,
  disabled,
  className,
  id,
  ariaLabel,
}: CurrencySelectProps) {
  return (
    <Select
      id={id}
      disabled={disabled}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.code} — {option.name}
        </option>
      ))}
    </Select>
  );
}

/* ================================================================== */
/* Checkbox and switch                                                 */
/* ================================================================== */

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Pass an empty label for a table cell and give `ariaLabel` instead. */
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Required when the visible label is empty, so the control is still named. */
  ariaLabel?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
  id,
  ariaLabel,
}: CheckboxProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      {/*
        A filled box with a real tick. The tick used to be a data-URI background
        in an arbitrary Tailwind class: Tailwind never compiled it, and
        tailwind-merge treated it as a background colour and dropped
        `checked:bg-accent` — so a checked box only changed its border colour.
        The tick is now an icon over the input, in the on-accent colour.
      */}
      <span className="relative mt-0.5 inline-flex size-4 shrink-0">
        <input
          id={inputId}
          type="checkbox"
          aria-label={label === '' ? ariaLabel : undefined}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            'peer size-4 cursor-pointer appearance-none rounded-[4px] border border-rule-strong bg-paper-raised',
            'transition-colors duration-150 checked:border-accent checked:bg-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3 text-on-accent opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
        />
      </span>
      <label htmlFor={inputId} className="cursor-pointer select-none text-[13px] leading-snug text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-[12px] text-ink-muted">{hint}</span>}
      </label>
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label. Pass an empty label in a table cell and give `ariaLabel` instead. */
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Required when the visible label is empty, so the control is still named. */
  ariaLabel?: string;
}

export function Switch({ checked, onChange, label, hint, disabled, className, id, ariaLabel }: SwitchProps) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <label htmlFor={inputId} className="cursor-pointer text-[13px] font-medium text-ink">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[12px] leading-snug text-ink-muted">{hint}</p>}
      </div>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-rule-strong',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0 size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/* ================================================================== */
/* Chips, badges and status                                            */
/* ================================================================== */

export type Tone = 'neutral' | 'accent' | 'paid' | 'due' | 'overdue' | 'muted';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-neutral',
  accent: 'bg-accent-soft text-accent',
  paid: 'bg-paid-soft text-paid',
  due: 'bg-due-soft text-due',
  overdue: 'bg-overdue-soft text-overdue',
  muted: 'bg-paper-sunken text-ink-muted',
};

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: ReactNode;
  onClick?: () => void;
  title?: string;
}

export function Chip({ children, tone = 'neutral', className, icon, onClick, title }: ChipProps) {
  const content = (
    <>
      {icon}
      {children}
    </>
  );
  const classes = cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
    TONE_CLASSES[tone],
    onClick && 'cursor-pointer transition-opacity hover:opacity-80',
    className,
  );
  return onClick ? (
    <button type="button" className={classes} title={title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={classes} title={title}>
      {content}
    </span>
  );
}

export interface BadgeProps {
  children: ReactNode;
  className?: string;
}

/** A plain count badge, for sidebar and tab counts. */
export function Badge({ children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex min-w-5 items-center justify-center rounded-full bg-paper-sunken px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted tabular-nums',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ================================================================== */
/* Card, section and empty state                                      */
/* ================================================================== */

export interface CardProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}

export function Card({ children, className, as: Tag = 'div' }: CardProps) {
  return <Tag className={cn('sheet p-4', className)}>{children}</Tag>;
}

export interface PanelProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Flush, for a panel whose body is a table. */
  flush?: boolean;
}

export function Panel({ title, description, actions, children, className, flush }: PanelProps) {
  return (
    <section className={cn('sheet overflow-hidden', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-display text-[15px] leading-snug font-semibold text-ink">{title}</h2>
            )}
            {description && <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-4')}>{children}</div>
    </section>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** One line, as the plan asks: a hint, not a paragraph. */
  hint?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, hint, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center', className)}>
      {icon && <div className="mb-1 text-ink-faint">{icon}</div>}
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {hint && <p className="max-w-sm text-[13px] leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ================================================================== */
/* Alert                                                              */
/* ================================================================== */

export interface AlertProps {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const ALERT_TONES = {
  info: { wrap: 'bg-paper-sunken border-rule', icon: <Info className="size-4 text-ink-muted" aria-hidden /> },
  success: {
    wrap: 'bg-paid-soft border-transparent',
    icon: <Check className="size-4 text-paid" aria-hidden />,
  },
  warning: {
    wrap: 'bg-due-soft border-transparent',
    icon: <AlertTriangle className="size-4 text-due" aria-hidden />,
  },
  error: {
    wrap: 'bg-overdue-soft border-transparent',
    icon: <AlertTriangle className="size-4 text-overdue" aria-hidden />,
  },
} as const;

export function Alert({ tone = 'info', title, children, action, onDismiss, className }: AlertProps) {
  const t = ALERT_TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-[8px] border px-3 py-2.5', t.wrap, className)}
    >
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink">
        {title && <p className="font-medium">{title}</p>}
        {children}
      </div>
      {action}
      {onDismiss && (
        <IconButton label="Dismiss" size="sm" onClick={onDismiss}>
          <X className="size-3.5" aria-hidden />
        </IconButton>
      )}
    </div>
  );
}

/* ================================================================== */
/* Dialog                                                             */
/* ================================================================== */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Block closing by clicking outside, for a submit dialog mid-save. */
  persistent?: boolean;
  className?: string;
}

const DIALOG_SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  persistent,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape closes, Tab is trapped inside, and focus moves to the panel on open
  // so a keyboard user is never left behind the overlay.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !persistent) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      previous?.focus?.();
    };
  }, [open, onClose, persistent]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="animate-fade-in fixed inset-0 bg-ink/25 backdrop-blur-[1px]"
        onClick={() => !persistent && onClose()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'sheet animate-scale-in relative z-10 my-auto w-full outline-none',
          DIALOG_SIZES[size],
          className,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base leading-snug font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p>}
          </div>
          <IconButton label="Close" size="sm" onClick={onClose} disabled={persistent}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </header>
        <div className="max-h-[70vh] overflow-y-auto scroll-quiet px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-rule px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Dropdown menu                                                       */
/* ================================================================== */

export interface MenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

/** A click-triggered menu with keyboard support and outside-click dismissal. */
export function Menu({ trigger, children, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          role="menu"
          className={cn(
            'sheet animate-rise absolute top-full z-40 mt-1 min-w-48 p-1',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
}

export function MenuItem({ children, onClick, icon, danger, disabled, shortcut }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] transition-colors',
        'disabled:pointer-events-none disabled:opacity-45',
        danger ? 'text-overdue hover:bg-overdue-soft' : 'text-ink hover:bg-paper-sunken',
      )}
    >
      {icon && <span className="shrink-0 text-ink-faint">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="shrink-0 font-mono text-[10px] text-ink-faint">{shortcut}</kbd>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-rule" role="separator" />;
}

/* ================================================================== */
/* Tabs                                                               */
/* ================================================================== */

export interface TabsProps {
  tabs: { id: string; label: ReactNode; count?: number; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div role="tablist" className={cn('flex items-center gap-1 border-b border-rule', className)}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              selected ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <Badge className={selected ? 'bg-accent-soft text-ink' : undefined}>{tab.count}</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ================================================================== */
/* Progress                                                           */
/* ================================================================== */

export function Progress({
  value,
  max = 100,
  label,
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-paper-sunken', className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-150"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** An indeterminate bar, for a PDF render with no measurable progress. */
export function IndeterminateBar({ label }: { label?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-busy
      className="h-1 w-full overflow-hidden rounded-full bg-paper-sunken"
    >
      <div className="h-full w-1/3 rounded-full bg-accent motion-safe:animate-[duly-slide-in-right_1.2s_ease-in-out_infinite_alternate]" />
    </div>
  );
}

/* ================================================================== */
/* Tooltip                                                            */
/* ================================================================== */

/**
 * A tooltip for the collapsed sidebar and icon-only controls.
 *
 * Positioned with logical CSS so it stays correct in both writing directions.
 * It appears on hover and on keyboard focus, so it is not mouse-only.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
}: {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  const positions: Record<typeof side, string> = {
    top: 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
    bottom: 'top-full left-1/2 mt-1.5 -translate-x-1/2',
    left: 'right-full top-1/2 mr-1.5 -translate-y-1/2',
    right: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
  };

  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 rounded-[6px] bg-ink px-2 py-1 text-[11px] font-medium whitespace-nowrap text-paper opacity-0 shadow-overlay',
          'opacity-0 transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          positions[side],
        )}
      >
        {label}
      </span>
    </span>
  );
}

/* ================================================================== */
/* Table primitives                                                   */
/* ================================================================== */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto scroll-quiet">
      <table className={cn('w-full border-collapse text-[13px]', className)}>{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
  className,
  width,
  ...rest
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  width?: string;
} & React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'border-b border-rule px-3 py-2 text-[11px] font-semibold tracking-[0.06em] text-ink-faint uppercase',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  className,
  numeric,
  ...rest
}: {
  children?: ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  numeric?: boolean;
} & React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'border-b border-rule px-3 py-2 align-middle text-ink',
        align === 'right' || numeric ? 'num' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}

/* ================================================================== */
/* Separator and layout helpers                                       */
/* ================================================================== */

export function Divider({
  className,
  orientation = 'horizontal',
}: {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  return orientation === 'horizontal' ? (
    <div className={cn('h-px bg-rule', className)} />
  ) : (
    <div className={cn('w-px bg-rule', className)} />
  );
}

export function Stack({
  children,
  className,
  gap = 4,
  direction = 'vertical',
}: {
  children: ReactNode;
  className?: string;
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  direction?: 'vertical' | 'horizontal';
}) {
  return (
    <div
      className={cn(
        direction === 'vertical' ? 'flex flex-col' : 'flex flex-row items-center',
        gap === 1
          ? 'gap-1'
          : gap === 2
            ? 'gap-2'
            : gap === 3
              ? 'gap-3'
              : gap === 6
                ? 'gap-6'
                : gap === 8
                  ? 'gap-8'
                  : 'gap-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Row({
  children,
  className,
  gap = 2,
}: {
  children: ReactNode;
  className?: string;
  gap?: 1 | 2 | 3 | 4;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center',
        gap === 1 ? 'gap-1' : gap === 3 ? 'gap-3' : gap === 4 ? 'gap-4' : 'gap-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ================================================================== */
/* Key-value list, used across detail screens                         */
/* ================================================================== */

export function KeyValue({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; numeric?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]', className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className={cn('text-ink', item.numeric && 'num')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ================================================================== */
/* Confirm dialog                                                     */
/* ================================================================== */

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      persistent={loading}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed text-ink-muted">{body ?? 'Are you sure?'}</div>
    </Dialog>
  );
}

/* ================================================================== */
/* Toast                                                             */
/* ================================================================== */

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  /** Optional single action, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toasts: ToastMessage[];
  push: (toast: Omit<ToastMessage, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push: (toast) => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
        // Errors stay until dismissed; successes fade.
        if (toast.tone !== 'error') {
          window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
        }
        return id;
      },
      dismiss: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    }),
    [toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside a ToastProvider');
  return ctx;
}

function ToastViewport() {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'sheet animate-rise pointer-events-auto flex items-start gap-2.5 p-3',
            ALERT_TONES[
              toast.tone === 'success'
                ? 'success'
                : toast.tone === 'warning'
                  ? 'warning'
                  : toast.tone === 'error'
                    ? 'error'
                    : 'info'
            ].wrap,
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">{toast.description}</p>
            )}
          </div>
          {toast.action && (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                toast.action?.onClick();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </Button>
          )}
          <IconButton label="Dismiss" size="sm" onClick={() => dismiss(toast.id)}>
            <X className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Responsive helper                                                  */
/* ================================================================== */

/** True when the viewport is below the given Tailwind breakpoint. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const useIsNarrow = () => useMediaQuery('(max-width: 900px)');
