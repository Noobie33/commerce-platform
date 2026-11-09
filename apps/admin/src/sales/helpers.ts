export const problem = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete this request. Try again.';
export function minor(value: string): bigint | null {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) return null;
  const [a, b = ''] = value.split('.');
  return BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
}
export function decimal(n: bigint) {
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function money(value: string) {
  const [a, b = '00'] = value.split('.');
  return 'BDT ' + BigInt(a!).toLocaleString('en-BD') + '.' + b.padEnd(2, '0');
}
