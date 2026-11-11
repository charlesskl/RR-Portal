'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../vendor/xlsx-js-style.min.js'), 'utf8'), context);
module.exports = { XLSX: context.XLSX, codec: require('../../draft-excel') };
