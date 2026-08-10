const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readTranslationConfig } = require('../config/translation');

test('maps every translation environment variable to production options', () => {
  const uploadsRoot = path.resolve('/tmp/translation-config');
  const config = readTranslationConfig({
    MAX_FILE_SIZE_MB: '12',
    TRANSLATION_MAX_UNCOMPRESSED_MB: '34',
    TRANSLATION_JOB_TTL_MS: '56',
    TRANSLATION_CLEANUP_INTERVAL_MS: '78',
    TRANSLATION_BATCH_SIZE: '9',
    TRANSLATION_TIMEOUT_MS: '10',
  }, { uploadsRoot });

  assert.deepEqual(config, {
    maxFileBytes: 12 * 1024 * 1024,
    maxUncompressedBytes: 34 * 1024 * 1024,
    jobTtlMs: 56,
    cleanupIntervalMs: 78,
    batchSize: 9,
    timeoutMs: 10,
    jobsRoot: path.join(uploadsRoot, 'translation-jobs'),
    incomingDir: path.join(uploadsRoot, 'translation-incoming'),
  });
});

test('falls back for empty, negative, fractional and non-numeric values', () => {
  const uploadsRoot = path.resolve('/tmp/translation-defaults');
  const config = readTranslationConfig({
    MAX_FILE_SIZE_MB: '',
    TRANSLATION_MAX_UNCOMPRESSED_MB: '-1',
    TRANSLATION_JOB_TTL_MS: 'not-a-number',
    TRANSLATION_CLEANUP_INTERVAL_MS: '0',
    TRANSLATION_BATCH_SIZE: '2.5',
    TRANSLATION_TIMEOUT_MS: '-100',
  }, { uploadsRoot });

  assert.equal(config.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(config.maxUncompressedBytes, 512 * 1024 * 1024);
  assert.equal(config.jobTtlMs, 3_600_000);
  assert.equal(config.cleanupIntervalMs, 600_000);
  assert.equal(config.batchSize, 25);
  assert.equal(config.timeoutMs, 15_000);
  for (const directory of [config.jobsRoot, config.incomingDir]) {
    const relative = path.relative(uploadsRoot, directory);
    assert.equal(relative.startsWith('..'), false);
    assert.equal(path.isAbsolute(relative), false);
  }
});
