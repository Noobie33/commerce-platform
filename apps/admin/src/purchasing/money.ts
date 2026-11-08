export function costMinor(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) return null;
  const [a, b = ''] = value.split('.');
  const n = BigInt(a!) * 100n + BigInt(b.padEnd(2, '0'));
  return n <= 999999999999n ? n : null;
}
export function decimal(n: bigint) {
  return n / 100n + '.' + (n % 100n).toString().padStart(2, '0');
}
export function money(value: string) {
  const negative = value.startsWith('-');
  const [a, b = '00'] = (negative ? value.slice(1) : value).split('.');
  return (negative ? '-' : '') + '৳' + BigInt(a!).toLocaleString('en-BD') + '.' + b.padEnd(2, '0');
}
