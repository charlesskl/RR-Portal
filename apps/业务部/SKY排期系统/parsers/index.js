const tomy = require('./tomy');
const skycastle = require('./skycastle');
const jazwares = require('./jazwares');

// 顺序重要：JAZ 和 skycastle 都有 "Purchase Order"，但 JAZ 额外有 "PO # :Date :" 特征
// 先检 tomy 再 jaz 再 skycastle
const parsers = [require('./skycastle-current'), tomy, jazwares, skycastle];

/**
 * 自动检测PO类型并解析
 * @param {string} text - PDF提取的文本
 * @param {string} filename - 文件名
 * @returns {object} 解析结果
 */
function autoParse(text, filename) {
  for (const parser of parsers) {
    if (parser.detect(text)) {
      return parser.parse(text, filename);
    }
  }
  return {
    client: '未知',
    poNumber: '',
    items: [],
    filename,
    error: '无法识别PO格式，请检查PDF文件',
  };
}

module.exports = { autoParse };
