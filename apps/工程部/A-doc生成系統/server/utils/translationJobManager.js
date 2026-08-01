const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const excelTranslator = require('./excelTranslator');

const DEFAULT_TTL_MS = 3_600_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 600_000;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

const SUMMARY_FIELDS = [
  'sheetCount',
  'formulaCount',
  'candidateCellCount',
  'candidateUniqueCount',
  'totalUnique',
  'processedUnique',
  'succeededCells',
  'skippedCells',
  'failedCells',
];

const ERROR_MESSAGES = {
  invalid_ooxml_package: '文件不是有效的 Excel 工作簿',
  package_too_large: 'Excel 文件解压后超过大小限制',
  protected_part_set_changed: '输出文件的受保护部件不完整',
  protected_part_changed: '输出文件的受保护部件发生变化',
  macro_container_changed: '宏工作簿结构校验失败',
  sheet_structure_changed: '工作表结构校验失败',
  defined_names_changed: '工作簿名称定义校验失败',
  styles_changed: '工作簿样式校验失败',
  merge_changed: '合并单元格校验失败',
  dimensions_changed: '工作表尺寸校验失败',
  formula_changed: '公式校验失败',
  cell_style_changed: '单元格样式校验失败',
  worksheet_structure_changed: '工作表附加结构校验失败',
  unexpected_cell_change: '检测到非翻译单元格变化',
  translation_failed: '翻译未能生成可下载文件',
  operation_failed: '处理失败，请稍后重试',
};

class JobNotFoundError extends Error {
  constructor() {
    super('job_not_found');
    this.name = 'JobNotFoundError';
    this.code = 'job_not_found';
  }
}

class JobConflictError extends Error {
  constructor(code = 'job_conflict') {
    super(code);
    this.name = 'JobConflictError';
    this.code = code;
  }
}

function ensureInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('invalid_job_path');
    error.code = 'invalid_job_path';
    throw error;
  }
  return resolvedCandidate;
}

function cleanDirectoryContents(directory) {
  fsSync.mkdirSync(directory, { recursive: true });
  const entries = fsSync.readdirSync(directory);
  for (const entry of entries) {
    const target = ensureInside(directory, path.join(directory, entry));
    fsSync.rmSync(target, { recursive: true, force: true });
  }
}

async function moveFile(source, target) {
  try {
    await fs.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.copyFile(source, target);
    await fs.unlink(source);
  }
}

function createTranslationJobManager({
  jobsRoot = path.join(__dirname, '../uploads/translation-jobs'),
  incomingDir = path.join(__dirname, '../uploads/translation-incoming'),
  clock = () => Date.now(),
  idFactory = () => crypto.randomUUID(),
  scanWorkbook = excelTranslator.scanWorkbook,
  translateWorkbook = excelTranslator.translateWorkbook,
  ttlMs = DEFAULT_TTL_MS,
  cleanupIntervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
} = {}) {
  const jobs = new Map();
  const queue = [];
  let operationRunning = false;
  cleanDirectoryContents(jobsRoot);
  cleanDirectoryContents(incomingDir);
  const initialization = Promise.resolve();

  function publicView(job) {
    return {
      jobId: job.jobId,
      status: job.status,
      phase: job.phase,
      originalName: job.originalName,
      downloadName: job.downloadName,
      sheetCount: job.sheetCount,
      formulaCount: job.formulaCount,
      candidateCellCount: job.candidateCellCount,
      candidateUniqueCount: job.candidateUniqueCount,
      totalUnique: job.totalUnique,
      processedUnique: job.processedUnique,
      succeededCells: job.succeededCells,
      skippedCells: job.skippedCells,
      failedCells: job.failedCells,
      currentSheet: job.currentSheet,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      expiresAt: job.expiresAt,
    };
  }

  function ownedJob(ownerId, jobId) {
    const job = jobs.get(jobId);
    if (!job || job.ownerId !== String(ownerId)) throw new JobNotFoundError();
    return job;
  }

  function copySummary(job, summary = {}) {
    for (const field of SUMMARY_FIELDS) {
      if (Number.isFinite(summary[field])) job[field] = summary[field];
    }
  }

  function expireLater(job) {
    job.expiresAt = clock() + ttlMs;
    job.currentSheet = null;
  }

  async function removeOutput(job) {
    await fs.unlink(job.outputPath).catch(() => {});
  }

  function markFailed(job, error, forcedCode) {
    const candidateCode = forcedCode || (error && error.code);
    const errorCode = Object.hasOwn(ERROR_MESSAGES, candidateCode)
      ? candidateCode
      : 'operation_failed';
    job.status = 'failed';
    job.phase = 'failed';
    job.errorCode = errorCode;
    job.errorMessage = ERROR_MESSAGES[errorCode];
    expireLater(job);
  }

  function onTranslationProgress(job, progress = {}) {
    if (progress.phase === 'writing') {
      job.status = 'writing';
      job.phase = 'writing';
      job.currentSheet = progress.sheetName || null;
    } else if (progress.phase === 'validating') {
      job.status = 'validating';
      job.phase = 'validating';
      job.currentSheet = null;
    } else if (progress.phase === 'scanning') {
      job.status = 'translating';
      job.phase = 'scanning';
      job.currentSheet = progress.sheetName || null;
    } else {
      job.status = 'translating';
      job.phase = 'translating';
      job.currentSheet = null;
    }
    copySummary(job, progress);
  }

  async function runScan(job) {
    try {
      const summary = await scanWorkbook(job.inputPath, {
        onSheet: event => {
          job.currentSheet = event && event.sheetName ? event.sheetName : null;
        },
      });
      copySummary(job, summary);
      job.status = 'ready';
      job.phase = 'ready';
      job.errorCode = null;
      job.errorMessage = null;
      expireLater(job);
    } catch (error) {
      markFailed(job, error);
    }
  }

  async function runTranslation(job) {
    try {
      const summary = await translateWorkbook(job.inputPath, job.outputPath, {
        onProgress: progress => onTranslationProgress(job, progress),
      });
      copySummary(job, summary);
      const succeeded = job.succeededCells || 0;
      const failed = job.failedCells || 0;
      if (failed > 0 && succeeded === 0) {
        await removeOutput(job);
        markFailed(job, null, 'translation_failed');
        return;
      }
      job.status = failed > 0 ? 'completed_with_warnings' : 'completed';
      job.phase = job.status;
      job.errorCode = null;
      job.errorMessage = null;
      expireLater(job);
    } catch (error) {
      await removeOutput(job);
      markFailed(job, error);
    }
  }

  async function drainQueue() {
    if (operationRunning) return;
    const item = queue.shift();
    if (!item) return;
    operationRunning = true;
    const { job, type } = item;
    job.expiresAt = null;
    job.currentSheet = null;
    if (type === 'scan') {
      job.status = 'scanning';
      job.phase = 'scanning';
      await runScan(job);
    } else {
      job.status = 'translating';
      job.phase = 'translating';
      await runTranslation(job);
    }
    operationRunning = false;
    void drainQueue();
  }

  function enqueue(job, type) {
    job.status = 'queued';
    job.phase = 'queued';
    job.currentSheet = null;
    job.expiresAt = null;
    queue.push({ job, type });
    void drainQueue();
  }

  async function createJob({ ownerId, incomingPath, originalName, extension }) {
    await initialization;
    const jobId = String(idFactory());
    if (!/^[A-Za-z0-9_-]+$/.test(jobId)) {
      const error = new Error('invalid_job_id');
      error.code = 'invalid_job_id';
      throw error;
    }
    const normalizedExtension = String(extension || '').toLowerCase();
    if (!['.xlsx', '.xlsm'].includes(normalizedExtension)) {
      const error = new Error('invalid_file_extension');
      error.code = 'invalid_file_extension';
      throw error;
    }
    const safeIncomingPath = ensureInside(incomingDir, incomingPath);
    const jobDirectory = ensureInside(jobsRoot, path.join(jobsRoot, jobId));
    await fs.mkdir(jobDirectory, { recursive: false });
    const inputPath = path.join(jobDirectory, `input${normalizedExtension}`);
    const outputPath = path.join(jobDirectory, `output${normalizedExtension}`);
    try {
      await moveFile(safeIncomingPath, inputPath);
    } catch (error) {
      await fs.rm(jobDirectory, { recursive: true, force: true });
      throw error;
    }

    const safeOriginalName = path.basename(String(originalName || `workbook${normalizedExtension}`));
    const downloadName = `${path.parse(safeOriginalName).name}_中英翻译${normalizedExtension}`;
    const job = {
      jobId,
      ownerId: String(ownerId),
      status: 'queued',
      phase: 'queued',
      originalName: safeOriginalName,
      downloadName,
      extension: normalizedExtension,
      inputPath,
      outputPath,
      jobDirectory,
      sheetCount: null,
      formulaCount: null,
      candidateCellCount: null,
      candidateUniqueCount: null,
      totalUnique: null,
      processedUnique: null,
      succeededCells: null,
      skippedCells: null,
      failedCells: null,
      currentSheet: null,
      errorCode: null,
      errorMessage: null,
      createdAt: clock(),
      expiresAt: null,
    };
    jobs.set(jobId, job);
    enqueue(job, 'scan');
    return publicView(job);
  }

  function startJob(ownerId, jobId) {
    const job = ownedJob(ownerId, jobId);
    if (job.status !== 'ready') throw new JobConflictError('job_not_ready');
    enqueue(job, 'translate');
    return publicView(job);
  }

  function getJob(ownerId, jobId) {
    return publicView(ownedJob(ownerId, jobId));
  }

  function getDownload(ownerId, jobId) {
    const job = ownedJob(ownerId, jobId);
    if (!['completed', 'completed_with_warnings'].includes(job.status)) {
      throw new JobConflictError('download_not_ready');
    }
    return {
      path: job.outputPath,
      fileName: job.downloadName,
      contentType: job.extension === '.xlsm' ? XLSM_MIME : XLSX_MIME,
    };
  }

  async function sweepExpired() {
    const now = clock();
    let removed = 0;
    for (const [jobId, job] of jobs) {
      if (job.expiresAt === null || job.expiresAt > now) continue;
      await fs.rm(job.jobDirectory, { recursive: true, force: true });
      jobs.delete(jobId);
      removed += 1;
    }
    return removed;
  }

  const timer = setInterval(() => {
    void sweepExpired().catch(() => {});
  }, cleanupIntervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  function close() {
    clearInterval(timer);
  }

  return {
    createJob,
    startJob,
    getJob,
    getDownload,
    sweepExpired,
    close,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_CLEANUP_INTERVAL_MS,
  JobNotFoundError,
  JobConflictError,
  createTranslationJobManager,
};
