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
  const latinSegments = segments.filter(segment => HAS_LATIN.test(segment) && !HAS_ZH.test(segment));
  if (segments.length >= 3 && chineseSegments.length && latinSegments.length) {
    return { original, core, action: 'complete', segments };
  }

  return {
    original,
    core,
    action: 'translate',
    segments,
    chineseSegments,
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

  const makeRequest = (work, text, to, phase) => {
    const request = {
      id: `translation-${++requestSequence}`,
      text,
      from: 'auto',
      to,
    };
    work[`${phase}RequestId`] = request.id;
    return request;
  };

  const firstRequests = [];
  for (const input of new Set(texts)) {
    const analysis = analyzeText(input);
    if (analysis.action === 'skip') {
      results.set(input, outcome('skipped', analysis.original, analysis.reason));
      continue;
    }
    if (analysis.action === 'complete') {
      results.set(input, outcome('skipped', analysis.original, 'already-complete'));
      continue;
    }

    const work = { input, analysis };
    const { segments, chineseSegments } = analysis;
    if (segments.length === 1) {
      work.mode = HAS_ZH.test(segments[0]) ? 'single-han' : 'single-non-han';
      work.source = segments[0];
      firstRequests.push(makeRequest(
        work,
        work.source,
        work.mode === 'single-han' ? 'en' : 'zh-CN',
        'first',
      ));
    } else if (chineseSegments.length) {
      work.mode = 'multi-with-chinese';
      work.source = segments.find(segment => !HAS_ZH.test(segment)) || segments[0];
      firstRequests.push(makeRequest(work, work.source, 'zh-CN', 'first'));
    } else {
      work.mode = 'multi-without-chinese';
      work.source = segments[0];
      firstRequests.push(makeRequest(work, work.source, 'zh-CN', 'first'));
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
    const response = firstResponses.get(work.firstRequestId);
    const original = work.analysis.original;
    if (!usableTranslation(response)) {
      results.set(work.input, outcome('failed', original, 'translation-unavailable'));
      continue;
    }

    if (work.mode === 'single-han') {
      if (isChineseLanguage(response.detectedLanguage)) {
        results.set(work.input, appendTranslations(original, [response.text]));
      } else {
        work.english = response.text;
        secondRequests.push(makeRequest(work, work.source, 'zh-CN', 'second'));
        secondPending.push(work);
      }
      continue;
    }

    if (work.mode === 'single-non-han' || work.mode === 'multi-without-chinese') {
      work.chinese = response.text;
      if (isEnglishLanguage(response.detectedLanguage)) {
        results.set(work.input, appendTranslations(original, [work.chinese]));
      } else {
        secondRequests.push(makeRequest(work, work.source, 'en', 'second'));
        secondPending.push(work);
      }
      continue;
    }

    if (isEnglishLanguage(response.detectedLanguage)) {
      results.set(work.input, outcome('skipped', original, 'already-complete'));
    } else {
      secondRequests.push(makeRequest(work, work.source, 'en', 'second'));
      secondPending.push(work);
    }
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
    const response = secondResponses.get(work.secondRequestId);
    const original = work.analysis.original;
    if (!usableTranslation(response)) {
      results.set(work.input, outcome('failed', original, 'translation-unavailable'));
      continue;
    }

    if (work.mode === 'single-han') {
      results.set(work.input, appendTranslations(original, [response.text, work.english]));
    } else if (work.mode === 'multi-with-chinese') {
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
