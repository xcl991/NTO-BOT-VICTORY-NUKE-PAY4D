import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import logger from '../../utils/logger';
import type { NtoRow } from '../flows/nto-check-flow';
import type { TarikDbRow } from '../flows/nuke-tarikdb-check-flow';

const EXPORT_DIR = path.join(__dirname, '../../../../data/exports');

/**
 * Export NTO data rows to an Excel file
 */
export async function exportNtoToExcel(
  rows: NtoRow[],
  options?: {
    summary?: NtoRow;
    accountName?: string;
    provider?: string;
    dateRange?: string;
  },
): Promise<string> {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BOT NTO';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('NTO Report');

  // Title row
  const provider = options?.provider || 'NUKE';
  const dateRange = options?.dateRange || new Date().toISOString().split('T')[0];
  const accountName = options?.accountName || '';

  sheet.mergeCells('A1:D1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `NTO Report - ${provider} ${accountName ? `(${accountName})` : ''} - ${dateRange}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  // Empty row
  sheet.addRow([]);

  // Header row
  const headerRow = sheet.addRow(['Username', 'Bet Count', 'User TO', 'User NTO']);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.alignment = { horizontal: 'center' };

  // Column widths
  sheet.getColumn(1).width = 25; // Username
  sheet.getColumn(2).width = 15; // Bet Count
  sheet.getColumn(3).width = 18; // User TO
  sheet.getColumn(4).width = 18; // User NTO

  // Data rows
  for (const row of rows) {
    const dataRow = sheet.addRow([row.username, row.betCount, row.userTO, row.userNTO]);

    // Color NTO values: blue for positive, red for negative
    const ntoCell = dataRow.getCell(4);
    const ntoVal = parseFloat(row.userNTO.replace(/,/g, ''));
    if (!isNaN(ntoVal)) {
      ntoCell.font = { color: { argb: ntoVal >= 0 ? 'FF2196F3' : 'FFF44336' } };
    }

    const toCell = dataRow.getCell(3);
    const toVal = parseFloat(row.userTO.replace(/,/g, ''));
    if (!isNaN(toVal)) {
      toCell.font = { color: { argb: toVal >= 0 ? 'FF2196F3' : 'FFF44336' } };
    }
  }

  // Summary row
  if (options?.summary) {
    const sumRow = sheet.addRow([]);
    const summaryRow = sheet.addRow([
      'SUMMARY',
      options.summary.betCount,
      options.summary.userTO,
      options.summary.userNTO,
    ]);
    summaryRow.font = { bold: true };
    summaryRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  }

  // Add borders to all data cells
  const lastRow = sheet.lastRow?.number || 3;
  for (let r = 3; r <= lastRow; r++) {
    for (let c = 1; c <= 4; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }
  }

  // Save file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `NTO_${provider}_${timestamp}.xlsx`;
  const filePath = path.join(EXPORT_DIR, filename);

  await workbook.xlsx.writeFile(filePath);
  logger.info(`Excel exported: ${filePath} (${rows.length} rows)`);
  return filePath;
}

/**
 * Export TARIK DB data rows to an Excel file
 */
export async function exportTarikDbToExcel(
  rows: TarikDbRow[],
  options?: {
    accountName?: string;
    provider?: string;
    dateRange?: string;
  },
): Promise<string> {
  if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BOT NTO';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('TARIK DB Report');

  // Title row
  const provider = options?.provider || 'NUKE';
  const dateRange = options?.dateRange || new Date().toISOString().split('T')[0];
  const accountName = options?.accountName || '';

  sheet.mergeCells('A1:E1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `TARIK DB Report - ${provider} ${accountName ? `(${accountName})` : ''} - ${dateRange}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  // Empty row
  sheet.addRow([]);

  // Header row
  const headerRow = sheet.addRow(['Username', 'Wallet', 'Phone', 'Status', 'Join Date']);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  headerRow.alignment = { horizontal: 'center' };

  // Column widths
  sheet.getColumn(1).width = 25; // Username
  sheet.getColumn(2).width = 20; // Wallet
  sheet.getColumn(3).width = 20; // Phone
  sheet.getColumn(4).width = 18; // Status
  sheet.getColumn(5).width = 22; // Join Date

  // Data rows
  for (const row of rows) {
    const dataRow = sheet.addRow([row.username, row.wallet, row.phone, row.status, row.joinDate]);

    // Color status: green for REGIS + DEPO, gray for REGIS ONLY
    const statusCell = dataRow.getCell(4);
    if (row.status.includes('DEPO')) {
      statusCell.font = { color: { argb: 'FF03AA14' }, bold: true }; // Green
    } else {
      statusCell.font = { color: { argb: 'FF999999' } }; // Gray
    }
  }

  // Add borders to all data cells
  const lastRow = sheet.lastRow?.number || 3;
  for (let r = 3; r <= lastRow; r++) {
    for (let c = 1; c <= 5; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    }
  }

  // Save file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `TARIKDB_${provider}_${timestamp}.xlsx`;
  const filePath = path.join(EXPORT_DIR, filename);

  await workbook.xlsx.writeFile(filePath);
  logger.info(`TARIK DB Excel exported: ${filePath} (${rows.length} rows)`);
  return filePath;
}
