import type { CustomerInput } from './types';
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to load customers. Please try again.';
export function creditMoney(value: string) {
  const [whole, part = '00'] = value.split('.');
  return 'BDT ' + BigInt(whole!).toLocaleString('en-BD') + '.' + part.padEnd(2, '0');
}
export const blank = (): CustomerInput => ({
  customerKind: 'person',
  segment: 'retail',
  name: '',
  contactName: '',
  phone: '',
  email: '',
  billingAddress: null,
  deliveryAddress: null,
  notes: '',
  isActive: true,
});
export function minorMoney(minor: string) {
  const n = BigInt(minor);
  return creditMoney(n / 100n + '.' + (n % 100n).toString().padStart(2, '0'));
}
