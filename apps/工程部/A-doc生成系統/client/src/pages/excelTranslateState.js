const ACTIVE_STATUSES = new Set([
  'scanning',
  'queued',
  'translating',
  'writing',
  'validating',
]);

export const EXCEL_TRANSLATION_JOB_STORAGE_KEY = 'excelTranslationJobId';

const storedJobObserversByStorage = new WeakMap();

function notifyStoredTranslationJob(storage, storageKey) {
  const observers = storedJobObserversByStorage.get(storage)?.get(storageKey);
  if (!observers) return;
  const jobId = readStoredTranslationJob(storage, storageKey);
  for (const observer of [...observers]) observer(jobId);
}

export function translationJobStorageKey(user) {
  const id = user?.id;
  const username = typeof user?.username === 'string' ? user.username.trim().toLowerCase() : '';
  const owner = id !== undefined && id !== null && String(id) !== ''
    ? `id:${id}`
    : username && `username:${username}`;
  return owner ? `${EXCEL_TRANSLATION_JOB_STORAGE_KEY}:${encodeURIComponent(owner)}` : null;
}

export function readStoredTranslationJob(storage, storageKey) {
  return storageKey ? storage.getItem(storageKey) : null;
}

export function writeStoredTranslationJob(storage, storageKey, jobId) {
  if (!storageKey || !jobId) return false;
  storage.setItem(storageKey, jobId);
  notifyStoredTranslationJob(storage, storageKey);
  return true;
}

export function removeStoredTranslationJob(storage, storageKey, expectedJobId) {
  if (!storageKey || storage.getItem(storageKey) !== expectedJobId) return false;
  storage.removeItem(storageKey);
  notifyStoredTranslationJob(storage, storageKey);
  return true;
}

export function observeStoredTranslationJob(storage, storageKey, observer) {
  if (!storage || !storageKey || typeof observer !== 'function') return () => {};
  let observersByKey = storedJobObserversByStorage.get(storage);
  if (!observersByKey) {
    observersByKey = new Map();
    storedJobObserversByStorage.set(storage, observersByKey);
  }
  let observers = observersByKey.get(storageKey);
  if (!observers) {
    observers = new Set();
    observersByKey.set(storageKey, observers);
  }
  observers.add(observer);
  observer(readStoredTranslationJob(storage, storageKey));

  return () => {
    observers.delete(observer);
    if (observers.size > 0) return;
    observersByKey.delete(storageKey);
    if (observersByKey.size === 0) storedJobObserversByStorage.delete(storage);
  };
}

export function persistCreatedTranslationJob({
  storage,
  storageKey,
  expectedJobId,
  createdJobId,
}) {
  if (!storageKey || !createdJobId || storage.getItem(storageKey) !== expectedJobId) return false;
  storage.setItem(storageKey, createdJobId);
  notifyStoredTranslationJob(storage, storageKey);
  return true;
}

let nextRequestGeneration = 0;
const latestRequestByOwner = new Map();

export function createRequestLifecycle(ownerKey = Symbol('translation-request-owner')) {
  let active = false;
  let currentRequestGeneration = 0;
  return {
    activate() {
      active = true;
    },
    begin() {
      nextRequestGeneration += 1;
      currentRequestGeneration = nextRequestGeneration;
      latestRequestByOwner.set(ownerKey, currentRequestGeneration);
      return currentRequestGeneration;
    },
    invalidate() {
      active = false;
    },
    isCurrent(requestGeneration) {
      return active
        && requestGeneration === currentRequestGeneration
        && latestRequestByOwner.get(ownerKey) === requestGeneration;
    },
    shouldPersistCreatedJob(requestGeneration) {
      return latestRequestByOwner.get(ownerKey) === requestGeneration
        && (!active || requestGeneration === currentRequestGeneration);
    },
  };
}

export function initialPageFromStoredTranslationJob(jobId) {
  return jobId ? 'excel-translate' : 'list';
}

export function startFailureRecovery(httpStatus) {
  return httpStatus === 404 ? 'expire' : 'reconcile';
}

const LABELS = {
  scanning: '上传扫描',
  ready: '等待开始',
  queued: '排队中',
  translating: '翻译中',
  writing: '写入文件',
  validating: '校验文件',
  completed: '已完成',
  completed_with_warnings: '部分完成',
  failed: '失败',
};

export function shouldPoll(job) {
  return Boolean(job && ACTIVE_STATUSES.has(job.status));
}

export function translationControlsLocked({ job, starting, reconcilingStart }) {
  return Boolean(starting || reconcilingStart || shouldPoll(job));
}

export function canStart(job) {
  return Boolean(
    job
    && job.status === 'ready'
    && Number(job.candidateUniqueCount) > 0,
  );
}

export function canDownload(job) {
  return Boolean(
    job
    && ['completed', 'completed_with_warnings'].includes(job.status),
  );
}

export function progressPercent(job) {
  if (!job) return 0;
  const phase = job.status || job.phase;
  if (phase === 'completed' || phase === 'completed_with_warnings') return 100;
  if (phase === 'validating') return 98;
  if (phase === 'writing') return 95;
  if (phase === 'translating') {
    const total = Math.max(0, Number(job.totalUnique) || 0);
    const processed = Math.max(0, Number(job.processedUnique) || 0);
    if (!total) return 0;
    return Math.min(90, Math.round((processed / total) * 90));
  }
  if (phase === 'queued') return 0;
  if (phase === 'scanning') return 10;
  return 0;
}

export function statusLabel(job) {
  if (!job) return '';
  const key = LABELS[job.status] ? job.status : job.phase;
  return LABELS[key] || '';
}

export function completionNotice(job) {
  if (!job || !['completed', 'completed_with_warnings'].includes(job.status)) return null;
  const succeeded = Number(job.succeededCells) || 0;
  const failed = Number(job.failedCells) || 0;
  const skipped = Number(job.skippedCells) || 0;
  if (succeeded === 0 && failed === 0 && skipped > 0) {
    return '没有新增翻译，文件已保持原样';
  }
  if (job.status === 'completed_with_warnings') {
    return '翻译已完成，失败单元格已保留原文';
  }
  return '翻译完成，可以下载文件';
}
