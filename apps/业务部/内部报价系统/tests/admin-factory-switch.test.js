'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const adminSource = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'admin.js'),
  'utf8',
);

function makeElement() {
  return {
    value: '',
    disabled: false,
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    appendChild() {},
    querySelector() { return makeElement(); },
  };
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('failed admin factory switch restores the previous factory and re-enables the selector', async () => {
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const alerts = [];
  let reloads = 0;

  const context = {
    document: {
      body: makeElement(),
      getElementById: getElement,
      querySelectorAll: () => [],
      createElement: makeElement,
    },
    fetch: async url => {
      if (url.endsWith('/auth/me')) {
        return {
          ok: true,
          json: async () => ({
            username: 'admin',
            display_name: 'Admin',
            active_factory_code: 'qingxi',
            can_switch_factory: true,
            factories: [
              { code: 'qingxi', name_cn: '清溪' },
              { code: 'heyuan', name_cn: '河源' },
            ],
            perms: { '账号管理': { can_admin: true } },
          }),
        };
      }
      if (url.endsWith('/admin/users')) return { ok: true, json: async () => [] };
      return {
        ok: false,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'switch failed' }),
      };
    },
    location: { href: '', reload: () => { reloads += 1; } },
    window: {},
    alert: message => alerts.push(message),
    confirm: () => false,
    prompt: () => null,
    setTimeout,
    clearTimeout,
    console,
  };

  vm.runInNewContext(adminSource, context, { filename: 'admin.js' });
  await settle();

  const factorySwitch = getElement('factory-switch');
  factorySwitch.value = 'heyuan';
  await factorySwitch.onchange();

  assert.equal(factorySwitch.value, 'qingxi');
  assert.equal(factorySwitch.disabled, false);
  assert.equal(reloads, 0);
  assert.deepEqual(alerts, ['switch failed']);
});
