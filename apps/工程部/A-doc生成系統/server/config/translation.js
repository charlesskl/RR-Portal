const path = require('node:path');

const MB = 1024 * 1024;

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readTranslationConfig(env = process.env, {
  uploadsRoot = path.join(__dirname, '../uploads'),
} = {}) {
  const resolvedUploadsRoot = path.resolve(uploadsRoot);
  return {
    maxFileBytes: positiveInteger(env.MAX_FILE_SIZE_MB, 50) * MB,
    maxUncompressedBytes: positiveInteger(env.TRANSLATION_MAX_UNCOMPRESSED_MB, 512) * MB,
    jobTtlMs: positiveInteger(env.TRANSLATION_JOB_TTL_MS, 3_600_000),
    cleanupIntervalMs: positiveInteger(env.TRANSLATION_CLEANUP_INTERVAL_MS, 600_000),
    batchSize: positiveInteger(env.TRANSLATION_BATCH_SIZE, 25),
    timeoutMs: positiveInteger(env.TRANSLATION_TIMEOUT_MS, 15_000),
    jobsRoot: path.join(resolvedUploadsRoot, 'translation-jobs'),
    incomingDir: path.join(resolvedUploadsRoot, 'translation-incoming'),
  };
}

module.exports = { readTranslationConfig };
