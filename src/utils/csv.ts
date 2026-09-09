/**
 * Minimal RFC 4180 CSV reader.
 *
 * Written rather than pulled from npm because the only consumer is the Shopify
 * importer, and the one thing that actually matters there is correctness on
 * quoted fields: Shopify's "Body (HTML)" column routinely contains commas,
 * newlines and doubled quotes inside a single quoted value. A naive
 * line.split(',') mangles every product description in the file.
 */

/** Parse CSV text into rows of raw string cells. */
export const parseCsv = (text: string): string[][] => {
  // Strip a UTF-8 BOM — Shopify exports include one, and it would otherwise
  // become part of the first header name ("﻿Handle").
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (c === '\r') {
      // swallow; the \n branch closes the record
      i++;
      continue;
    }

    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += c;
    i++;
  }

  // Trailing record without a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

/**
 * Parse CSV into objects keyed by header name.
 * Missing trailing cells become '' rather than undefined, so callers can treat
 * every column as a string.
 */
export const parseCsvToObjects = (text: string): Record<string, string>[] => {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map(h => h.trim());
  const out: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // Skip completely blank lines
    if (cells.length === 1 && cells[0].trim() === '') continue;

    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }

  return out;
};
