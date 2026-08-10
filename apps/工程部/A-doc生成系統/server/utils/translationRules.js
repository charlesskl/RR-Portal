const SEP = ' / ';
const EXCEL_CELL_LIMIT = 32767;
const HAS_ZH = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const HAS_LATIN = /[A-Za-z]/;
const URL_OR_EMAIL = /^(?:https?:\/\/|www\.)|^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const FILE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/]|[^\s\\/]+[\\/])[^\r\n]*$/;
const EXCEL_ERROR = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA)$/i;
const PURE_CODE = /^(?=.*\d)[A-Z0-9._#-]{2,}$/i;
const PURE_NUMBER_OR_PUNCT = /^[\d\s.,:+\-/%()#_]+$/;

function isCandidateText(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim();
  return Boolean(value)
    && !URL_OR_EMAIL.test(value)
    && !FILE_PATH.test(value)
    && !EXCEL_ERROR.test(value)
    && !PURE_CODE.test(value)
    && !PURE_NUMBER_OR_PUNCT.test(value);
}

function analyzeText(text) {
  const original = String(text ?? '');
  const core = original.trim();
  if (!isCandidateText(core)) {
    return { original, core, action: 'skip', reason: 'non-translatable' };
  }

  const segments = core.split(SEP).map(segment => segment.trim()).filter(Boolean);
  const chineseSegments = segments.filter(segment => HAS_ZH.test(segment));
  const nonChineseSegments = segments.filter(segment => !HAS_ZH.test(segment));
  const latinSegments = nonChineseSegments.filter(segment => HAS_LATIN.test(segment));

  return {
    original,
    core,
    action: 'translate',
    segments,
    chineseSegments,
    nonChineseSegments,
    latinSegments,
  };
}

function isChineseLanguage(language) {
  return typeof language === 'string' && /^zh(?:-|$)/i.test(language);
}

function isEnglishLanguage(language) {
  return typeof language === 'string' && /^en(?:-|$)/i.test(language);
}

function usableTranslation(value) {
  return value
    && !value.error
    && typeof value.text === 'string'
    && Boolean(value.text.trim())
    && typeof value.detectedLanguage === 'string';
}

function outcome(status, value, reason) {
  return { status, value, reason };
}

function appendTranslations(original, translations) {
  const additions = translations
    .map(value => String(value ?? '').trim())
    .filter(Boolean);
  const value = `${original}${additions.map(text => `${SEP}${text}`).join('')}`;
  if (value.length > EXCEL_CELL_LIMIT) {
    return outcome('failed', original, 'excel-cell-limit');
  }
  return outcome('translated', value, 'translated');
}

async function translateUniqueTexts(texts, provider) {
  const results = new Map();
  const pending = [];
  let requestSequence = 0;
  const requestIdsByTextAndTarget = new Map();

  const queueRequest = (requests, text, to) => {
    const key = `${to}\u0000${text}`;
    const existingId = requestIdsByTextAndTarget.get(key);
    if (existingId) return existingId;
    const request = {
      id: `translation-${++requestSequence}`,
      text,
      from: 'auto',
      to,
    };
    requestIdsByTextAndTarget.set(key, request.id);
    requests.push(request);
    return request.id;
  };

  const firstRequests = [];
  for (const input of new Set(texts)) {
    const analysis = analyzeText(input);
    if (analysis.action === 'skip') {
      results.set(input, outcome('skipped', analysis.original, analysis.reason));
      continue;
    }
    const work = { input, analysis };
    const { segments, chineseSegments, nonChineseSegments } = analysis;
    if (!nonChineseSegments.length) {
      work.mode = segments.length === 1 ? 'han-source' : 'multi-han';
      work.source = segments[0];
      work.firstRequestId = queueRequest(firstRequests, work.source, 'en');
    } else {
      work.mode = chineseSegments.length ? 'detect-with-chinese' : 'detect-without-chinese';
      work.detections = nonChineseSegments.map(source => {
        const requestId = queueRequest(firstRequests, source, 'zh-CN');
        return { source, requestId };
      });
    }
    pending.push(work);
  }

  let firstResponses = new Map();
  if (firstRequests.length) {
    try {
      firstResponses = await provider.translateMany(firstRequests);
    } catch {
      firstResponses = new Map();
    }
  }

  const secondRequests = [];
  const secondPending = [];
  for (const work of pending) {
    const original = work.analysis.original;
    if (work.mode === 'han-source' || work.mode === 'multi-han') {
      const response = firstResponses.get(work.firstRequestId);
      if (!usableTranslation(response)) {
        results.set(work.input, outcome('failed', original, 'translation-unavailable'));
        continue;
      }
      if (work.mode === 'multi-han' || isChineseLanguage(response.detectedLanguage)) {
        results.set(work.input, appendTranslations(original, [response.text]));
      } else {
        work.english = response.text;
        work.secondRequestId = queueRequest(secondRequests, work.source, 'zh-CN');
        secondPending.push(work);
      }
      continue;
    }

    const detections = work.detections.map(detection => ({
      ...detection,
      response: firstResponses.get(detection.requestId),
    }));
    const usableDetections = detections.filter(detection => (
      usableTranslation(detection.response)
    ));
    const englishDetection = usableDetections.find(detection => (
      isEnglishLanguage(detection.response.detectedLanguage)
    ));
    if (englishDetection) {
      if (work.mode === 'detect-without-chinese') {
        results.set(work.input, appendTranslations(original, [englishDetection.response.text]));
      } else {
        results.set(work.input, outcome('skipped', original, 'already-complete'));
      }
      continue;
    }
    if (usableDetections.length !== detections.length) {
      results.set(work.input, detections.length > 1
        ? outcome('skipped', original, 'language-unconfirmed')
        : outcome('failed', original, 'translation-unavailable'));
      continue;
    }

    if (work.mode === 'detect-without-chinese') {
      work.chinese = detections[0].response.text;
      work.source = detections[0].source;
      work.secondRequestId = queueRequest(secondRequests, work.source, 'en');
      secondPending.push(work);
      continue;
    }

    work.source = detections[0].source;
    work.secondRequestId = queueRequest(secondRequests, work.source, 'en');
    secondPending.push(work);
  }

  let secondResponses = new Map();
  if (secondRequests.length) {
    try {
      secondResponses = await provider.translateMany(secondRequests);
    } catch {
      secondResponses = new Map();
    }
  }

  for (const work of secondPending) {
    const response = secondResponses.has(work.secondRequestId)
      ? secondResponses.get(work.secondRequestId)
      : firstResponses.get(work.secondRequestId);
    const original = work.analysis.original;
    if (!usableTranslation(response)) {
      results.set(work.input, outcome('failed', original, 'translation-unavailable'));
      continue;
    }

    if (work.mode === 'han-source') {
      results.set(work.input, appendTranslations(original, [response.text, work.english]));
    } else if (work.mode === 'detect-with-chinese') {
      results.set(work.input, appendTranslations(original, [response.text]));
    } else {
      results.set(work.input, appendTranslations(original, [work.chinese, response.text]));
    }
  }

  return results;
}

module.exports = {
  SEP,
  EXCEL_CELL_LIMIT,
  HAS_ZH,
  isCandidateText,
  analyzeText,
  translateUniqueTexts,
};
