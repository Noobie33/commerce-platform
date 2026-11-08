import type { SupplierStatement } from './report.types.js';
const timestamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
export function csvCell(value: string | number) {
  let s = String(value);
  if (/^[\s\uFEFF]*[=+@-]/u.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function statementCsv(data: SupplierStatement): string {
  const base = [data.supplier.code, data.supplier.name, data.from, data.to],
    row = (
      kind: string,
      recorded = '',
      document = '',
      reference = '',
      reason = '',
      actor = '',
      increase = '',
      decrease = '',
      balance = '',
      peers: string | number = '',
    ) => [
      ...base,
      kind,
      recorded,
      document,
      reference,
      reason,
      actor,
      increase,
      decrease,
      balance,
      peers,
    ];
  const rows: (string | number)[][] = [
    [
      'Supplier code',
      'Supplier name',
      'From',
      'To',
      'Entry type',
      'Recorded at (Asia/Dhaka)',
      'Document date',
      'Reference',
      'Reason',
      'Actor',
      'Increase (BDT)',
      'Decrease (BDT)',
      'Balance at recorded time (BDT)',
      'Events at this time',
    ],
    row('Opening balance', '', '', '', '', '', '', '', data.totals.opening),
    ...data.items.map((e) =>
      row(
        e.kind,
        timestamp.format(new Date(e.recordedAt)),
        e.documentOn,
        e.reference,
        e.reason,
        e.actorName,
        e.increase,
        e.decrease,
        e.balanceAtTime,
        e.sameTimeEvents,
      ),
    ),
    row(
      'Period totals',
      '',
      '',
      '',
      '',
      '',
      data.totals.increased,
      data.totals.decreased,
      data.totals.closing,
    ),
    row('Closing balance', '', '', '', '', '', '', '', data.totals.closing),
  ];
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
