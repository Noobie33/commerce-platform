import { object, text, version, uuid, invalid } from './sales.validation.js';
import type { ReservationInput } from './reservation.types.js';
export function reservationInput(value: unknown, releasing = false): ReservationInput {
  const b = object(value, [
    'expectedVersion',
    'expectedRevision',
    'reason',
    ...(releasing ? ['reservationId'] : ['holdMinutes']),
  ]);
  const common = {
    expectedVersion: version(b.expectedVersion),
    expectedRevision: version(b.expectedRevision),
    reason: text(b.reason, 500, true),
  };
  if (releasing) return { ...common, reservationId: uuid(b.reservationId) };
  if (
    !Number.isInteger(b.holdMinutes) ||
    Number(b.holdMinutes) < 15 ||
    Number(b.holdMinutes) > 1440
  )
    invalid('Choose a stock hold duration between 15 minutes and 24 hours');
  return { ...common, holdMinutes: b.holdMinutes as number };
}
export function reservationPage(value: unknown) {
  const b = object(value, ['page']);
  if (b.page !== undefined && (typeof b.page !== 'string' || !/^[1-9]\d{0,5}$/.test(b.page)))
    invalid('Invalid history page');
  return b.page === undefined ? 1 : Number(b.page);
}
