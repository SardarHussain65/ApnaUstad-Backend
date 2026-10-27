/** Minimal RFC 4180 CSV helpers with spreadsheet formula-injection protection. */

const FORMULA_START = /^[=+\-@\t\r]/;

export const csvCell = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Neutralise Excel/Sheets formula injection (CWE-1236) but keep plain negative numbers intact.
  if (FORMULA_START.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
};

export const csvRow = (values: unknown[]): string => `${values.map(csvCell).join(',')}\r\n`;

/** UTF-8 BOM so Excel opens Urdu/UTF-8 text correctly. */
export const CSV_BOM = '\uFEFF';
