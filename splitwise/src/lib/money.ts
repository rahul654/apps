export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'SGD', 'AUD', 'CAD'] as const;

/** Parses user input like "1,250.5" into minor units (125050). Returns null for blank/invalid input. */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, '');
  if (!cleaned || !/^\d*\.?\d*$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Parses a plain positive number (percent or share count). Blank/invalid → 0. */
export function parseNumber(input: string | undefined): number {
  const n = Number((input ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency: string): string {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(currency, f);
  }
  return f.format(cents / 100);
}

export function sumShares(shares: { amount: number }[]): number {
  return shares.reduce((s, x) => s + x.amount, 0);
}
