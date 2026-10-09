/**
 * The PDF renderer.
 *
 * `@react-pdf/renderer` lays the document out deterministically, which is what
 * makes "the same document renders the same way twice" true — no reflow between
 * machines, no floating-point drift, no dependence on installed fonts.
 *
 * Three templates, three visual grammars, one set of numbers. Every figure comes
 * from the view model, never from a local calculation, so the preview, the printed
 * page and the exported file cannot disagree.
 *
 * Fonts are bundled, not fetched: a PDF that depends on the network is not an
 * offline-first PDF.
 */

import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { fontStore } from './fonts';
import type { ReactNode } from 'react';
import type { DocumentModel, ModelLine } from './model';
import { formatMoneyFor, stampFor } from './model';
import { PAYMENT_METHOD_LABELS } from '@/core/format/labels';

/* ------------------------------------------------------------------ */
/* Font families                                                       */
/* ------------------------------------------------------------------ */

/**
 * Font registrations.
 *
 * The registry maps a template's font choice onto the files bundled in
 * `public/fonts`. Inter is registered as the fallback for every family so a
 * document never renders in a substituted serif because one file failed to load.
 */
const FONTS = {
  inter: { normal: 'Inter-Regular', bold: 'Inter-Bold', italic: 'Inter-Italic' },
  sourceSerif: { normal: 'SourceSerif4-Regular', bold: 'SourceSerif4-Bold', italic: 'SourceSerif4-Italic' },
  fraunces: { normal: 'Fraunces-Regular', bold: 'Fraunces-Bold', italic: 'Fraunces-Italic' },
  ibmPlexSans: { normal: 'IBMPlexSans-Regular', bold: 'IBMPlexSans-Bold', italic: 'IBMPlexSans-Italic' },
  ibmPlexMono: { normal: 'IBMPlexMono-Regular', bold: 'IBMPlexMono-Bold', italic: 'IBMPlexMono-Italic' },
  lora: { normal: 'Lora-Regular', bold: 'Lora-Bold', italic: 'Lora-Italic' },
} as const;

type FontKey = keyof typeof FONTS;

function familyFor(key: string): FontKey {
  switch (key) {
    case 'source-serif':
      return 'sourceSerif';
    case 'fraunces':
      return 'fraunces';
    case 'ibm-plex-sans':
      return 'ibmPlexSans';
    case 'ibm-plex-mono':
      return 'ibmPlexMono';
    case 'lora':
      return 'lora';
    default:
      return 'inter';
  }
}

export const FONT_REGISTRY = FONTS;

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
};

/**
 * Millimetres to PDF points.
 *
 * The document's margin and logo height are stored in millimetres because that is
 * how print is specified; the renderer works in points.
 */
export function mm(value: number): number {
  return (value * 72) / 25.4;
}

function makeStyles(model: DocumentModel) {
  const body = familyFor(model.fonts.body);
  const heading = familyFor(model.fonts.heading);
  const signature = familyFor(model.fonts.signature);
  const size = model.fonts.baseSize;
  const c = model.colours;
  const pageSize = PAGE_SIZES[model.page.size] ?? PAGE_SIZES.A4;

  const layout =
    model.page.orientation === 'landscape' ? { width: pageSize.height, height: pageSize.width } : pageSize;

  return StyleSheet.create({
    page: {
      ...layout,
      paddingTop: mm(model.page.marginMm),
      paddingBottom: mm(model.page.marginMm + 6),
      paddingHorizontal: mm(model.page.marginMm),
      backgroundColor: '#FFFFFF',
      fontFamily: body,
      fontSize: size,
      color: c.text,
      lineHeight: 1.45,
    },

    /* ---- header ---- */
    accentBand: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: mm(model.header.accentBandHeightMm),
      backgroundColor: c.primary,
    },
    header: {
      flexDirection: model.header.headingAlign === 'right' ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 6,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    headerRight: {
      flexDirection: 'column',
      alignItems: model.header.headingAlign === 'right' ? 'flex-end' : 'flex-start',
    },
    logo: { maxHeight: mm(model.business.logoMaxHeightMm), maxWidth: 160 },
    letterhead: { width: '100%', maxHeight: 90, objectFit: 'cover', marginBottom: 8 },
    businessName: { fontFamily: heading, fontSize: size * 1.7, fontWeight: 700, color: c.text },
    businessDetail: { fontSize: size * 0.92, color: model.colours.muted, lineHeight: 1.4 },
    headingText: {
      fontFamily: heading,
      fontSize: size * 2.5,
      fontWeight: 700,
      color: c.primary,
      letterSpacing: 0.2,
      marginBottom: 2,
    },
    metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4, alignItems: 'flex-start' },
    metaItem: { minWidth: 84 },
    metaLabel: { fontSize: size * 0.82, color: model.colours.muted, letterSpacing: 0.3 },
    metaValue: { fontSize: size * 1.02, fontWeight: 600, color: c.text },

    /* ---- parties ---- */
    parties: { flexDirection: 'row', justifyContent: 'space-between', gap: 20, marginVertical: 8 },
    partyBlock: { flex: 1 },
    partyLabel: {
      fontSize: size * 0.8,
      fontWeight: 700,
      letterSpacing: 0.6,
      color: model.colours.muted,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    partyName: { fontFamily: heading, fontSize: size * 1.15, fontWeight: 600, color: c.text },
    partyLine: { fontSize: size * 0.94, color: model.colours.muted, lineHeight: 1.4 },

    /* ---- table ---- */
    table: { marginTop: 6 },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: c.tableHeadFill,
      borderBottomWidth: 1,
      borderBottomColor: c.rule,
      paddingVertical: 4,
      paddingHorizontal: 3,
    },
    th: { fontSize: size * 0.82, fontWeight: 700, letterSpacing: 0.4, color: c.tableHeadText },
    row: {
      flexDirection: 'row',
      paddingVertical: 3.5,
      paddingHorizontal: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: c.rule,
    },
    rowAlt: { backgroundColor: c.bandFill },
    cell: { fontSize: size, color: c.text },
    cellMuted: { fontSize: size * 0.86, color: model.colours.muted },
    cellRight: { textAlign: 'right', fontSize: size, color: c.text },
    cellNum: { textAlign: 'right', fontSize: size, fontVariant: ['tabular-nums'] },
    description: { flex: 1 },
    descriptionNotes: { fontSize: size * 0.84, color: model.colours.muted, marginTop: 1 },

    sectionRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      backgroundColor: c.bandFill,
      borderTopWidth: 1,
      borderTopColor: c.rule,
      paddingVertical: 4,
      paddingHorizontal: 3,
      marginTop: 4,
    },
    sectionTitle: { fontFamily: heading, fontSize: size * 1.05, fontWeight: 600, color: c.text },

    markerKey: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    markerKeyText: { fontSize: size * 0.82, color: model.colours.muted },

    /* ---- totals ---- */
    totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
    totals: { width: 220 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
    totalLabel: { fontSize: size, color: model.colours.muted },
    totalValue: { fontSize: size, color: c.text, fontVariant: ['tabular-nums'] },
    grandTotalRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
      marginTop: 3,
      borderTopWidth: 1,
      borderTopColor: c.rule,
      ...(c.totalHighlight ? { backgroundColor: c.bandFill } : {}),
    },
    grandTotalLabel: { fontFamily: heading, fontSize: size * 1.15, fontWeight: 700, color: c.text },
    grandTotalValue: {
      fontFamily: heading,
      fontSize: size * 1.25,
      fontWeight: 700,
      color: c.text,
      fontVariant: ['tabular-nums'],
    },
    balanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: 4,
      marginTop: 2,
      borderTopWidth: 1,
      borderTopColor: c.rule,
    },
    balanceLabel: { fontSize: size * 1.02, fontWeight: 600, color: c.text },
    balanceValue: { fontSize: size * 1.08, fontWeight: 700, color: c.primary, fontVariant: ['tabular-nums'] },

    /* ---- notes ---- */
    block: { marginTop: 10 },
    blockTitle: {
      fontSize: size * 0.82,
      fontWeight: 700,
      letterSpacing: 0.5,
      color: model.colours.muted,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    blockText: { fontSize: size * 0.94, color: model.colours.muted, lineHeight: 1.5 },

    paymentDetails: {
      borderWidth: 1,
      borderColor: c.rule,
      borderRadius: 3,
      padding: 6,
      backgroundColor: c.bandFill,
    },
    paymentLine: { fontSize: size * 0.9, color: c.text, lineHeight: 1.5 },
    paymentMethod: { fontSize: size * 0.9, fontWeight: 600, color: c.text, marginBottom: 2 },

    /* ---- stamp ---- */
    stampBox: {
      position: 'absolute',
      top: '38%',
      left: 0,
      right: 0,
      alignItems: 'center',
    },
    stampText: {
      fontFamily: heading,
      fontSize: 52,
      fontWeight: 700,
      letterSpacing: 8,
      color: stampColour(model),
      opacity: 0.14,
      transform: 'rotate(-14deg)',
    },

    /* ---- footer ---- */
    footer: {
      position: 'absolute',
      bottom: mm(12),
      left: mm(model.page.marginMm),
      right: mm(model.page.marginMm),
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      borderTopWidth: 0.5,
      borderTopColor: c.rule,
      paddingTop: 4,
    },
    footerText: { fontSize: size * 0.84, color: model.colours.muted },
    pageNumber: { fontSize: size * 0.84, color: model.colours.muted, fontVariant: ['tabular-nums'] },
    signature: { fontFamily: signature, fontSize: size * 1.8, color: c.text },
  });
}

function stampColour(model: DocumentModel): string {
  const stamp = stampFor(model);
  if (stamp === 'PAID') return '#2E6B4F';
  if (stamp === 'DRAFT') return '#6E6A63';
  return model.stamp.colour;
}

/* ------------------------------------------------------------------ */
/* Column widths                                                       */
/* ------------------------------------------------------------------ */

/**
 * Widths for the line table, as fractions of the content width.
 *
 * A fixed table: the columns never reflow when a description is long, because a
 * column that moves between pages looks like a mistake.
 */
const COLUMN_WIDTHS: Record<string, number> = {
  position: 0.05,
  details: 0.34,
  quantity: 0.09,
  unit: 0.08,
  unitPrice: 0.13,
  discount: 0.08,
  taxCode: 0.11,
  taxAmount: 0.11,
  amount: 0.15,
};

const COLUMN_HEADS: Record<string, (model: DocumentModel) => string> = {
  position: () => '#',
  details: (m) => (m.labels.notes ? 'Description' : 'Description'),
  quantity: (m) => m.labels.quantity,
  unit: (m) => m.labels.unit,
  unitPrice: (m) => m.labels.unitPrice,
  discount: (m) => m.labels.discount,
  taxCode: (m) => m.labels.taxCode,
  taxAmount: (m) => m.labels.taxTotal,
  amount: (m) => m.labels.amount,
};

interface Column {
  key: string;
  align: 'left' | 'right';
  head: string;
  /** Fraction of the content width. */
  width: number;
  render: (line: ModelLine, model: DocumentModel, styles: PdfStyles) => ReactNode;
}

/** The style sheet type, so column renderers can be typed against it. */
type PdfStyles = ReturnType<typeof makeStyles>;

/**
 * Build the table columns.
 *
 * Each renderer closes over the style sheet directly, rather than reaching for a
 * module-level reference, so the styles a cell uses are the ones built for the
 * document actually being rendered.
 */
function buildColumns(model: DocumentModel): Column[] {
  const money = (minor: number) => formatMoneyFor(model, minor);

  const renderers: Record<string, Column['render']> = {
    position: (line, _m, st) => <Text style={st.cellNum}>{line.showInTable ? line.position + 1 : ''}</Text>,
    details: (line, _m, st) => (
      <View style={st.description}>
        <Text>
          {line.description}
          {line.marker ? ` ${line.marker}` : ''}
        </Text>
        {line.notes ? <Text style={st.descriptionNotes}>{line.notes}</Text> : null}
      </View>
    ),
    quantity: (line, _m, st) => (
      <Text style={st.cellNum}>{line.type === 'expense' ? '' : line.quantity}</Text>
    ),
    unit: (line, _m, st) => <Text style={st.cell}>{line.type === 'expense' ? '' : line.unit}</Text>,
    unitPrice: (line, _m, st) => (
      <Text style={st.cellNum}>{line.type === 'expense' ? '' : money(line.unitPriceMinor)}</Text>
    ),
    discount: (line, _m, st) => <Text style={st.cellNum}>{line.discountLabel}</Text>,
    taxCode: (line, _m, st) => <Text style={st.cell}>{line.taxCodeLabel || ''}</Text>,
    taxAmount: (line, _m, st) => <Text style={st.cellNum}>{line.taxMinor ? money(line.taxMinor) : ''}</Text>,
    amount: (line, _m, st) => <Text style={st.cellNum}>{money(line.amountMinor)}</Text>,
  };

  const columns: Column[] = [];
  for (const key of COLUMN_KEYS) {
    if (!model.columns.has(key)) continue;
    const render = renderers[key];
    if (!render) continue;
    columns.push({
      key,
      align: RIGHT_ALIGNED.has(key) ? 'right' : 'left',
      head: COLUMN_HEADS[key]?.(model) ?? key,
      // `details` absorbs whatever the fixed columns leave, so the row always
      // fills the page width exactly.
      width: key === 'details' ? Math.max(0.2, 1 - fixedWidth(model)) : (COLUMN_WIDTHS[key] ?? 0.1),
      render,
    });
  }

  return columns;
}

const COLUMN_KEYS = [
  'position',
  'details',
  'quantity',
  'unit',
  'unitPrice',
  'discount',
  'taxCode',
  'taxAmount',
  'amount',
] as const;

const RIGHT_ALIGNED = new Set(['quantity', 'unitPrice', 'discount', 'taxAmount', 'amount']);

/** The fraction of the width taken by every column except the description. */
function fixedWidth(model: DocumentModel): number {
  let total = 0;
  for (const key of COLUMN_KEYS) {
    if (key === 'details' || !model.columns.has(key)) continue;
    total += COLUMN_WIDTHS[key] ?? 0.1;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export function DocumentPdf({ model }: { model: DocumentModel }) {
  const styles = makeStyles(model);
  const columns = buildColumns(model);
  const stamp = stampFor(model);

  return (
    <Document
      title={`${model.heading} ${model.number || model.draftNumber}`}
      author={model.business.name}
      subject={`${model.heading} for ${model.client?.name ?? 'no client'}`}
      creator="Duly"
      producer="Duly — offline invoicing"
      creationDate={new Date(`${model.issueDate}T00:00:00.000Z`)}
    >
      <Page
        size={model.page.size === 'Letter' ? 'LETTER' : model.page.size === 'Legal' ? 'LEGAL' : 'A4'}
        orientation={model.page.orientation === 'landscape' ? 'landscape' : 'portrait'}
        style={styles.page}
      >
        {/* ---- accent band ---- */}
        {model.header.accentBand && <View style={styles.accentBand} fixed />}

        {/* ---- stamp ---- */}
        {stamp && (
          <View style={styles.stampBox} fixed>
            <Text style={styles.stampText}>{stamp}</Text>
          </View>
        )}

        {/* ---- header ---- */}
        <Header model={model} styles={styles} />

        {/* ---- parties ---- */}
        {model.header.showClientBlock && <Parties model={model} styles={styles} />}

        {/* ---- line table ---- */}
        <LineTable model={model} styles={styles} columns={columns} />

        {/* ---- marker key ---- */}
        {model.markerKey.length > 0 && model.extras.taxMarkerKey && (
          <View style={styles.markerKey}>
            {model.markerKey.map((entry) => (
              <Text key={entry} style={styles.markerKeyText}>
                {entry}
              </Text>
            ))}
          </View>
        )}

        {/* ---- totals ---- */}
        <Totals model={model} styles={styles} />

        {/* ---- notes ---- */}
        {(model.notes || model.showNoGstNote) && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>{model.labels.notes}</Text>
            {model.notes ? <Text style={styles.blockText}>{model.notes}</Text> : null}
            {model.showNoGstNote && !model.notes ? (
              <Text style={styles.blockText}>No GST has been charged.</Text>
            ) : null}
          </View>
        )}

        {/* ---- payments ---- */}
        {model.footer.showTerms && (model.termsText || model.labels.termsAndConditions) && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>{model.labels.termsAndConditions}</Text>
            {model.termsText ? <Text style={styles.blockText}>{model.termsText}</Text> : null}
          </View>
        )}

        {/* ---- payment details ---- */}
        {model.footer.showPaymentDetails && <PaymentDetails model={model} styles={styles} />}

        {/* ---- payment QR, when the template asks for one and we have a QR ---- */}
        {model.extras.paymentQr && model.qrSrc && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Pay by QR</Text>
            <Image src={model.qrSrc} style={{ width: 72, height: 72 }} />
          </View>
        )}

        {/* ---- customer merge fields on the page, when the template asks for them ---- */}
        {model.extras.customFields && Object.keys(model.customFields).length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Extra details</Text>
            {Object.entries(model.customFields).map(([key, value]) => (
              <Text key={key} style={{ fontSize: 9 }}>
                {key}: {value}
              </Text>
            ))}
          </View>
        )}

        {/* ---- job-photo grid, for templates that show the photos on the same page ---- */}
        {model.extras.photoGrid && model.photos.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Photos</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {model.photos.map((photo) => (
                <Image key={photo.id} src={photo.storedPath} style={{ width: 72, height: 72 }} />
              ))}
            </View>
          </View>
        )}

        {/* ---- acceptance signature (quote) ---- */}
        {model.acceptedAt && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Accepted</Text>
            {model.acceptedSignatureImage ? (
              <Image src={model.acceptedSignatureImage} style={{ width: 120, height: 32 }} />
            ) : (
              <Text style={styles.signature}>{model.acceptedBy || '—'}</Text>
            )}
            <Text style={{ fontSize: 9, color: model.colours.muted }}>
              Signed {model.acceptedAt.slice(0, 10)}
            </Text>
          </View>
        )}

        {/* ---- signature ---- */}
        {model.business.signature && (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>{model.labels.signedBy}</Text>
            {model.business.signature.kind === 'image' ? (
              <Image src={model.business.signature.value} style={styles.logo} />
            ) : (
              <Text style={styles.signature}>{model.business.signature.value}</Text>
            )}
          </View>
        )}

        <Footer model={model} styles={styles} />
      </Page>
    </Document>
  );
}

/* ---- header ---- */

function Header({ model, styles }: { model: DocumentModel; styles: ReturnType<typeof makeStyles> }) {
  const l = model.labels;
  const meta: { label: string; value: string }[] = [
    { label: l.number, value: model.number || model.draftNumber || '—' },
    { label: l.date, value: model.issueDateDisplay },
  ];
  if (model.dueDateDisplay) meta.push({ label: l.dueDate, value: model.dueDateDisplay });
  if (model.quoteValidUntil) meta.push({ label: l.quoteValidUntil, value: model.quoteValidUntil });
  if (model.poNumber) meta.push({ label: l.poNumber, value: model.poNumber });
  if (model.reference) meta.push({ label: l.reference, value: model.reference });

  return (
    <View>
      {model.business.letterheadHeader && model.header.mode === 'letterhead' && (
        <Image src={model.business.letterheadHeader} style={styles.letterhead} />
      )}

      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {model.business.logoSrc && model.header.mode !== 'letterhead' && (
            <Image src={model.business.logoSrc} style={styles.logo} />
          )}
          {model.header.showBusinessDetails && (
            <View>
              <Text style={styles.businessName}>{model.business.name}</Text>
              {model.business.abnDisplay ? (
                <Text style={styles.businessDetail}>ABN {model.business.abnDisplay}</Text>
              ) : null}
              {model.business.address.lines.map((line) => (
                <Text key={line} style={styles.businessDetail}>
                  {line}
                </Text>
              ))}
              {model.business.email ? (
                <Text style={styles.businessDetail}>{model.business.email}</Text>
              ) : null}
              {model.business.phone ? (
                <Text style={styles.businessDetail}>{model.business.phone}</Text>
              ) : null}
              {model.business.website ? (
                <Text style={styles.businessDetail}>{model.business.website}</Text>
              ) : null}
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.headingText}>{model.heading}</Text>
          <View style={styles.metaGrid}>
            {meta.map((item) => (
              <View key={item.label} style={styles.metaItem}>
                <Text style={styles.metaLabel}>{item.label}</Text>
                <Text style={styles.metaValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ---- parties ---- */

function Parties({ model, styles }: { model: DocumentModel; styles: ReturnType<typeof makeStyles> }) {
  const l = model.labels;
  return (
    <View style={styles.parties}>
      <View style={styles.partyBlock}>
        <Text style={styles.partyLabel}>{l.from}</Text>
        <Text style={styles.partyName}>{model.business.legalName || model.business.name}</Text>
        {model.business.contactName ? (
          <Text style={styles.partyLine}>{model.business.contactName}</Text>
        ) : null}
      </View>

      {model.client && (
        <View style={styles.partyBlock}>
          <Text style={styles.partyLabel}>{l.billTo}</Text>
          <Text style={styles.partyName}>{model.client.legalName || model.client.name}</Text>
          {model.client.address.lines.map((line) => (
            <Text key={line} style={styles.partyLine}>
              {line}
            </Text>
          ))}
          {model.client.taxIdDisplay ? (
            <Text style={styles.partyLine}>ABN {model.client.taxIdDisplay}</Text>
          ) : null}
          {model.client.email ? <Text style={styles.partyLine}>{model.client.email}</Text> : null}
        </View>
      )}
    </View>
  );
}

/* ---- table ---- */

function LineTable({
  model,
  styles,
  columns,
}: {
  model: DocumentModel;
  styles: ReturnType<typeof makeStyles>;
  columns: Column[];
}) {
  const valueLines = model.lines.filter((l) => l.showInTable);
  const discountLines = model.lines.filter((l) => l.type === 'discount');
  const noteLines = model.lines.filter((l) => l.type === 'note');

  if (valueLines.length === 0 && discountLines.length === 0 && noteLines.length === 0) return null;

  /** Group lines by section so section headings print where they belong. */
  const ordered = orderBySection(model);

  return (
    <View style={styles.table}>
      {valueLines.length > 0 && (
        <>
          {/* The header repeats on every page, so a long table stays readable. */}
          <View style={styles.tableHeader} fixed>
            {columns.map((col) => (
              <Text key={col.key} style={[styles.th, { width: `${col.width * 100}%`, textAlign: col.align }]}>
                {col.head}
              </Text>
            ))}
          </View>

          {ordered.map((entry) => {
            if (entry.kind === 'section') {
              const section = model.sections.find((s) => s.id === entry.sectionId);
              if (!section || !section.showSubtotal) {
                return (
                  <View key={`section-${entry.sectionId}`} style={styles.sectionRow} wrap={false}>
                    <Text style={styles.sectionTitle}>{section?.title ?? ''}</Text>
                  </View>
                );
              }
              return (
                <View key={`section-${entry.sectionId}`} style={styles.sectionRow} wrap={false}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  {/* The subtotal the editor shows: after the section
                      discount. Adding the (negative) discount back printed a
                      figure BELOW the discounted amount — $320 where the
                      editor and the client's copy said $360. */}
                  <Text style={styles.cellNum}>{formatMoneyFor(model, section.subtotalMinor)}</Text>
                </View>
              );
            }

            const line = entry.line;
            const index = valueLines.findIndex((l) => l.id === line.id);
            return (
              <View
                key={line.id}
                style={[styles.row, index % 2 === 1 ? styles.rowAlt : {}]}
                wrap={false}
                minPresenceAhead={12}
              >
                {columns.map((col) => (
                  <View key={col.key} style={{ width: `${col.width * 100}%` }}>
                    {col.render(line, model, styles)}
                  </View>
                ))}
              </View>
            );
          })}
        </>
      )}

      {/* Document-level discounts print as their own lines above the totals. */}
      {discountLines.map((line) => (
        <View key={line.id} style={styles.row} wrap={false}>
          <Text style={{ width: '70%' }}>
            {line.description}
            {line.discountLabel ? ` ${line.discountLabel}` : ''}
          </Text>
          <Text style={[styles.cellNum, { width: '30%' }]}>{formatMoneyFor(model, model.discountMinor)}</Text>
        </View>
      ))}

      {noteLines.map((line) => (
        <View key={line.id} style={{ paddingVertical: 3, paddingHorizontal: 3 }} wrap={false}>
          <Text style={styles.cellMuted}>{line.description}</Text>
        </View>
      ))}
    </View>
  );
}

type TableEntry = { kind: 'section'; sectionId: string } | { kind: 'line'; line: ModelLine };

/** Interleave section headings with their lines, in document order. */
function orderBySection(model: DocumentModel): TableEntry[] {
  const out: TableEntry[] = [];
  const emitted = new Set<string>();

  for (const line of model.lines) {
    if (line.type === 'section') {
      out.push({ kind: 'section', sectionId: line.id });
      emitted.add(line.id);
      continue;
    }
    if (!line.showInTable) continue;

    // A section heading that was written after its first line still has to appear
    // before it, so it is emitted here rather than skipped.
    if (line.sectionId && !emitted.has(line.sectionId)) {
      out.push({ kind: 'section', sectionId: line.sectionId });
      emitted.add(line.sectionId);
    }
    out.push({ kind: 'line', line });
  }

  return out;
}

/* ---- totals ---- */

function Totals({ model, styles }: { model: DocumentModel; styles: ReturnType<typeof makeStyles> }) {
  const l = model.labels;
  const money = (minor: number) => formatMoneyFor(model, minor);
  const showGroupBreakdown = model.taxGroups.length > 1;

  return (
    <View style={styles.totalsWrap}>
      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>{l.subtotal}</Text>
          <Text style={styles.totalValue}>{money(model.subtotalMinor)}</Text>
        </View>

        {model.discountMinor !== 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{model.discountMinor < 0 ? l.discountTotal : 'Surcharge'}</Text>
            <Text style={styles.totalValue}>{money(model.discountMinor)}</Text>
          </View>
        )}

        {model.taxGroups.map((group) => (
          <View key={group.codeId} style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {group.name}
              {group.marker}
              {showGroupBreakdown ? ` (${group.rateLabel})` : ''}
            </Text>
            <Text style={styles.totalValue}>{money(group.taxMinor)}</Text>
          </View>
        ))}

        {/* The one GST row when a document uses a single code. */}
        {model.taxGroups.length === 1 && model.taxMinor !== 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{model.business.gstRegistered ? l.taxTotal : 'Tax'}</Text>
            <Text style={styles.totalValue}>{money(model.taxMinor)}</Text>
          </View>
        )}

        <View style={styles.grandTotalRow}>
          <Text style={styles.grandTotalLabel}>{l.total}</Text>
          <Text style={styles.grandTotalValue}>{money(model.totalMinor)}</Text>
        </View>

        {model.taxMode === 'inclusive' && model.taxMinor !== 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{l.totalIncludingGst}</Text>
            <Text style={styles.totalValue}>{money(model.totalMinor)}</Text>
          </View>
        )}

        {model.paidMinor !== 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{l.amountPaid}</Text>
            <Text style={styles.totalValue}>{money(-model.paidMinor)}</Text>
          </View>
        )}

        {model.creditMinor > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{l.creditApplied}</Text>
            <Text style={styles.totalValue}>{money(-model.creditMinor)}</Text>
          </View>
        )}

        {model.deposit.enabled && (
          <>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{model.deposit.paid ? l.depositReceived : l.depositDue}</Text>
              <Text style={styles.totalValue}>{money(model.deposit.amountMinor)}</Text>
            </View>
            {model.deposit.paid && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>{l.balanceDue}</Text>
                <Text style={styles.totalValue}>{money(model.deposit.balanceAfterMinor)}</Text>
              </View>
            )}
          </>
        )}

        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>{model.balanceMinor <= 0 ? l.amountPaid : l.balanceDue}</Text>
          <Text style={styles.balanceValue}>{money(model.balanceMinor)}</Text>
        </View>

        {model.audEquivalentMinor !== null && (
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>AUD equivalent</Text>
            <Text style={styles.totalValue}>
              {formatMoneyFor({ currency: 'AUD' }, model.audEquivalentMinor)}
            </Text>
          </View>
        )}

        {/* The ATO's inclusive statement, only where it is actually permitted.
            The model decides: the flag already accounts for the rate being exactly
            one eleventh, so this cannot print the statement on a document the
            compliance checker has warned about. */}
        {model.taxMode === 'inclusive' &&
          model.taxMinor !== 0 &&
          model.business.gstRegistered &&
          model.inclusiveGstStatementAllowed && (
            <Text style={[styles.totalLabel, { marginTop: 3 }]}>Total price includes GST</Text>
          )}
      </View>
    </View>
  );
}

/* ---- payment details ---- */

function PaymentDetails({ model, styles }: { model: DocumentModel; styles: ReturnType<typeof makeStyles> }) {
  // The payment block now reads the profile through the model, so the template
  // panel can print the actual BSB, account number and PayID instead of an
  // email address repeated twice.
  const lines: string[] = [];
  if (model.payment?.accountName) lines.push(model.payment.accountName);
  if (model.payment?.bsb && model.payment?.accountNumber) {
    lines.push(`BSB ${model.payment.bsb} · Account ${model.payment.accountNumber}`);
  }
  if (model.payment?.payId) lines.push(`PayID ${model.payment.payId}`);
  if (model.payment?.bpayBillerCode && model.payment?.bpayReference) {
    lines.push(`BPAY ${model.payment.bpayBillerCode} ref ${model.payment.bpayReference}`);
  }
  if (model.payment?.other) lines.push(model.payment.other);
  if (model.payment?.paymentLink) lines.push(model.payment.paymentLink);
  if (lines.length === 0 && model.business.email) lines.push(`${model.business.email}`);
  if (lines.length === 0 && model.business.phone) lines.push(`${model.business.phone}`);

  if (lines.length === 0) return null;

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{model.labels.paymentDetails}</Text>
      <View style={styles.paymentDetails}>
        <Text style={styles.paymentMethod}>Pay by bank transfer</Text>
        {lines.map((line) => (
          <Text key={line} style={styles.paymentLine}>
            {line}
          </Text>
        ))}
        {model.dueDateDisplay ? (
          <Text style={[styles.paymentLine, { marginTop: 3 }]}>Due {model.dueDateDisplay}</Text>
        ) : null}
      </View>
    </View>
  );
}

/* ---- footer ---- */

function Footer({ model, styles }: { model: DocumentModel; styles: ReturnType<typeof makeStyles> }) {
  const thankYou = model.footer.showThankYou && model.footer.thankYouText ? model.footer.thankYouText : '';

  return (
    <View style={styles.footer} fixed>
      <View>
        {thankYou ? <Text style={styles.footerText}>{thankYou}</Text> : null}
        {model.footer.legalText ? <Text style={styles.footerText}>{model.footer.legalText}</Text> : null}
        {model.footer.mode === 'letterhead' && model.business.letterheadFooter ? (
          <Image src={model.business.letterheadFooter} style={{ width: 120, marginTop: 3 }} />
        ) : null}
      </View>
      {model.showPageNumbers ? (
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${model.labels.page} ${pageNumber} ${model.labels.of} ${totalPages}`
          }
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

/**
 * Render a document to a PDF blob.
 *
 * Deterministic by construction: the layout engine is react-pdf's, the fonts are
 * bundled, and every figure comes from the view model rather than from a
 * calculation at render time. Rendering the same model twice produces the same
 * bytes.
 */
export async function renderDocumentPdf(model: DocumentModel): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer');
  await ensureFontsRegistered();
  return pdf(<DocumentPdf model={model} />).toBlob();
}

/** Render to a data URL, for the live preview and for an emailed attachment. */
export async function renderDocumentPdfDataUrl(model: DocumentModel): Promise<string> {
  const { pdf } = await import('@react-pdf/renderer');
  await ensureFontsRegistered();
  const blob = await pdf(<DocumentPdf model={model} />).toBlob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the rendered PDF'));
    reader.readAsDataURL(blob);
  });
}

/** Register the bundled fonts once per session. */
async function ensureFontsRegistered(): Promise<void> {
  await fontStore();
}

/** The payment method labels the PDF prints. */
export { PAYMENT_METHOD_LABELS };

export { Image, Page, StyleSheet, Text, View };
export { FONTS as FONT_FAMILIES };
