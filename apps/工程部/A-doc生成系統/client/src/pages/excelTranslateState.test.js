import test from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldPoll,
  canStart,
  canDownload,
  progressPercent,
  statusLabel,
  completionNotice,
} from './excelTranslateState.js';

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
