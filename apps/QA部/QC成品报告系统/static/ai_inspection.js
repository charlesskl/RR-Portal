(() => {
  const section = document.querySelector('.ai-review-section');
  const button = document.querySelector('#start-ai-analysis');
  const message = document.querySelector('#analysis-message');
  const uploadStatus = document.querySelector('#upload-queue-status');
  const uploadMessage = uploadStatus?.querySelector('[data-upload-message]');
  const retryButton = document.querySelector('#retry-upload-queue');

  const poll = async () => {
    if (!section?.dataset.statusUrl) return;
    try {
      const response = await fetch(section.dataset.statusUrl);
      const data = await response.json();
      if (data.status === 'completed' || data.status === 'failed') {
        window.location.reload();
        return;
      }
    } catch (_) {}
    window.setTimeout(poll, 1800);
  };
  if (['queued', 'processing'].includes(section?.dataset.runStatus)) window.setTimeout(poll, 800);

  const DB_NAME = 'qc-photo-upload-queue';
  const STORE_NAME = 'pending-uploads';
  let databasePromise;
  let flushing = false;

  const setUploadStatus = (text, state = 'queued', retry = true) => {
    if (!uploadStatus || !uploadMessage) return;
    uploadStatus.hidden = false;
    uploadStatus.className = `upload-queue-status ${state}`;
    uploadMessage.textContent = text;
    if (retryButton) retryButton.hidden = !retry;
  };

  const hideUploadStatus = () => {
    if (uploadStatus) uploadStatus.hidden = true;
  };

  const openDatabase = () => {
    if (!('indexedDB' in window)) return Promise.reject(new Error('此浏览器不支持离线上传队列'));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, {keyPath: 'id'});
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开离线上传队列'));
    });
    return databasePromise;
  };

  const queuePut = async (job) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(job);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('照片暂存失败'));
      transaction.onabort = () => reject(transaction.error || new Error('照片暂存失败'));
    });
  };

  const queueDelete = async (id) => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('无法更新上传队列'));
    });
  };

  const queueAll = async () => {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('无法读取上传队列'));
    });
  };

  const photoCount = (jobs) => jobs.reduce((total, job) => total + (job.files?.length || 0), 0);

  const apiUploadUrl = (form) => {
    return window.QCUrls.apiUrl(form.action, section?.dataset.apiPrefix || '/api');
  };

  const createUploadJob = (input) => {
    const form = input.closest('form');
    const slot = input.closest('.photo-slot');
    const uniqueId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return {
      id: uniqueId,
      action: apiUploadUrl(form),
      createdAt: new Date().toISOString(),
      files: Array.from(input.files || []),
      uploadSource: form.querySelector('[name=upload_source]')?.value || 'gallery',
      sampleIds: slot?.querySelector('.slot-sample-input')?.value || '',
      defectGroup: slot?.querySelector('.slot-group-input')?.value || '',
    };
  };

  const sendUploadJob = async (job) => {
    if (!navigator.onLine) {
      const error = new Error('当前离线，联网后会自动重试');
      error.retryable = true;
      throw error;
    }
    const token = typeof window.CSRF_TOKEN === 'string' ? window.CSRF_TOKEN : '';
    const body = new FormData();
    body.append('csrf_token', token);
    body.append('upload_source', job.uploadSource || 'gallery');
    body.append('sample_ids', job.sampleIds || '');
    body.append('defect_group', job.defectGroup || '');
    (job.files || []).forEach((file, index) => body.append('photos', file, file.name || `photo-${index + 1}.jpg`));

    let response;
    try {
      response = await fetch(job.action, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: {'Accept': 'application/json', 'X-CSRF-Token': token},
      });
    } catch (cause) {
      const error = new Error('网络中断，照片已保留并等待重试');
      error.retryable = true;
      error.cause = cause;
      throw error;
    }

    if (response.redirected && window.QCUrls.isLoginRedirect(response.url, section?.dataset.loginUrl || '/login')) {
      const error = new Error('登录已失效；重新登录后可继续上传');
      error.retryable = true;
      throw error;
    }
    let payload = {};
    try { payload = await response.clone().json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(payload.error || `上传失败（HTTP ${response.status}）`);
      error.retryable = response.status >= 500 || [401, 403, 408, 425, 429].includes(response.status);
      throw error;
    }
  };

  const refreshQueueStatus = async () => {
    try {
      const jobs = await queueAll();
      if (!jobs.length) {
        hideUploadStatus();
        return;
      }
      const count = photoCount(jobs);
      setUploadStatus(
        navigator.onLine ? `${count} 张照片等待上传，系统将自动重试。` : `当前离线：已安全保留 ${count} 张照片，联网后自动上传。`,
        'queued',
        navigator.onLine,
      );
    } catch (error) {
      setUploadStatus(error.message || '无法读取离线上传队列', 'error', false);
    }
  };

  const flushQueue = async ({reloadOnSuccess = true} = {}) => {
    if (flushing) return;
    flushing = true;
    let uploaded = 0;
    let lastError = null;
    try {
      const jobs = await queueAll();
      if (!jobs.length) {
        hideUploadStatus();
        return;
      }
      if (!navigator.onLine) {
        await refreshQueueStatus();
        return;
      }
      setUploadStatus(`正在上传 ${photoCount(jobs)} 张照片…`, 'uploading', false);
      for (const job of jobs) {
        try {
          await sendUploadJob(job);
          await queueDelete(job.id);
          uploaded += job.files?.length || 0;
        } catch (error) {
          lastError = error;
          if (!error.retryable) await queueDelete(job.id);
          if (error.retryable) break;
        }
      }
    } catch (error) {
      lastError = error;
    } finally {
      flushing = false;
    }

    if (uploaded && reloadOnSuccess) {
      setUploadStatus(`已上传 ${uploaded} 张照片，正在刷新…`, 'success', false);
      window.location.reload();
      return;
    }
    if (lastError) {
      setUploadStatus(lastError.message || '照片上传失败', lastError.retryable ? 'queued' : 'error', Boolean(lastError.retryable));
      return;
    }
    await refreshQueueStatus();
  };

  document.querySelectorAll('.photo-upload-input').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.files?.length) return;
      const form = input.closest('form');
      try {
        const job = createUploadJob(input);
        await queuePut(job);
        input.value = '';
        await flushQueue();
      } catch (error) {
        if (navigator.onLine && form) {
          form.submit();
          return;
        }
        setUploadStatus(error.message || '离线时无法保留照片，请勿关闭页面并在联网后重试。', 'error', false);
      }
    });
  });

  retryButton?.addEventListener('click', () => flushQueue());
  window.addEventListener('online', () => flushQueue());
  window.addEventListener('offline', () => refreshQueueStatus());
  if (navigator.onLine) flushQueue(); else refreshQueueStatus();

  button?.addEventListener('click', async () => {
    button.disabled = true;
    message.className = 'analysis-message processing';
    message.innerHTML = '<span class="spinner"></span><div><strong>正在提交分析任务…</strong><span>请保持页面打开，系统完成后会自动刷新。</span></div>';
    try {
      const response = await fetch(section.dataset.runUrl, {method: 'POST', headers: {'X-CSRF-Token': window.CSRF_TOKEN, 'Accept': 'application/json'}});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法启动 AI 分析');
      section.dataset.statusUrl = window.QCUrls.analysisStatusUrl(section.dataset.statusBase, data.analysis_run_id);
      window.setTimeout(poll, 500);
    } catch (error) {
      button.disabled = false;
      message.className = 'analysis-message failed';
      message.textContent = `无法启动分析：${String(error.message || error)}`;
    }
  });
})();
