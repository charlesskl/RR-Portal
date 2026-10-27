import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const templates = [
  ['base-master.xlsx', ['98631']],
  ['miandan-tpl.xlsx', ['面单模版', '面单模版国际']],
  ['zuru-tpl/兴信-zuru.xlsx', ['兴信-zuru']],
  ['other-tpl/兴信香港.xlsx', ['TOMY (4)', 'TOMY (9)', 'John Adams (5)', 'John Adams (2)', 'Masterkidz', 'Zanzoon', 'AZAD']],
  ['other-tpl/兴信远东.xlsx', ['Tigerhead (2)', 'Cepia', 'Moose', 'Lung Cheong', 'Tokidos', 'Tokidos (2)', 'Exceenis']],
  ['other-tpl/兴信香港新模板.xlsx', ['Tigerhead出货', 'Tigerhead模费100%', 'Tigerhead模费50%', 'John Adams出货 定金']],
];
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const permittedText = new Set([
  'USD', 'PCS', 'TOTAL', '原单价:', '原单价：', '原单价', '本页合计：', '330783',
  'Deposit 50%', 'Balance 70%', 'Deposit  100%', 'Balance  50%', 'Balance 50%', 'Deposit 30%',
  '日期', '客名', '发票NO:', '金额(USD)', '实收金额(HK$)', '实收金额 (HK$)', '备注', '发 票 NO:', '金  额 (HK$)', '客 名',
  '东莞兴信塑胶制品有限公司', 'DONGGUAN HANSON PLASTICPRODUCTLTD.', '东莞市清溪镇上元管理区',
  '电话:(0769)87312864                          传真:(0769)87312894',
  '发票', 'S/NNO:', '合约号码', 'INVOICE', 'INVOICE NO.:', '发票号码', 'DATE.',
  'ROYAL REGENT PRODUCTS(ASIA)LIMITED', 'MARKS & NO.\n唛  头', 'CTN NO.\n箱  数',
  'DESCRIPTION OF GOODS\n货 品 名 称', 'QUANTITY\n数  量', 'UNITPRICE\n单  价', 'AMOUNT\n合  计',
]);

describe('public template privacy and generator contract', () => {
  for (const [file, names] of templates) {
    it(`${file}: contains only empty templates and approved static labels`, async () => {
      const zip = await JSZip.loadAsync(await readFile(fileURLToPath(new URL(`../public/${file}`, import.meta.url))));
      const parts = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
      for (const part of parts) {
        expect(part).toMatch(/^(?:\[Content_Types\]\.xml|_rels\/\.rels|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/styles\.xml|xl\/theme\/theme1\.xml|xl\/worksheets\/sheet\d+\.xml)$/);
      }
      const workbook = await zip.file('xl/workbook.xml').async('string');
      expect([...workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"/g)].map((m) => unescapeXml(m[1]))).toEqual(names);
      expect(workbook).not.toMatch(/state="(?:hidden|veryHidden)"/);
      for (const part of parts.filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))) {
        const xml = await zip.file(part).async('string');
        if (file === 'base-master.xlsx' || file.startsWith('other-tpl/')) {
          expect(xml).toMatch(/<c\b[^>]*r="H5"[^>]*>[\s\S]*?<t[^>]*> 330783<\/t>/);
        }
        expect(xml).not.toMatch(/<(?:legacyDrawing|drawing|hyperlinks|extLst)\b/);
        expect(xml).not.toContain('t="s"');
        for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) {
          expect(permittedText.has(unescapeXml(m[1]).trim()), `Unapproved template text in ${file}/${part}`).toBe(true);
        }
        for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const body = m[2] || '';
          const cached = body.match(/<v>([^<]*)<\/v>/);
          if (cached) {
            expect(body).toMatch(/<f>/);
            expect(Number(cached[1])).toBe(0);
            expect(file.startsWith('other-tpl/')).toBe(true);
            expect(m[1]).toMatch(/r="[IL]4[1-6]"/);
          }
        }
      }
    });
  }
});
