const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createTranslationJobManager,
  JobConflictError,
  JobNotFoundError,
} = require('../utils/translationJobManager');

const SCAN_SUMMARY = {
  sheetCount: 3,
  formulaCount: 1,
  candidateCellCount: 5,
  candidateUniqueCount: 4,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(manager, ownerId, jobId, predicate, description) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = manager.getJob(ownerId, jobId);
    if (predicate(view)) return view;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`job ${jobId} did not reach ${description}`);
}

function waitForStatus(manager, ownerId, jobId, status) {
  return waitFor(manager, ownerId, jobId, view => view.status === status, status);
}

function waitForPhase(manager, ownerId, jobId, phase) {
  return waitFor(manager, ownerId, jobId, view => view.phase === phase, phase);
}

async function createHarness(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'translation-jobs-'));
  const jobsRoot = path.join(root, 'jobs');
  const incomingDir = path.join(root, 'incoming');
  await fs.mkdir(incomingDir, { recursive: true });
  let now = 1_700_000_000_000;
  let id = 0;
  const translationSummaries = [...(overrides.translationSummaries || [])];
  const manager = createTranslationJobManager({
    jobsRoot,
    incomingDir,
    clock: () => now,
    idFactory: () => `job-${++id}`,
    ttlMs: 3_600_000,
    cleanupIntervalMs: 60_000,
    operationTimeoutMs: overrides.operationTimeoutMs,
    queueTtlMs: overrides.queueTtlMs,
    maxJobs: overrides.maxJobs,
    maxJobsPerOwner: overrides.maxJobsPerOwner,
    scanWorkbook: overrides.scanWorkbook || (async () => SCAN_SUMMARY),
    translateWorkbook: overrides.translateWorkbook || (async (inputPath, outputPath) => {
      await fs.writeFile(outputPath, 'translated');
      return translationSummaries.shift() || {
        totalUnique: 4,
        processedUnique: 4,
        succeededCells: 5,
        skippedCells: 0,
        failedCells: 0,
        changedCells: new Set(['Visible!A1']),
      };
    }),
  });

  async function createIncoming(name = `sample-${id + 1}.xlsx`) {
    const incomingPath = path.join(incomingDir, name);
    await fs.writeFile(incomingPath, 'input');
    return incomingPath;
  }

  t.after(async () => {
    manager.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    jobsRoot,
    incomingDir,
    manager,
    createIncoming,
    advance(milliseconds) { now += milliseconds; },
  };
}

async function createReadyJob(harness, {
  ownerId = 'owner-a',
  originalName = 'sample.xlsx',
  extension = '.xlsx',
} = {}) {
  const incomingPath = await harness.createIncoming(originalName);
  const created = await harness.manager.createJob({
    ownerId,
    incomingPath,
    originalName,
    extension,
  });
  return waitForStatus(harness.manager, ownerId, created.jobId, 'ready');
}

async function createCompletedJob(harness, options) {
  const ready = await createReadyJob(harness, options);
  harness.manager.startJob(options && options.ownerId ? options.ownerId : 'owner-a', ready.jobId);
  return waitForStatus(
    harness.manager,
    options && options.ownerId ? options.ownerId : 'owner-a',
    ready.jobId,
    'completed',
  );
}

test('moves scanning to ready and exposes only safe summary fields', async t => {
  const scanGate = deferred();
  const harness = await createHarness(t, {
    scanWorkbook: async () => scanGate.promise,
  });
  const incomingPath = await harness.createIncoming('sample.xlsx');
  const created = await harness.manager.createJob({
    ownerId: 'owner-a',
    incomingPath,
    originalName: 'sample.xlsx',
    extension: '.xlsx',
  });

  assert.equal(created.status, 'scanning');
  assert.throws(
    () => harness.manager.startJob('owner-a', created.jobId),
    JobConflictError,
  );
  scanGate.resolve(SCAN_SUMMARY);
  const ready = await waitForStatus(harness.manager, 'owner-a', created.jobId, 'ready');
  assert.equal(ready.sheetCount, 3);
  for (const privateKey of ['ownerId', 'inputPath', 'outputPath']) {
    assert.equal(Object.hasOwn(ready, privateKey), false);
  }
  assert.deepEqual(Object.keys(ready), [
    'jobId', 'status', 'phase', 'originalName', 'downloadName',
    'sheetCount', 'formulaCount', 'candidateCellCount', 'candidateUniqueCount',
    'totalUnique', 'processedUnique', 'succeededCells', 'skippedCells', 'failedCells',
    'currentSheet', 'errorCode', 'errorMessage', 'createdAt', 'expiresAt',
  ]);
});

test('returns not-found for another owner', async t => {
  const harness = await createHarness(t);
  const ready = await createReadyJob(harness);
  assert.throws(
    () => harness.manager.getJob('owner-b', ready.jobId),
    JobNotFoundError,
  );
});

test('runs scan operations one at a time', async t => {
  const gates = [deferred(), deferred()];
  const scanCalls = [];
  const harness = await createHarness(t, {
    scanWorkbook: async inputPath => {
      const index = scanCalls.length;
      scanCalls.push(inputPath);
      return gates[index].promise;
    },
  });
  const firstPath = await harness.createIncoming('first.xlsx');
  const secondPath = await harness.createIncoming('second.xlsx');
  const first = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: firstPath,
    originalName: 'first.xlsx', extension: '.xlsx',
  });
  const second = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: secondPath,
    originalName: 'second.xlsx', extension: '.xlsx',
  });

  assert.equal(scanCalls.length, 1);
  assert.equal(harness.manager.getJob('owner-a', second.jobId).status, 'queued');
  gates[0].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', first.jobId, 'ready');
  await waitForStatus(harness.manager, 'owner-a', second.jobId, 'scanning');
  assert.equal(scanCalls.length, 2);
  gates[1].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', second.jobId, 'ready');
});

test('times out a stalled operation and continues draining the queue', async t => {
  const stalled = deferred();
  let scanCalls = 0;
  const harness = await createHarness(t, {
    operationTimeoutMs: 10,
    scanWorkbook: async () => {
      scanCalls += 1;
      return scanCalls === 1 ? stalled.promise : SCAN_SUMMARY;
    },
  });
  const firstPath = await harness.createIncoming('stalled.xlsx');
  const secondPath = await harness.createIncoming('next.xlsx');
  const first = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: firstPath,
    originalName: 'stalled.xlsx', extension: '.xlsx',
  });
  const second = await harness.manager.createJob({
    ownerId: 'owner-b', incomingPath: secondPath,
    originalName: 'next.xlsx', extension: '.xlsx',
  });

  await new Promise(resolve => setTimeout(resolve, 25));
  const failed = await waitForStatus(harness.manager, 'owner-a', first.jobId, 'failed');
  assert.equal(failed.errorCode, 'operation_timeout');
  await waitForStatus(harness.manager, 'owner-b', second.jobId, 'ready');
  assert.equal(scanCalls, 2);
  stalled.resolve(SCAN_SUMMARY);
});

test('ignores late translation progress and removes output written after timeout', async t => {
  const translationGate = deferred();
  const translationSettled = deferred();
  const harness = await createHarness(t, {
    operationTimeoutMs: 10,
    translateWorkbook: async (inputPath, outputPath, { onProgress }) => {
      try {
        onProgress({ phase: 'translating', processedUnique: 1 });
        await translationGate.promise;
        onProgress({ phase: 'writing', processedUnique: 99, sheetName: 'Late' });
        await fs.writeFile(outputPath, 'late-output');
        return { succeededCells: 99, failedCells: 0, processedUnique: 99 };
      } finally {
        translationSettled.resolve();
      }
    },
  });
  const ready = await createReadyJob(harness);
  harness.manager.startJob('owner-a', ready.jobId);
  await new Promise(resolve => setTimeout(resolve, 25));
  const failed = await waitForStatus(harness.manager, 'owner-a', ready.jobId, 'failed');
  assert.equal(failed.errorCode, 'operation_timeout');
  assert.equal(failed.processedUnique, 1);

  translationGate.resolve();
  await translationSettled.promise;
  await new Promise(resolve => setImmediate(resolve));
  const outputPath = path.join(harness.jobsRoot, ready.jobId, 'output.xlsx');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const missing = await fs.access(outputPath).then(() => false, () => true);
    if (missing) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  await assert.rejects(fs.access(outputPath), error => error.code === 'ENOENT');
  const stillFailed = harness.manager.getJob('owner-a', ready.jobId);
  assert.equal(stillFailed.status, 'failed');
  assert.equal(stillFailed.processedUnique, 1);
});

test('bounds retained jobs globally and per owner', async t => {
  const gates = [deferred(), deferred()];
  let scanIndex = 0;
  const harness = await createHarness(t, {
    maxJobs: 2,
    maxJobsPerOwner: 1,
    scanWorkbook: async () => gates[scanIndex++].promise,
  });
  const firstPath = await harness.createIncoming('first.xlsx');
  const first = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: firstPath,
    originalName: 'first.xlsx', extension: '.xlsx',
  });

  const sameOwnerPath = await harness.createIncoming('same-owner.xlsx');
  await assert.rejects(
    harness.manager.createJob({
      ownerId: 'owner-a', incomingPath: sameOwnerPath,
      originalName: 'same-owner.xlsx', extension: '.xlsx',
    }),
    error => error instanceof JobConflictError && error.code === 'job_capacity_reached',
  );
  assert.equal(await fs.readFile(sameOwnerPath, 'utf8'), 'input');

  const secondPath = await harness.createIncoming('second.xlsx');
  const second = await harness.manager.createJob({
    ownerId: 'owner-b', incomingPath: secondPath,
    originalName: 'second.xlsx', extension: '.xlsx',
  });
  const overGlobalPath = await harness.createIncoming('over-global.xlsx');
  await assert.rejects(
    harness.manager.createJob({
      ownerId: 'owner-c', incomingPath: overGlobalPath,
      originalName: 'over-global.xlsx', extension: '.xlsx',
    }),
    error => error instanceof JobConflictError && error.code === 'job_capacity_reached',
  );

  gates[0].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', first.jobId, 'ready');
  gates[1].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-b', second.jobId, 'ready');
});

test('expires queued jobs that wait beyond the queue lifetime', async t => {
  const firstGate = deferred();
  let calls = 0;
  const harness = await createHarness(t, {
    operationTimeoutMs: 60_000,
    queueTtlMs: 100,
    scanWorkbook: async () => {
      calls += 1;
      return calls === 1 ? firstGate.promise : SCAN_SUMMARY;
    },
  });
  const firstPath = await harness.createIncoming('active.xlsx');
  const queuedPath = await harness.createIncoming('queued.xlsx');
  const first = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: firstPath,
    originalName: 'active.xlsx', extension: '.xlsx',
  });
  const queued = await harness.manager.createJob({
    ownerId: 'owner-b', incomingPath: queuedPath,
    originalName: 'queued.xlsx', extension: '.xlsx',
  });

  harness.advance(101);
  assert.equal(await harness.manager.sweepExpired(), 1);
  assert.throws(
    () => harness.manager.getJob('owner-b', queued.jobId),
    JobNotFoundError,
  );
  firstGate.resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', first.jobId, 'ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('maps translation summaries to downloadable and failed terminal states', async t => {
  const harness = await createHarness(t, {
    translationSummaries: [
      { succeededCells: 5, skippedCells: 0, failedCells: 0 },
      { succeededCells: 4, skippedCells: 0, failedCells: 1 },
      { succeededCells: 0, skippedCells: 0, failedCells: 2 },
      { succeededCells: 0, skippedCells: 3, failedCells: 0 },
    ],
  });
  const cases = [
    ['completed.xlsx', 'completed', true],
    ['warnings.xlsm', 'completed_with_warnings', true],
    ['failed.xlsx', 'failed', false],
    ['already-complete.xlsx', 'completed', true],
  ];

  for (const [originalName, expectedStatus, downloadable] of cases) {
    const extension = path.extname(originalName);
    const ready = await createReadyJob(harness, { originalName, extension });
    assert.throws(
      () => harness.manager.getDownload('owner-a', ready.jobId),
      JobConflictError,
    );
    harness.manager.startJob('owner-a', ready.jobId);
    const terminal = await waitForStatus(
      harness.manager,
      'owner-a',
      ready.jobId,
      expectedStatus,
    );
    if (downloadable) {
      const download = harness.manager.getDownload('owner-a', ready.jobId);
      assert.equal(download.fileName, `${path.parse(originalName).name}_中英翻译${extension}`);
      assert.match(download.contentType, extension === '.xlsm' ? /macroEnabled/ : /spreadsheetml/);
      assert.equal(terminal.errorCode, null);
    } else {
      assert.throws(
        () => harness.manager.getDownload('owner-a', ready.jobId),
        JobConflictError,
      );
      assert.equal(terminal.errorCode, 'translation_failed');
    }
  }
});

test('does not expire active scanning, translating, writing or validating work', async t => {
  const scanGates = [deferred(), deferred()];
  let scanIndex = 0;
  const translateGates = [deferred(), deferred(), deferred()];
  const harness = await createHarness(t, {
    queueTtlMs: 7_200_000,
    scanWorkbook: async () => scanGates[scanIndex++].promise,
    translateWorkbook: async (inputPath, outputPath, { onProgress }) => {
      onProgress({ phase: 'translating' });
      await translateGates[0].promise;
      onProgress({ phase: 'writing', sheetName: 'Visible' });
      await translateGates[1].promise;
      onProgress({ phase: 'validating' });
      await translateGates[2].promise;
      await fs.writeFile(outputPath, 'translated');
      return { succeededCells: 1, skippedCells: 0, failedCells: 0 };
    },
  });
  const firstPath = await harness.createIncoming('running.xlsx');
  const queuedPath = await harness.createIncoming('queued.xlsx');
  const first = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: firstPath,
    originalName: 'running.xlsx', extension: '.xlsx',
  });
  const queued = await harness.manager.createJob({
    ownerId: 'owner-a', incomingPath: queuedPath,
    originalName: 'queued.xlsx', extension: '.xlsx',
  });
  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 0);
  assert.equal(harness.manager.getJob('owner-a', first.jobId).status, 'scanning');
  assert.equal(harness.manager.getJob('owner-a', queued.jobId).status, 'queued');

  scanGates[0].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', first.jobId, 'ready');
  scanGates[1].resolve(SCAN_SUMMARY);
  await waitForStatus(harness.manager, 'owner-a', queued.jobId, 'ready');
  harness.manager.startJob('owner-a', first.jobId);

  let active = await waitForPhase(harness.manager, 'owner-a', first.jobId, 'translating');
  assert.equal(active.currentSheet, null);
  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 1);
  assert.equal(harness.manager.getJob('owner-a', first.jobId).status, 'translating');

  translateGates[0].resolve();
  active = await waitForPhase(harness.manager, 'owner-a', first.jobId, 'writing');
  assert.equal(active.currentSheet, 'Visible');
  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 0);

  translateGates[1].resolve();
  active = await waitForPhase(harness.manager, 'owner-a', first.jobId, 'validating');
  assert.equal(active.currentSheet, null);
  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 0);
  translateGates[2].resolve();
  await waitForStatus(harness.manager, 'owner-a', first.jobId, 'completed');
});

test('expires ready and every terminal state after one hour', async t => {
  const harness = await createHarness(t, {
    translationSummaries: [
      { succeededCells: 1, skippedCells: 0, failedCells: 0 },
      { succeededCells: 1, skippedCells: 0, failedCells: 1 },
      { succeededCells: 0, skippedCells: 0, failedCells: 1 },
    ],
  });
  const jobs = [];
  for (const expected of ['completed', 'completed_with_warnings', 'failed']) {
    const ready = await createReadyJob(harness);
    harness.manager.startJob('owner-a', ready.jobId);
    jobs.push(await waitForStatus(harness.manager, 'owner-a', ready.jobId, expected));
  }
  jobs.push(await createReadyJob(harness));

  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 4);
  for (const job of jobs) {
    assert.throws(
      () => harness.manager.getJob('owner-a', job.jobId),
      JobNotFoundError,
    );
  }
});

test('sweep claims an expired job before waiting for directory deletion', async t => {
  const harness = await createHarness(t);
  const ready = await createReadyJob(harness);
  const deletionStarted = deferred();
  const allowDeletion = deferred();
  const originalRm = fs.rm;
  fs.rm = async (target, options) => {
    if (target === path.join(harness.jobsRoot, ready.jobId)) {
      deletionStarted.resolve();
      await allowDeletion.promise;
    }
    return originalRm(target, options);
  };

  try {
    harness.advance(3_600_001);
    const sweep = harness.manager.sweepExpired();
    await deletionStarted.promise;

    assert.throws(
      () => harness.manager.startJob('owner-a', ready.jobId),
      JobNotFoundError,
    );

    allowDeletion.resolve();
    assert.equal(await sweep, 1);
  } finally {
    allowDeletion.resolve();
    fs.rm = originalRm;
  }
});

test('start rejects an already-expired ready job before a sweep runs', async t => {
  const harness = await createHarness(t);
  const ready = await createReadyJob(harness);
  harness.advance(3_600_000);

  assert.throws(
    () => harness.manager.startJob('owner-a', ready.jobId),
    JobNotFoundError,
  );
  assert.throws(
    () => harness.manager.getJob('owner-a', ready.jobId),
    JobNotFoundError,
  );
});

test('acquiring a download lease does not extend the job expiry', async t => {
  const harness = await createHarness(t);
  const completed = await createCompletedJob(harness);
  harness.advance(1_800_000);

  const download = harness.manager.acquireDownload('owner-a', completed.jobId);

  assert.equal(
    harness.manager.getJob('owner-a', completed.jobId).expiresAt,
    completed.expiresAt,
  );
  await download.release();
});

test('an expired download stays on disk until its lease is released', async t => {
  const harness = await createHarness(t);
  const completed = await createCompletedJob(harness);
  const jobDirectory = path.join(harness.jobsRoot, completed.jobId);
  const outputPath = path.join(jobDirectory, 'output.xlsx');
  const download = harness.manager.acquireDownload('owner-a', completed.jobId);
  harness.advance(3_600_001);

  assert.equal(await harness.manager.sweepExpired(), 1);
  assert.throws(
    () => harness.manager.getJob('owner-a', completed.jobId),
    JobNotFoundError,
  );
  assert.equal(await fs.readFile(outputPath, 'utf8'), 'translated');

  await download.release();
  await assert.rejects(fs.access(jobDirectory), error => error.code === 'ENOENT');
});

test('cleanup waits for every active download lease', async t => {
  const harness = await createHarness(t);
  const completed = await createCompletedJob(harness);
  const jobDirectory = path.join(harness.jobsRoot, completed.jobId);
  const first = harness.manager.acquireDownload('owner-a', completed.jobId);
  const second = harness.manager.acquireDownload('owner-a', completed.jobId);
  harness.advance(3_600_001);
  await harness.manager.sweepExpired();

  await first.release();
  assert.equal(await fs.stat(jobDirectory).then(() => true), true);

  await second.release();
  await assert.rejects(fs.access(jobDirectory), error => error.code === 'ENOENT');
});

test('download leases preserve job ownership isolation', async t => {
  const harness = await createHarness(t);
  const completed = await createCompletedJob(harness);

  assert.throws(
    () => harness.manager.acquireDownload('owner-b', completed.jobId),
    JobNotFoundError,
  );

  harness.advance(3_600_001);
  assert.equal(await harness.manager.sweepExpired(), 1);
  await assert.rejects(
    fs.access(path.join(harness.jobsRoot, completed.jobId)),
    error => error.code === 'ENOENT',
  );
});
