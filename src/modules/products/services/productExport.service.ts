import ExcelJS from 'exceljs';

/**
 * The admin product catalogue as a real .xlsx.
 *
 * Built server-side rather than in the browser for two reasons: the export
 * covers every product matching the filters, not the page currently loaded,
 * and the browser never holds the full catalogue. Doing it here also means the
 * rows come from the same query the listing uses, so the file cannot disagree
 * with the screen it was downloaded from.
 *
 * A genuine workbook rather than a CSV named .xlsx: image links have to be
 * clickable, and Excel mangles a bare CSV's long numeric SKUs into scientific
 * notation, which silently corrupts exactly the column people paste back.
 */

/** Individually clickable image columns. Beyond this the URLs go in one cell. */
const IMAGE_LINK_COLUMNS = 5;

const INK = 'FF1A1A1A';
const GOLD = 'FFC9A84C';

interface ExportMeta {
  /** Echoed into the sheet so a saved file still says what it was filtered to. */
  filters: Record<string, string | undefined>;
  total: number;
}

export async function buildProductWorkbook(products: any[], meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Unique Dressup';
  wb.created = new Date();

  const ws = wb.addWorksheet('Products', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns: Partial<ExcelJS.Column>[] = [
    { header: 'SKU', key: 'sku', width: 18 },
    { header: 'Name', key: 'name', width: 42 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Gender', key: 'gender', width: 10 },
    { header: 'Brand', key: 'brand', width: 16 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Base price', key: 'basePrice', width: 12 },
    { header: 'Sale price', key: 'salePrice', width: 12 },
    { header: 'Stock', key: 'stock', width: 9 },
    { header: 'Variants', key: 'variantCount', width: 10 },
    { header: 'Sizes', key: 'sizes', width: 22 },
    { header: 'Colours', key: 'colours', width: 22 },
    { header: 'Flags', key: 'flags', width: 26 },
    { header: 'Tags', key: 'tags', width: 26 },
    { header: 'Product URL', key: 'productUrl', width: 40 },
    { header: 'Images', key: 'imageCount', width: 9 },
  ];
  for (let i = 1; i <= IMAGE_LINK_COLUMNS; i++) {
    columns.push({ header: i === 1 ? 'Primary image' : `Image ${i}`, key: `image${i}`, width: 46 });
  }
  columns.push({ header: 'All image URLs', key: 'allImages', width: 60 });
  columns.push({ header: 'Created', key: 'createdAt', width: 18 });
  ws.columns = columns;

  // Header
  const header = ws.getRow(1);
  header.height = 22;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  header.alignment = { vertical: 'middle' };
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    cell.border = { bottom: { style: 'thin', color: { argb: GOLD } } };
  });

  const uniq = (xs: (string | null | undefined)[]) =>
    [...new Set(xs.map(x => String(x ?? '').trim()).filter(Boolean))];

  for (const p of products) {
    const images: string[] = (p.images || []).map((i: any) => i.url).filter(Boolean);
    const variants = p.variants || [];

    // Variant stock is the real number once variants exist; the product-level
    // field is only meaningful for products that have none.
    const variantStock = variants.reduce((t: number, v: any) => t + Number(v.stockQuantity ?? 0), 0);
    const stock = variants.length ? variantStock : Number(p.stockQuantity ?? 0);

    const flags = [
      p.isFeatured && 'Featured',
      p.isTrending && 'Trending',
      p.isNewArrival && 'New',
      p.isBestSeller && 'Best seller',
    ].filter(Boolean).join(', ');

    const row: Record<string, unknown> = {
      sku: p.sku || '',
      name: p.name || '',
      category: p.category?.name || '',
      gender: p.gender || '',
      brand: p.brand || '',
      status: p.isActive ? 'Active' : 'Draft',
      basePrice: Number(p.basePrice ?? 0),
      salePrice: p.salePrice != null ? Number(p.salePrice) : null,
      stock,
      variantCount: variants.length,
      sizes: uniq(variants.map((v: any) => v.size)).join(', '),
      colours: uniq(variants.map((v: any) => v.color)).join(', '),
      flags,
      tags: (p.tags || []).map((t: any) => t.tag).join(', '),
      productUrl: p.slug ? `https://theuniquedressup.com/product/${p.slug}` : '',
      imageCount: images.length,
      allImages: images.join('\n'),
      createdAt: p.createdAt ? new Date(p.createdAt) : null,
    };
    for (let i = 0; i < IMAGE_LINK_COLUMNS; i++) row[`image${i + 1}`] = images[i] || '';

    const added = ws.addRow(row);

    // Hyperlinks, not text. A URL you cannot click is a URL nobody uses.
    const link = (key: string, url: string, label?: string) => {
      if (!url) return;
      const cell = added.getCell(key);
      cell.value = { text: label ?? url, hyperlink: url };
      cell.font = { color: { argb: 'FF1155CC' }, underline: true };
    };
    link('productUrl', String(row.productUrl || ''), p.slug);
    for (let i = 1; i <= IMAGE_LINK_COLUMNS; i++) {
      link(`image${i}`, String(row[`image${i}`] || ''), `Image ${i}`);
    }

    added.getCell('allImages').alignment = { wrapText: true, vertical: 'top' };
    added.getCell('basePrice').numFmt = '₹#,##0.00';
    added.getCell('salePrice').numFmt = '₹#,##0.00';
    added.getCell('createdAt').numFmt = 'dd-mm-yyyy hh:mm';
    // Drafts are the rows an admin is usually hunting for.
    if (!p.isActive) {
      added.getCell('status').font = { color: { argb: 'FFB71C1C' }, bold: true };
    }
    if (stock === 0) {
      added.getCell('stock').font = { color: { argb: 'FFB71C1C' }, bold: true };
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  // A second sheet recording what this file actually contains — a spreadsheet
  // outlives the screen it came from, and "which filters was this?" is the
  // first question anyone asks of a saved export.
  const info = wb.addWorksheet('Export info');
  info.columns = [{ width: 22 }, { width: 52 }];
  const infoRows: [string, string][] = [
    ['Generated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Products in file', String(products.length)],
    ['Matching the filters', String(meta.total)],
    ['Search', meta.filters.search || '(none)'],
    ['Status', meta.filters.status || 'All'],
    ['Category', meta.filters.categoryName || (meta.filters.categoryId ? meta.filters.categoryId : 'All')],
    ['Gender', meta.filters.gender || 'All'],
  ];
  infoRows.forEach(([k, v], i) => {
    const r = info.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    if (i === 0) r.getCell(1).font = { bold: true };
  });

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
