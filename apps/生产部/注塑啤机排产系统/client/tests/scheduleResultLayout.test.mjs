import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(testDir, '..', 'src', 'pages', 'ScheduleResult.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceLines = source.split(/\r?\n/);

test('contains every long schedule-detail text field inside its column', () => {
  const longTextFields = [
    'product_code',
    'mold_name',
    'color',
    'color_powder_no',
    'material_type',
    'notes',
    'robot_arm',
    'clamp',
    'mold_change_time',
    'adjuster',
  ];

  for (const field of longTextFields) {
    const definitionLine = sourceLines.find((line) =>
      line.includes(`dataIndex: '${field}'`)
    );

    assert.ok(definitionLine, `missing column definition for ${field}`);
    assert.match(
      definitionLine,
      /ellipsis:\s*true/,
      `${field} must use ellipsis so its text cannot overlap adjacent columns`
    );
  }
});

test('horizontal scroll width covers the declared schedule-detail columns', () => {
  assert.match(
    source,
    /scroll=\{\{\s*x:\s*2200\s*\}\}/,
    'schedule-detail table must reserve at least 2200px for its 2142px of columns'
  );
});
