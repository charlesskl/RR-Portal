const ACTIVE_STATUSES = new Set([
  'scanning',
  'queued',
  'translating',
  'writing',
  'validating',
]);

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
