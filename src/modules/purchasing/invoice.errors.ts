import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
export function invoiceError(error: unknown): never {
  const d =
    error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
  if (d && typeof d === 'object' && 'message' in d) {
    const message = String(d.message);
    if (message === 'INVOICE_INVALID')
      throw new BadRequestException({
        code: 'INVALID_PURCHASING_INPUT',
        message: 'Check invoice fields and amounts',
      });
    if (message === 'INVOICE_PERMISSION') throw new ForbiddenException({ code: message });
    if (message === 'INVOICE_NOT_FOUND') throw new NotFoundException({ code: message });
    if (
      [
        'INVOICE_HAS_PAYMENTS',
        'INVOICE_STALE',
        'INVOICE_REVERSED',
        'INVOICE_ORDER_STATE',
        'INVOICE_RECEIPT_UNAVAILABLE',
        'INVOICE_OVER_QUANTITY',
        'INVOICE_NUMBER_EXISTS',
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
