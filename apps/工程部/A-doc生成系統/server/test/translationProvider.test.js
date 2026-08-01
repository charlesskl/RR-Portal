const test = require('node:test');
const assert = require('node:assert/strict');

const { createTranslationProvider } = require('../utils/translationProvider');

const detected = iso => ({ from: { language: { iso } } });
const silentLogger = { warn() {} };

test('groups equal language pairs into batches and preserves request ids', async () => {
  const calls = [];
  const provider = createTranslationProvider({
    translateFn: async (texts, opts) => {
      calls.push({ texts, opts });
      return texts.map(text => ({ text: `T:${text}`, ...detected('zh-CN') }));
    },
    batchSize: 2,
    sleep: async () => {},
    logger: silentLogger,
  });
  const result = await provider.translateMany([
    { id: 'r1', text: '甲', from: 'zh-CN', to: 'en' },
    { id: 'r2', text: '乙', from: 'zh-CN', to: 'en' },
    { id: 'r3', text: '丙', from: 'zh-CN', to: 'en' },
    { id: 'r4', text: 'Truck', from: 'en', to: 'zh-CN' },
  ]);

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].texts, ['甲', '乙']);
  assert.equal(calls[0].opts.from, 'zh-CN');
  assert.equal(calls[0].opts.to, 'en');
  assert.ok(calls.every(call => (
    call.opts.requestOptions?.signal instanceof AbortSignal
  )));
  assert.equal(result.get('r1').text, 'T:甲');
  assert.equal(result.get('r1').detectedLanguage, 'zh-CN');
  assert.equal(result.get('r4').text, 'T:Truck');
});

test('retries twice with backoff before a successful third attempt', async () => {
  let attempts = 0;
  const delays = [];
  const provider = createTranslationProvider({
    translateFn: async texts => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('temporary outage');
      return texts.map(text => ({ text: `OK:${text}`, ...detected('en') }));
    },
    sleep: async milliseconds => delays.push(milliseconds),
    logger: silentLogger,
  });

  const result = await provider.translateMany([
    { id: 'retry-me', text: 'Truck', from: 'auto', to: 'zh-CN' },
  ]);

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
  assert.equal(result.get('retry-me').text, 'OK:Truck');
});

test('falls back to individual requests and isolates a final item failure', async () => {
  const warningData = [];
  const provider = createTranslationProvider({
    translateFn: async texts => {
      if (Array.isArray(texts)) throw new Error('batch unavailable');
      if (texts === 'bad secret text') throw new RangeError('single unavailable');
      return { text: `OK:${texts}`, ...detected('zh-CN') };
    },
    sleep: async () => {},
    logger: { warn: (...args) => warningData.push(args) },
  });

  const result = await provider.translateMany([
    { id: 'good', text: 'good secret text', from: 'auto', to: 'en' },
    { id: 'bad', text: 'bad secret text', from: 'auto', to: 'en' },
  ]);

  assert.equal(result.get('good').text, 'OK:good secret text');
  assert.deepEqual(result.get('bad'), { error: 'translation_failed' });
  const logs = JSON.stringify(warningData);
  assert.equal(logs.includes('good secret text'), false);
  assert.equal(logs.includes('bad secret text'), false);
  assert.match(logs, /RangeError/);
});

test('times out stalled batch and individual calls', async () => {
  const provider = createTranslationProvider({
    translateFn: async (_texts, options) => new Promise((resolve, reject) => {
      const signal = options.requestOptions && options.requestOptions.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => {
        const error = new Error('request aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    timeoutMs: 5,
    retryCount: 0,
    sleep: async () => {},
    logger: silentLogger,
  });
  const startedAt = Date.now();
  const result = await provider.translateMany([
    { id: 'slow', text: 'Slow', from: 'auto', to: 'zh-CN' },
  ]);

  assert.deepEqual(result.get('slow'), { error: 'translation_failed' });
  assert.ok(Date.now() - startedAt < 200);
});

test('continues after a bounded abort grace when the request ignores abort', async () => {
  let calls = 0;
  const provider = createTranslationProvider({
    translateFn: async () => {
      calls += 1;
      return new Promise(() => {});
    },
    timeoutMs: 5,
    abortGraceMs: 5,
    retryCount: 0,
    sleep: async () => {},
    logger: silentLogger,
  });
  const startedAt = Date.now();
  const result = await provider.translateMany([
    { id: 'ignores-abort', text: 'Slow', from: 'auto', to: 'zh-CN' },
  ]);

  assert.deepEqual(result.get('ignores-abort'), { error: 'translation_failed' });
  assert.equal(calls, 2); // one batch attempt, then one isolated fallback attempt
  assert.ok(Date.now() - startedAt < 200);
});

test('aborts and settles a timed-out request before starting its retry', async () => {
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  let aborts = 0;
  let settlements = 0;
  const order = [];
  const provider = createTranslationProvider({
    translateFn: (texts, options) => {
      attempts += 1;
      const attempt = attempts;
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(`start-${attempt}`);

      if (attempt > 1) {
        active -= 1;
        return Promise.resolve(
          texts.map(text => ({ text: `OK:${text}`, ...detected('en') })),
        );
      }

      return new Promise((resolve, reject) => {
        const signal = options.requestOptions && options.requestOptions.signal;
        if (!signal) return;
        signal.addEventListener('abort', () => {
          aborts += 1;
          order.push(`abort-${attempt}`);
          setImmediate(() => {
            active -= 1;
            settlements += 1;
            order.push(`settle-${attempt}`);
            const error = new Error('request aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }, { once: true });
      });
    },
    timeoutMs: 5,
    retryCount: 1,
    sleep: async () => {},
    logger: silentLogger,
  });

  const result = await provider.translateMany([
    { id: 'retry-after-timeout', text: 'Truck', from: 'auto', to: 'zh-CN' },
  ]);

  assert.equal(result.get('retry-after-timeout').text, 'OK:Truck');
  assert.equal(attempts, 2);
  assert.equal(aborts, 1);
  assert.equal(settlements, 1);
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['start-1', 'abort-1', 'settle-1', 'start-2']);
});

test('settles a timed-out batch before starting individual fallback', async () => {
  let active = 0;
  let maxActive = 0;
  let batchAborts = 0;
  let batchSettlements = 0;
  const provider = createTranslationProvider({
    translateFn: (texts, options) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (!Array.isArray(texts)) {
        active -= 1;
        return Promise.resolve({ text: `OK:${texts}`, ...detected('en') });
      }

      return new Promise((resolve, reject) => {
        const signal = options.requestOptions && options.requestOptions.signal;
        if (!signal) return;
        signal.addEventListener('abort', () => {
          batchAborts += 1;
          setImmediate(() => {
            active -= 1;
            batchSettlements += 1;
            const error = new Error('batch aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }, { once: true });
      });
    },
    timeoutMs: 5,
    retryCount: 0,
    sleep: async () => {},
    logger: silentLogger,
  });

  const result = await provider.translateMany([
    { id: 'fallback-after-timeout', text: 'Truck', from: 'auto', to: 'zh-CN' },
  ]);

  assert.equal(result.get('fallback-after-timeout').text, 'OK:Truck');
  assert.equal(batchAborts, 1);
  assert.equal(batchSettlements, 1);
  assert.equal(maxActive, 1);
});
