const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

const { authenticate } = require('../middleware/auth');
const { createWorkbookFixture } = require('./helpers/workbookFixture');
const { JobConflictError, JobNotFoundError } = require('../utils/translationJobManager');
const { createExcelTranslationRouter } = require('../routes/excelTranslation');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

class FakeJobManager {
  constructor(downloadPath) {
    this.downloadPath = downloadPath;
    this.jobs = new Map();
    this.sequence = 0;
    this.downloadLeaseAcquisitions = 0;
    this.downloadLeaseReleases = 0;
    this.activeDownloadLeases = 0;
  }

  createJob = async ({ ownerId, originalName, extension }) => {
    const jobId = `job-${++this.sequence}`;
    const job = {
      jobId,
      ownerId: String(ownerId),
      originalName,
      extension,
      status: 'scanning',
      phase: 'scanning',
      downloadName: `${path.parse(originalName).name}_中英翻译${extension}`,
    };
    this.jobs.set(jobId, job);
    return this.view(job);
  };

  owned(ownerId, jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== String(ownerId)) throw new JobNotFoundError();
    return job;
  }

  view(job) {
    return {
      jobId: job.jobId,
      status: job.status,
      phase: job.phase,
      originalName: job.originalName,
      downloadName: job.downloadName,
    };
  }

  getJob = (ownerId, jobId) => this.view(this.owned(ownerId, jobId));

  startJob = (ownerId, jobId) => {
    const job = this.owned(ownerId, jobId);
    if (job.status !== 'ready') throw new JobConflictError('job_not_ready');
    job.status = 'translating';
    job.phase = 'translating';
    return this.view(job);
  };

  getDownload = (ownerId, jobId) => {
    const job = this.owned(ownerId, jobId);
    if (job.status !== 'completed') throw new JobConflictError('download_not_ready');
    return {
      path: this.downloadPath,
      fileName: job.downloadName,
      contentType: job.extension === '.xlsm' ? XLSM_MIME : XLSX_MIME,
    };
  };

  acquireDownload = (ownerId, jobId) => {
    const download = this.getDownload(ownerId, jobId);
    let released = false;
    this.downloadLeaseAcquisitions += 1;
    this.activeDownloadLeases += 1;
    return {
      ...download,
      release: async () => {
        if (released) return;
        released = true;
        this.downloadLeaseReleases += 1;
        this.activeDownloadLeases -= 1;
      },
    };
  };

  markReady(jobId) {
    const job = this.jobs.get(jobId);
    job.status = 'ready';
    job.phase = 'ready';
  }

  markCompleted(jobId) {
    const job = this.jobs.get(jobId);
    job.status = 'completed';
    job.phase = 'completed';
  }
}

async function setup(t, { maxFileBytes = 50 * 1024 * 1024, maxUncompressedBytes = 512 * 1024 * 1024 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'translation-route-'));
  const incomingDir = path.join(directory, 'incoming');
  await fs.mkdir(incomingDir, { recursive: true });
  const fixturePath = path.join(directory, 'fixture.xlsx');
  const downloadPath = path.join(directory, 'download.xlsx');
  await createWorkbookFixture(fixturePath);
  await fs.writeFile(downloadPath, 'download-body');
  const fixture = await fs.readFile(fixturePath);
  const manager = new FakeJobManager(downloadPath);
  const audits = [];
  const app = express();
  app.use(
    '/api/excel-translations',
    authenticate,
    createExcelTranslationRouter({
      jobManager: manager,
      incomingDir,
      limits: { maxFileBytes, maxUncompressedBytes },
      audit: (...args) => audits.push(args),
    }),
  );
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/excel-translations`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { baseUrl, fixture, manager, audits };
}

function token(ownerId) {
  return jwt.sign({ id: ownerId, username: ownerId }, process.env.JWT_SECRET);
}

function uploadForm(buffer, fileName = 'sample.xlsx', mime = XLSX_MIME) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), fileName);
  return form;
}

async function upload(baseUrl, ownerToken, form) {
  return fetch(baseUrl, {
    method: 'POST',
    body: form,
    headers: ownerToken ? { Authorization: `Bearer ${ownerToken}` } : {},
  });
}

test('requires JWT before accepting an upload', async t => {
  process.env.JWT_SECRET = 'route-test-secret';
  const { baseUrl, fixture } = await setup(t);
  const response = await upload(baseUrl, null, uploadForm(fixture));
  assert.equal(response.status, 401);
});

test('rejects unsupported extensions, fake ZIPs and both size limits', async t => {
  process.env.JWT_SECRET = 'route-test-secret';
  const ownerToken = token('owner-a');
  const normal = await setup(t);
  let response = await upload(normal.baseUrl, ownerToken, uploadForm(Buffer.from('old excel'), 'sample.xls', 'application/vnd.ms-excel'));
  assert.equal(response.status, 400);
  response = await upload(normal.baseUrl, ownerToken, uploadForm(Buffer.from('not a zip')));
  assert.equal(response.status, 400);

  const compressedLimit = await setup(t, { maxFileBytes: 4 });
  response = await upload(compressedLimit.baseUrl, ownerToken, uploadForm(Buffer.from('12345')));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'file_too_large');

  const expandedLimit = await setup(t, { maxUncompressedBytes: 1 });
  response = await upload(expandedLimit.baseUrl, ownerToken, uploadForm(expandedLimit.fixture));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'package_too_large');
});

test('rejects workbook containers renamed to the other Excel extension', async t => {
  process.env.JWT_SECRET = 'route-test-secret';
  const { baseUrl, fixture } = await setup(t);
  const ownerToken = token('owner-a');

  let response = await upload(
    baseUrl,
    ownerToken,
    uploadForm(fixture, 'renamed.xlsm', XLSM_MIME),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'workbook_type_mismatch');

  const macroTemplate = await fs.readFile(path.join(__dirname, '../templates/走货明细模表.xlsm'));
  response = await upload(
    baseUrl,
    ownerToken,
    uploadForm(macroTemplate, 'renamed.xlsx', XLSX_MIME),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'workbook_type_mismatch');
});

test('creates, owns, starts, polls and downloads a translation job', async t => {
  process.env.JWT_SECRET = 'route-test-secret';
  const { baseUrl, fixture, manager, audits } = await setup(t);
  const ownerToken = token('owner-a');
  const otherToken = token('owner-b');
  const uploadResponse = await upload(baseUrl, ownerToken, uploadForm(fixture));
  assert.equal(uploadResponse.status, 202);
  const created = await uploadResponse.json();
  assert.equal(created.status, 'scanning');

  let response = await fetch(`${baseUrl}/${created.jobId}`, {
    headers: { Authorization: `Bearer ${otherToken}` },
  });
  assert.equal(response.status, 404);
  response = await fetch(`${baseUrl}/${created.jobId}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 409);
  response = await fetch(`${baseUrl}/${created.jobId}/download`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 409);

  manager.markReady(created.jobId);
  response = await fetch(`${baseUrl}/${created.jobId}/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 202);
  manager.markCompleted(created.jobId);
  response = await fetch(`${baseUrl}/${created.jobId}/download`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), XLSX_MIME);
  assert.match(response.headers.get('content-disposition'), /sample_%E4%B8%AD%E8%8B%B1%E7%BF%BB%E8%AF%91\.xlsx/);
  assert.equal(await response.text(), 'download-body');
  assert.equal(manager.downloadLeaseAcquisitions, 1);
  assert.equal(manager.downloadLeaseReleases, 1);
  assert.equal(manager.activeDownloadLeases, 0);
  assert.deepEqual(audits.map(entry => entry[0]), [
    'excel_translation_upload',
    'excel_translation_start',
    'excel_translation_download',
  ]);
});

test('releases the download lease when sendFile fails', async t => {
  process.env.JWT_SECRET = 'route-test-secret';
  const { baseUrl, fixture, manager } = await setup(t);
  const ownerToken = token('owner-a');
  const uploadResponse = await upload(baseUrl, ownerToken, uploadForm(fixture));
  const created = await uploadResponse.json();
  manager.markCompleted(created.jobId);
  await fs.unlink(manager.downloadPath);

  const response = await fetch(`${baseUrl}/${created.jobId}/download`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
  });

  assert.equal(response.status, 500);
  assert.match(response.headers.get('content-type'), /^application\/json\b/);
  assert.equal(response.headers.get('content-disposition'), null);
  assert.deepEqual(await response.json(), {
    code: 'internal_error',
    message: '服务器内部错误',
  });
  assert.equal(manager.downloadLeaseAcquisitions, 1);
  assert.equal(manager.downloadLeaseReleases, 1);
  assert.equal(manager.activeDownloadLeases, 0);
});
