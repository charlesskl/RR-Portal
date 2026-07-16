const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { detectImageMime } = require('../services/qwenOcr');

test('detects uploaded image MIME from bytes when multer removes the extension', () => {
  assert.equal(
    detectImageMime(Buffer.from('89504e470d0a1a0a', 'hex'), 'upload-without-extension'),
    'image/png',
  );
  assert.equal(
    detectImageMime(Buffer.from('ffd8ffdb', 'hex'), 'upload-without-extension'),
    'image/jpeg',
  );
  assert.equal(
    detectImageMime(Buffer.from('524946460000000057454250', 'hex'), 'upload-without-extension'),
    'image/webp',
  );
  assert.equal(
    detectImageMime(Buffer.from('424d0000', 'hex'), 'upload-without-extension'),
    'image/bmp',
  );
});

test('OCR workers do not require untracked local traineddata files', () => {
  for (const filename of ['beihuoImageParser.js', 'imageParser.js']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services', filename), 'utf8');
    assert.doesNotMatch(source, /langPath\s*:/);
    assert.doesNotMatch(source, /gzip\s*:\s*false/);
  }
});
