const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const compactCurrency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function formatCurrency(value) {
  return currency.format(Number(value) || 0);
}

export function formatCompactCurrency(value) {
  return Number(value) >= 100000 ? compactCurrency.format(value) : formatCurrency(value);
}

// MySQL DATETIME values arrive as "YYYY-MM-DD HH:MM:SS" in the server's local time.
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : dateTime.format(date);
}

export function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}
