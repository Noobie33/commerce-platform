import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
export function paymentError(error: unknown): never {
  const d =
    error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
  if (d && typeof d === 'object' && 'message' in d) {
    const message = String(d.message);
    if (['PAYMENT_INVALID', 'PAYMENT_DATE', 'PAYMENT_ALLOCATION_TOTAL'].includes(message))
      throw new BadRequestException({
        code: 'INVALID_PURCHASING_INPUT',
        message:
          message === 'PAYMENT_DATE'
            ? 'Record an actual payment date, on or after the invoice dates and no later than today in Bangladesh.'
            : message === 'PAYMENT_ALLOCATION_TOTAL'
              ? 'Allocated amounts must equal the recorded payment.'
              : 'Check payment fields and amounts.',
      });
    if (message === 'PAYMENT_PERMISSION') throw new ForbiddenException({ code: message });
    if (message === 'PAYMENT_NOT_FOUND') throw new NotFoundException({ code: message });
    if (
      [
        'PAYMENT_STALE',
        'PAYMENT_REVERSED',
        'PAYMENT_INVOICE_UNAVAILABLE',
        'PAYMENT_EXCEEDS_DUE',
        'PAYMENT_REFERENCE_EXISTS',
      ].includes(message)
    )
      throw new ConflictException({ code: message });
    if (message === 'INVENTORY_IDEMPOTENCY_MISMATCH')
      throw new ConflictException({ code: 'IDEMPOTENCY_MISMATCH' });
    if ('code' in d && ['57014', '40P01', '40001'].includes(String(d.code)))
      throw new ServiceUnavailableException({ code: 'PURCHASING_BUSY' });
  }
  throw error;
}
