const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const multer = require('multer');

const { auditLog } = require('../middleware/audit');
const { assertPackageLimits, WorkbookIntegrityError } = require('../utils/workbookIntegrity');
const { JobConflictError, JobNotFoundError } = require('../utils/translationJobManager');

const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/octet-stream',
].map(value => value.toLowerCase()));

const ERROR_RESPONSES = {
  file_required: '请选择一个 Excel 文件',
  invalid_file_type: '只支持 .xlsx 或 .xlsm 文件',
  file_too_large: '上传文件超过大小限制',
  invalid_ooxml_package: '文件不是有效的 Excel 工作簿',
  workbook_type_mismatch: '文件扩展名与实际 Excel 类型不一致',
  package_too_large: 'Excel 文件解压后超过大小限制',
  job_not_found: '任务不存在',
  job_not_ready: '任务尚未准备好',
  download_not_ready: '文件尚未生成',
  job_capacity_reached: '任务数量已达上限，请稍后再试',
  job_conflict: '当前任务状态不允许此操作',
  internal_error: '服务器内部错误',
};

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function errorResponse(error) {
  if (error instanceof JobNotFoundError || error.name === 'JobNotFoundError') {
    return { status: 404, code: 'job_not_found' };
  }
  if (error instanceof JobConflictError || error.name === 'JobConflictError') {
    const code = Object.hasOwn(ERROR_RESPONSES, error.code) ? error.code : 'job_conflict';
    return { status: 409, code };
  }
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, code: 'file_too_large' };
  }
  if (
    error instanceof WorkbookIntegrityError
    || [
      'invalid_file_type',
      'file_required',
      'invalid_ooxml_package',
      'package_too_large',
      'workbook_type_mismatch',
    ]
      .includes(error.code)
  ) {
    const code = Object.hasOwn(ERROR_RESPONSES, error.code)
      ? error.code
      : 'invalid_ooxml_package';
    return { status: 400, code };
  }
  return { status: 500, code: 'internal_error' };
}

function sendError(res, error) {
  const mapped = errorResponse(error);
  res.status(mapped.status).json({
    code: mapped.code,
    message: ERROR_RESPONSES[mapped.code],
  });
}

function createExcelTranslationRouter({
  jobManager,
  incomingDir,
  limits,
  audit = auditLog,
}) {
  fsSync.mkdirSync(incomingDir, { recursive: true });
  const router = express.Router();
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      callback(null, incomingDir);
    },
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: limits.maxFileBytes, files: 1 },
    fileFilter(req, file, callback) {
      const safeName = path.basename(String(file.originalname || ''));
      const extension = path.extname(safeName).toLowerCase();
      file.originalname = safeName;
      if (
        !['.xlsx', '.xlsm'].includes(extension)
        || !ALLOWED_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())
      ) {
        callback(codedError('invalid_file_type'));
        return;
      }
      callback(null, true);
    },
  });

  async function cleanupIncoming(req) {
    if (req.file && req.file.path) await fs.unlink(req.file.path).catch(() => {});
  }

  function releaseDownload(download) {
    try {
      const cleanup = download.release();
      if (cleanup && typeof cleanup.catch === 'function') void cleanup.catch(() => {});
    } catch {}
  }

  router.post('/', (req, res) => {
    upload.single('file')(req, res, async uploadError => {
      if (uploadError) {
        await cleanupIncoming(req);
        sendError(res, uploadError);
        return;
      }
      try {
        if (!req.file) throw codedError('file_required');
        const extension = path.extname(req.file.originalname).toLowerCase();
        await assertPackageLimits(req.file.path, {
          maxCompressedBytes: limits.maxFileBytes,
          maxUncompressedBytes: limits.maxUncompressedBytes,
          expectedExtension: extension,
        });
        const view = await jobManager.createJob({
          ownerId: req.user.id,
          incomingPath: req.file.path,
          originalName: req.file.originalname,
          extension,
        });
        audit('excel_translation_upload', req.user.id, {
          jobId: view.jobId,
          fileName: view.originalName,
          status: view.status,
          candidateCellCount: view.candidateCellCount,
        });
        res.status(202).json(view);
      } catch (error) {
        await cleanupIncoming(req);
        sendError(res, error);
      }
    });
  });

  router.post('/:jobId/start', (req, res) => {
    try {
      const view = jobManager.startJob(req.user.id, req.params.jobId);
      audit('excel_translation_start', req.user.id, {
        jobId: view.jobId,
        status: view.status,
        candidateCellCount: view.candidateCellCount,
      });
      res.status(202).json(view);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:jobId', (req, res) => {
    try {
      res.json(jobManager.getJob(req.user.id, req.params.jobId));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:jobId/download', (req, res) => {
    let download;
    try {
      download = jobManager.acquireDownload(req.user.id, req.params.jobId);
      res.setHeader('Content-Type', download.contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      );
      res.sendFile(download.path, error => {
        releaseDownload(download);
        if (error) {
          if (!res.headersSent) {
            res.removeHeader('Content-Type');
            res.removeHeader('Content-Disposition');
            res.removeHeader('Content-Length');
            sendError(res, error);
          }
          return;
        }
        audit('excel_translation_download', req.user.id, {
          jobId: req.params.jobId,
          fileName: download.fileName,
        });
      });
    } catch (error) {
      if (download) releaseDownload(download);
      sendError(res, error);
    }
  });

  return router;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  createExcelTranslationRouter,
};
