'use strict';

const crypto = require('crypto');
const { customerEnglish } = require('./vqEnglish');

const FIXED_TRANSLATIONS = new Map([
  ['杂费', 'Dennison'],
  ['外箱', 'Master Carton K3A'],
  ['平卡', 'Inner B33'],
]);

const hasChinese = value => /[\u3400-\u9fff]/.test(String(value || ''));

function createBaiduTranslator({
  appid = process.env.BAIDU_APPID,
  key = process.env.BAIDU_KEY,
  fetchImpl = global.fetch,
} = {}) {
  return async function translate(text) {
    if (!appid || !key) throw new Error('BAIDU_APPID/BAIDU_KEY 未配置');
    if (typeof fetchImpl !== 'function') throw new Error('当前 Node.js 环境不支持翻译请求');
    const salt = Date.now().toString();
    const sign = crypto.createHash('md5').update(appid + text + salt + key).digest('hex');
    const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(text)}&from=zh&to=en&appid=${appid}&salt=${salt}&sign=${sign}`;
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`百度翻译请求失败 (${response.status})`);
    const data = await response.json();
    if (data.trans_result?.[0]?.dst) return data.trans_result[0].dst;
    throw new Error(data.error_msg || 'Translation failed');
  };
}

async function translateSectionsForVq({ quote, sections, translateText = createBaiduTranslator() }) {
  const copies = (sections || []).map(section => {
    let payload = {};
    try { payload = JSON.parse(section.payload_json || '{}'); } catch {}
    return { ...section, payload };
  });
  const byDept = Object.fromEntries(copies.map(section => [section.dept, section.payload]));
  const cache = new Map();
  let translated = 0;
  let untranslated = 0;
  let firstError = '';

  async function translateOne(source, current = '') {
    const text = String(source || '').trim();
    const existing = String(current || '').trim();
    if (!text || existing) return existing;
    if (cache.has(text)) return cache.get(text);

    let result = FIXED_TRANSLATIONS.get(text) || customerEnglish(text);
    try {
      if (hasChinese(result)) {
        const parts = text.split('/').map(part => part.trim());
        const translatedParts = [];
        for (const part of parts) {
          if (!part || !hasChinese(part)) {
            translatedParts.push(part);
          } else {
            translatedParts.push(await translateText(part));
          }
        }
        result = translatedParts.join('/');
      }
    } catch (error) {
      result = '';
      untranslated++;
      if (!firstError) firstError = error.message;
    }
    cache.set(text, result);
    if (result) translated++;
    return result;
  }

  async function translateRows(rows, fields) {
    for (const row of rows || []) {
      for (const [sourceField, englishField] of fields) {
        row[englishField] = await translateOne(row[sourceField], row[englishField]);
      }
    }
  }

  const sales = byDept.sales || {};
  sales.vq_english = sales.vq_english || {};
  sales.vq_english.product_name = await translateOne(
    quote?.product_name,
    sales.vq_english.product_name
  );

  const molding = byDept.molding || {};
  await translateRows(molding.injection, [
    ['name', 'eng_name'],
    ['material', 'material_eng'],
  ]);

  const engineering = byDept.engineering || {};
  for (const key of ['electronics', 'hardware', 'aux_materials', 'packaging_materials']) {
    await translateRows(engineering[key], [
      ['name', 'eng_name'],
      ['spec', 'spec_eng'],
      ['note', 'note_eng'],
    ]);
  }

  const electronic = byDept.electronic || {};
  await translateRows(electronic.electronics, [
    ['name', 'eng_name'],
    ['spec', 'spec_eng'],
  ]);

  const sewing = byDept.sewing || {};
  for (const group of sewing.sewing_groups || []) {
    group.eng_name = await translateOne(group.name, group.eng_name);
    await translateRows(group.items, [
      ['fabric', 'eng_name'],
      ['part', 'part_eng'],
    ]);
  }

  const slush = byDept.slush || {};
  await translateRows(slush.slush_items, [['name', 'eng_name']]);

  return {
    translated,
    untranslated,
    warning: firstError,
    sections: copies.map(({ payload, ...section }) => ({
      ...section,
      payload_json: JSON.stringify(payload),
    })),
  };
}

module.exports = {
  createBaiduTranslator,
  translateSectionsForVq,
};
