import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  EXCEL_TRANSLATION_JOB_STORAGE_KEY,
  shouldPoll,
  canStart,
  canDownload,
  progressPercent,
  statusLabel,
  completionNotice,
  initialPageFromStoredTranslationJob,
  observeStoredTranslationJob,
  startFailureRecovery,
  translationControlsLocked,
  createRequestLifecycle,
  persistCreatedTranslationJob,
  readStoredTranslationJob,
  removeStoredTranslationJob,
  translationJobStorageKey,
  writeStoredTranslationJob,
} from './excelTranslateState.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('reopens the translation page when a stored job can be resumed', () => {
  assert.equal(EXCEL_TRANSLATION_JOB_STORAGE_KEY, 'excelTranslationJobId');
  assert.equal(initialPageFromStoredTranslationJob('job-123'), 'excel-translate');
  assert.equal(initialPageFromStoredTranslationJob(null), 'list');
  assert.equal(initialPageFromStoredTranslationJob(''), 'list');
});

test('reconciles an uncertain start result and expires only a missing job', () => {
  assert.equal(startFailureRecovery(undefined), 'reconcile');
  assert.equal(startFailureRecovery(409), 'reconcile');
  assert.equal(startFailureRecovery(404), 'expire');
});

test('locks destructive controls while start state is uncertain or work is active', () => {
  assert.equal(translationControlsLocked({
    job: { status: 'ready' },
    reconcilingStart: true,
  }), true);
  assert.equal(translationControlsLocked({ job: { status: 'translating' } }), true);
  assert.equal(translationControlsLocked({ job: { status: 'ready' }, starting: true }), true);
  assert.equal(translationControlsLocked({ job: { status: 'ready' } }), false);
});

describe('translation job ownership', () => {
  test('keeps A\'s job through logout, B login, and A login again', () => {
    const storage = createMemoryStorage();
    const userA = { id: 'user-a', username: 'alice' };
    const userB = { id: 'user-b', username: 'bob' };
    const keyA = translationJobStorageKey(userA);
    const keyB = translationJobStorageKey(userB);

    writeStoredTranslationJob(storage, keyA, 'job-a');
    assert.equal(readStoredTranslationJob(storage, keyB), null);

    writeStoredTranslationJob(storage, keyB, 'job-b');
    removeStoredTranslationJob(storage, keyB, 'job-b');

    assert.equal(readStoredTranslationJob(storage, keyA), 'job-a');
    assert.equal(
      initialPageFromStoredTranslationJob(readStoredTranslationJob(storage, keyA)),
      'excel-translate',
    );
  });

  test('uses a stable id owner and falls back to a normalized username', () => {
    assert.equal(
      translationJobStorageKey({ id: 42, username: 'Alice' }),
      'excelTranslationJobId:id%3A42',
    );
    assert.equal(
      translationJobStorageKey({ username: ' Alice ' }),
      'excelTranslationJobId:username%3Aalice',
    );
    assert.equal(translationJobStorageKey(null), null);
  });

  test('compare-and-remove never clears a newer task pointer', () => {
    const storage = createMemoryStorage();
    const storageKey = translationJobStorageKey({ id: 'user-a' });
    writeStoredTranslationJob(storage, storageKey, 'job-newer');

    assert.equal(removeStoredTranslationJob(storage, storageKey, 'job-older'), false);
    assert.equal(readStoredTranslationJob(storage, storageKey), 'job-newer');
    assert.equal(removeStoredTranslationJob(storage, storageKey, 'job-newer'), true);
    assert.equal(readStoredTranslationJob(storage, storageKey), null);
  });
});

describe('late translation requests', () => {
  test('reconciles an orphaned upload that finishes between remount snapshot and subscription', () => {
    const storage = createMemoryStorage();
    const storageKey = translationJobStorageKey({ id: 'user-remount-gap' });
    const oldPage = createRequestLifecycle(storageKey);
    oldPage.activate();
    const oldUpload = oldPage.begin();
    oldPage.invalidate();

    const remountedPageSnapshot = readStoredTranslationJob(storage, storageKey);
    assert.equal(remountedPageSnapshot, null);
    assert.equal(oldPage.shouldPersistCreatedJob(oldUpload), true);
    assert.equal(persistCreatedTranslationJob({
      storage,
      storageKey,
      expectedJobId: remountedPageSnapshot,
      createdJobId: 'job-created-in-remount-gap',
    }), true);

    const observedJobIds = [];
    const unsubscribe = observeStoredTranslationJob(
      storage,
      storageKey,
      jobId => observedJobIds.push(jobId),
    );

    assert.deepEqual(observedJobIds, ['job-created-in-remount-gap']);
    unsubscribe();
  });

  test('job observers are owner scoped, compare-safe, and removed on unmount', () => {
    const storage = createMemoryStorage();
    const keyA = translationJobStorageKey({ id: 'user-a' });
    const keyB = translationJobStorageKey({ id: 'user-b' });
    const observedA = [];
    const observedB = [];
    const unsubscribeA = observeStoredTranslationJob(
      storage,
      keyA,
      jobId => observedA.push(jobId),
    );
    const unsubscribeB = observeStoredTranslationJob(
      storage,
      keyB,
      jobId => observedB.push(jobId),
    );

    assert.equal(persistCreatedTranslationJob({
      storage,
      storageKey: keyA,
      expectedJobId: null,
      createdJobId: 'job-a',
    }), true);
    assert.equal(persistCreatedTranslationJob({
      storage,
      storageKey: keyA,
      expectedJobId: null,
      createdJobId: 'job-a-superseded',
    }), false);

    assert.deepEqual(observedA, [null, 'job-a']);
    assert.deepEqual(observedB, [null]);

    unsubscribeA();
    assert.equal(removeStoredTranslationJob(storage, keyA, 'job-a'), true);
    assert.deepEqual(observedA, [null, 'job-a']);

    assert.equal(writeStoredTranslationJob(storage, keyB, 'job-b'), true);
    assert.deepEqual(observedB, [null, 'job-b']);
    unsubscribeB();
  });

  test('preserves an orphaned upload for its owner after the page unmounts', () => {
    const storage = createMemoryStorage();
    const storageKey = translationJobStorageKey({ id: 'user-a' });
    const lifecycle = createRequestLifecycle();
    lifecycle.activate();
    const request = lifecycle.begin();
    lifecycle.invalidate();

    assert.equal(lifecycle.isCurrent(request), false);
    assert.equal(persistCreatedTranslationJob({
      storage,
      storageKey,
      expectedJobId: null,
      createdJobId: 'job-created-after-unmount',
    }), true);
    assert.equal(
      readStoredTranslationJob(storage, storageKey),
      'job-created-after-unmount',
    );
  });

  test('does not let a late upload overwrite a newer task pointer', () => {
    const storage = createMemoryStorage();
    const storageKey = translationJobStorageKey({ id: 'user-a' });

    writeStoredTranslationJob(storage, storageKey, 'job-newer');

    assert.equal(persistCreatedTranslationJob({
      storage,
      storageKey,
      expectedJobId: null,
      createdJobId: 'job-older-late-response',
    }), false);
    assert.equal(readStoredTranslationJob(storage, storageKey), 'job-newer');
  });

  test('allows UI updates only for the latest request while mounted', () => {
    const lifecycle = createRequestLifecycle();
    lifecycle.activate();
    const olderRequest = lifecycle.begin();
    const latestRequest = lifecycle.begin();

    assert.equal(lifecycle.isCurrent(olderRequest), false);
    assert.equal(lifecycle.isCurrent(latestRequest), true);

    lifecycle.invalidate();
    assert.equal(lifecycle.isCurrent(latestRequest), false);
  });

  test('a remounted page request supersedes the old page before either response returns', () => {
    const storageKey = translationJobStorageKey({ id: 'user-remount' });
    const oldPage = createRequestLifecycle(storageKey);
    oldPage.activate();
    const oldUpload = oldPage.begin();
    oldPage.invalidate();

    const newPage = createRequestLifecycle(storageKey);
    newPage.activate();
    const newUpload = newPage.begin();

    assert.equal(oldPage.shouldPersistCreatedJob(oldUpload), false);
    assert.equal(newPage.shouldPersistCreatedJob(newUpload), true);
  });
});

test('polls active work and stops for ready or terminal jobs', () => {
  for (const status of ['scanning', 'queued', 'translating', 'writing', 'validating']) {
    assert.equal(shouldPoll({ status }), true, status);
  }
  for (const status of ['ready', 'completed', 'completed_with_warnings', 'failed']) {
    assert.equal(shouldPoll({ status }), false, status);
  }
});

test('starts only a ready job with candidates and downloads only completed jobs', () => {
  assert.equal(canStart({ status: 'ready', candidateUniqueCount: 1 }), true);
  assert.equal(canStart({ status: 'ready', candidateUniqueCount: 0 }), false);
  assert.equal(canStart({ status: 'scanning', candidateUniqueCount: 4 }), false);
  assert.equal(canDownload({ status: 'completed' }), true);
  assert.equal(canDownload({ status: 'completed_with_warnings' }), true);
  assert.equal(canDownload({ status: 'failed' }), false);
});

test('derives monotonic phase progress from unique text counts', () => {
  assert.equal(progressPercent({ status: 'translating', processedUnique: 1, totalUnique: 4 }), 23);
  assert.equal(progressPercent({ status: 'translating', processedUnique: 4, totalUnique: 4 }), 90);
  assert.equal(progressPercent({ status: 'writing', processedUnique: 0, totalUnique: 4 }), 95);
  assert.equal(progressPercent({ status: 'validating' }), 98);
  assert.equal(progressPercent({ status: 'completed' }), 100);
  assert.equal(progressPercent({ status: 'completed_with_warnings' }), 100);
});

test('uses stable Chinese status labels', () => {
  assert.equal(statusLabel({ status: 'scanning' }), '上传扫描');
  assert.equal(statusLabel({ status: 'ready' }), '等待开始');
  assert.equal(statusLabel({ status: 'queued' }), '排队中');
  assert.equal(statusLabel({ status: 'translating' }), '翻译中');
  assert.equal(statusLabel({ status: 'writing' }), '写入文件');
  assert.equal(statusLabel({ status: 'validating' }), '校验文件');
  assert.equal(statusLabel({ status: 'completed' }), '已完成');
  assert.equal(statusLabel({ status: 'completed_with_warnings' }), '部分完成');
  assert.equal(statusLabel({ status: 'failed' }), '失败');
});

test('explains a completed output where language detection skipped every candidate', () => {
  assert.equal(completionNotice({
    status: 'completed',
    succeededCells: 0,
    failedCells: 0,
    skippedCells: 3,
  }), '没有新增翻译，文件已保持原样');
  assert.equal(completionNotice({
    status: 'completed',
    succeededCells: 2,
    failedCells: 0,
    skippedCells: 1,
  }), '翻译完成，可以下载文件');
  assert.equal(completionNotice({ status: 'translating' }), null);
});
