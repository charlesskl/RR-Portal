'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { translateSectionsForVq } = require('../backend/services/vqTranslate');

test('VQ auto-translate stores English fields in internal quote section payloads', async () => {
  const apiCalls = [];
  const translateText = async text => {
    apiCalls.push(text);
    return {
      '神秘角色': 'Mystery Character',
      '特制闪光布': 'Special Glitter Fabric',
      '左耳': 'Left Ear',
    }[text] || `EN:${text}`;
  };
  const result = await translateSectionsForVq({
    quote: { product_name: '神秘角色' },
    translateText,
    sections: [
      { id: 1, dept: 'sales', payload_json: '{}' },
      {
        id: 2,
        dept: 'sewing',
        payload_json: JSON.stringify({
          sewing_groups: [{
            name: '神秘角色',
            items: [{ fabric: '特制闪光布', part: '左耳' }],
          }],
        }),
      },
      {
        id: 3,
        dept: 'electronic',
        payload_json: JSON.stringify({
          electronics: [{ name: 'PACB电子', spec: '定制线路' }],
        }),
      },
    ],
  });

  const payloads = Object.fromEntries(result.sections.map(section => [
    section.dept,
    JSON.parse(section.payload_json),
  ]));
  assert.equal(payloads.sales.vq_english.product_name, 'Mystery Character');
  assert.equal(payloads.sewing.sewing_groups[0].eng_name, 'Mystery Character');
  assert.equal(payloads.sewing.sewing_groups[0].items[0].eng_name, 'Special Glitter Fabric');
  assert.equal(payloads.sewing.sewing_groups[0].items[0].part_eng, 'Left Ear');
  assert.equal(payloads.electronic.electronics[0].eng_name, 'PACB Electronics');
  assert.equal(payloads.electronic.electronics[0].spec_eng, 'EN:定制线路');
  assert.equal(apiCalls.filter(text => text === '神秘角色').length, 1);
});

test('VQ auto-translate preserves manually entered English names', async () => {
  const result = await translateSectionsForVq({
    quote: { product_name: '红色公仔' },
    translateText: async text => `EN:${text}`,
    sections: [{
      id: 1,
      dept: 'slush',
      payload_json: JSON.stringify({
        slush_items: [{ name: '搪胶头', eng_name: 'Rotocast Head (Manual)' }],
      }),
    }],
  });

  const payload = JSON.parse(result.sections[0].payload_json);
  assert.equal(payload.slush_items[0].eng_name, 'Rotocast Head (Manual)');
});
