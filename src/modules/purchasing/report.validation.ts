import { object, text, invalid } from './purchasing.validation.js';
import type { AgingQuery, StatementQuery } from './report.types.js';
export function reportDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2000-01-01' ||
    value > '2199-12-31' ||
    !Number.isFinite(new Date(value + 'T00:00:00Z').getTime()) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    invalid('Choose a valid report date');
  return value;
}
function page(value: unknown) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > 10000)
    invalid('Invalid report page');
  return Number(value);
}
export function agingQuery(value: unknown): AgingQuery {
  const r = object(value, ['asOf', 'search', 'page']);
  return {
    ...(r.asOf === undefined ? {} : { asOf: reportDate(r.asOf) }),
    search: text(r.search ?? '', 'search', 100, true),
    page: page(r.page),
  };
}
export function statementQuery(value: unknown, exporting = false): StatementQuery {
  const r = object(value, exporting ? ['from', 'to'] : ['from', 'to', 'page', 'invoicePage']);
  return {
    ...(r.from === undefined ? {} : { from: reportDate(r.from) }),
    ...(r.to === undefined ? {} : { to: reportDate(r.to) }),
    page: page(r.page),
    invoicePage: page(r.invoicePage),
  };
}
