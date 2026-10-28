import { describe, it, expect } from 'vitest';
import { csvCell, csvRow, CSV_BOM } from '../utils/csv';

describe('CSV export helpers', () => {
  it('escapes cells containing commas, quotes, and newlines', () => {
    expect(csvCell('Lahore, Punjab')).toBe('"Lahore, Punjab"');
    expect(csvCell('Quote "test" here')).toBe('"Quote ""test"" here"');
    expect(csvCell('Multi\nline')).toBe('"Multi\nline"');
  });

  it('neutralizes spreadsheet formula injection (CWE-1236)', () => {
    expect(csvCell('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
    expect(csvCell('+cmd|...')).toBe("'+cmd|...");
    expect(csvCell('-@calc')).toBe("'-@calc");
    // Normal negative numbers remain standard numbers
    expect(csvCell('-250')).toBe('-250');
    expect(csvCell('-12.50')).toBe('-12.50');
  });

  it('formats full CSV rows with carriage return and newline', () => {
    const row = csvRow(['ID123', 'Muhammad Bilal', '03001234567']);
    expect(row).toBe('ID123,Muhammad Bilal,03001234567\r\n');
  });

  it('includes UTF-8 BOM for spreadsheet Unicode support', () => {
    expect(CSV_BOM).toBe('\uFEFF');
  });
});
