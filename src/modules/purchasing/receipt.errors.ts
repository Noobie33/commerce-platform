import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
export function receiptError(error: unknown): never {
  const d =
    error && typeof error === 'object' && 'driverError' in error ? error.driverError : error;
  const message = d && typeof d === 'object' && 'message' in d ? String(d.message) : '';
  if (['RECEIPT_PERMISSION', 'INVENTORY_PERMISSION'].includes(message))
    throw new ForbiddenException({ code: 'RECEIPT_PERMISSION' });
  if (
    message === 'RECEIPT_NOT_FOUND' ||
    [
      'INVENTORY_VARIANT_NOT_FOUND',
      'INVENTORY_LOCATION_INACTIVE',
      'INVENTORY_POSTING_NOT_FOUND',
    ].includes(message)
  )
    throw new NotFoundException({ code: 'RECEIPT_RECORD_NOT_FOUND' });
  if (['RECEIPT_INVALID_INPUT', 'INVENTORY_INVALID_INPUT'].includes(message))
    throw new BadRequestException({
      code: 'INVALID_PURCHASING_INPUT',
      message: 'Check the receipt details and ordered SKUs',
    });
  const codes: Record<string, string> = {
    RECEIPT_INVOICED: 'RECEIPT_INVOICED',
    RECEIPT_STALE: 'STALE_RECEIPT',
    RECEIPT_ORDER_STATE: 'PURCHASE_ORDER_STATE',
    RECEIPT_OVER_QUANTITY: 'RECEIPT_OVER_QUANTITY',
    RECEIPT_REFERENCE_EXISTS: 'RECEIPT_REFERENCE_EXISTS',
    RECEIPT_ALREADY_REVERSED: 'RECEIPT_ALREADY_REVERSED',
    INVENTORY_IDEMPOTENCY_MISMATCH: 'IDEMPOTENCY_MISMATCH',
    INVENTORY_INSUFFICIENT: 'INSUFFICIENT_STOCK',
    INVENTORY_VARIANT_INACTIVE: 'INACTIVE_STOCK_VARIANT',
    INVENTORY_QUANTITY_LIMIT: 'STOCK_QUANTITY_LIMIT',
    PURCHASE_RECEIPTS_EXIST: 'PURCHASE_RECEIPTS_EXIST',
  };
  if (codes[message]) throw new ConflictException({ code: codes[message] });
  if (d && typeof d === 'object' && 'code' in d && ['57014', '40P01'].includes(String(d.code)))
    throw new ServiceUnavailableException({ code: 'RECEIPT_BUSY' });
  throw error;
}
