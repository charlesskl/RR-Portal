import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseExcelRedRows } from './excel-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');
const UPLOAD_PATH = path.join(__dirname, '..', 'uploads');

export async function migrateReportMetadata() {
  if (!fs.existsSync(REPORTS_FILE)) return { migrated: 0, skipped: 0 };
  const reports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
  let migrated = 0;
  let skipped = 0;

  for (const report of reports) {
    const hasTestResults = (report.sheets || []).every(sheet => Array.isArray(sheet.testResults));
    if (report.productNo && report.stage && hasTestResults) continue;

    const source = path.join(UPLOAD_PATH, report.storedName || '');
    if (!report.storedName || !fs.existsSync(source)) {
      skipped++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(source);
      const parsed = await parseExcelRedRows(buffer, {
        includeImages: false,
        fileName: report.originalName || report.storedName
      });
      report.productNo = report.productNo || parsed.metadata.productNo;
      report.productName = report.productName || parsed.metadata.productName;
      report.stage = report.stage || parsed.metadata.stage;
      report.stageSource = report.stageSource || parsed.metadata.stageSource;
      report.reportDate = report.reportDate || parsed.metadata.reportDate || report.uploadedAt;

      const parsedSheets = new Map(parsed.sheets.map(sheet => [String(sheet.name).trim(), sheet]));
      for (const sheet of report.sheets || []) {
        const updated = parsedSheets.get(String(sheet.name).trim());
        sheet.testResults = updated?.testResults || [];
        sheet.passCount = updated?.passCount || 0;
      }
      report.passCount = (report.sheets || []).reduce((sum, sheet) => sum + (sheet.passCount || 0), 0);
      migrated++;
    } catch (error) {
      console.warn(`[migration] report ${report.id} skipped: ${error.message}`);
      skipped++;
    }
  }

  if (migrated > 0) fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
  return { migrated, skipped };
}
