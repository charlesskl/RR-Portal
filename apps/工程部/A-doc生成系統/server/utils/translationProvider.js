class TranslationTimeoutError extends Error {
  constructor() {
    super('translation_timeout');
    this.name = 'TranslationTimeoutError';
  }
}

function errorType(error) {
  return error && typeof error.name === 'string' ? error.name : 'Error';
}

function detectedLanguage(result) {
  return result
    && result.from
    && result.from.language
    && result.from.language.iso;
}

function createTranslationProvider({
  translateFn = require('google-translate-api-x'),
  batchSize = 25,
  timeoutMs = 15_000,
  retryCount = 2,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  logger = console,
} = {}) {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const safeRetryCount = Math.max(0, Math.floor(retryCount));

  async function withTimeout(operation) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new TranslationTimeoutError()), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function withRetries(operation) {
    let lastError;
    for (let attempt = 0; attempt <= safeRetryCount; attempt += 1) {
      try {
        return await withTimeout(operation);
      } catch (error) {
        lastError = error;
        if (attempt < safeRetryCount) {
          await sleep(250 * (2 ** attempt));
        }
      }
    }
    throw lastError;
  }

  function normalizeBatch(raw, expectedLength) {
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length !== expectedLength) {
      const error = new Error('translation_result_mismatch');
      error.name = 'TranslationResultError';
      throw error;
    }
    return values;
  }

  function saveSuccess(results, request, translated) {
    if (!translated || typeof translated.text !== 'string') {
      const error = new Error('translation_result_invalid');
      error.name = 'TranslationResultError';
      throw error;
    }
    results.set(request.id, {
      text: translated.text,
      detectedLanguage: detectedLanguage(translated),
    });
  }

  async function translateChunk(chunk, languagePair, results) {
    try {
      const raw = await withRetries(() => translateFn(
        chunk.map(request => request.text),
        languagePair,
      ));
      const translated = normalizeBatch(raw, chunk.length);
      chunk.forEach((request, index) => saveSuccess(results, request, translated[index]));
      return;
    } catch (error) {
      logger.warn('translation_batch_failed', {
        size: chunk.length,
        target: languagePair.to,
        errorType: errorType(error),
      });
    }

    for (const request of chunk) {
      try {
        const raw = await withRetries(() => translateFn(request.text, languagePair));
        const translated = normalizeBatch(raw, 1);
        saveSuccess(results, request, translated[0]);
      } catch (error) {
        logger.warn('translation_item_failed', {
          size: 1,
          target: languagePair.to,
          errorType: errorType(error),
        });
        results.set(request.id, { error: 'translation_failed' });
      }
    }
  }

  async function translateMany(requests) {
    const results = new Map();
    const groups = new Map();
    for (const request of requests) {
      const key = `${request.from}\u0000${request.to}`;
      if (!groups.has(key)) {
        groups.set(key, {
          languagePair: { from: request.from, to: request.to },
          requests: [],
        });
      }
      groups.get(key).requests.push(request);
    }

    for (const group of groups.values()) {
      for (let index = 0; index < group.requests.length; index += safeBatchSize) {
        const chunk = group.requests.slice(index, index + safeBatchSize);
        await translateChunk(chunk, group.languagePair, results);
      }
    }
    return results;
  }

  return { translateMany };
}

module.exports = {
  createTranslationProvider,
  TranslationTimeoutError,
};
