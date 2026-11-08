import type { AgingAmounts } from './report-types';
import { money } from './money';
export const agingLabels = [
  ['notDue', 'Not due / due today'],
  ['days1to30', '1–30 days'],
  ['days31to60', '31–60 days'],
  ['days61to90', '61–90 days'],
  ['over90', 'Over 90 days'],
] as const;
export function AgingCards({ totals }: { totals: AgingAmounts }) {
  return (
    <div className="aging-cards" aria-label="Outstanding by days past due">
      {agingLabels.map(([key, label]) => (
        <div key={key}>
          <span>{label}</span>
          <strong>{money(totals[key])}</strong>
        </div>
      ))}
    </div>
  );
}
