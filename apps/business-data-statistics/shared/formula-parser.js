/**
 * 公式解析器 — 前后端共用
 *
 * 功能：
 * - 解析公式文本（如 {daily_output} - SUM(expense)）
 * - 展开 SUM(标签名) 为具体字段求和
 * - 替换 {字段名} 为实际数值
 * - 支持链式计算（引用前序公式结果）
 * - 使用 expr-eval 安全求值（不用 eval）
 * - 精度控制和错误处理
 *
 * 共享方式：UMD 模式
 * - Node.js: const FormulaParser = require('./shared/formula-parser')
 * - 浏览器: <script src="/shared/formula-parser.js"> → window.FormulaParser
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js 环境
    const exprEval = require('expr-eval');
    module.exports = factory(exprEval.Parser);
  } else {
    // 浏览器环境：expr-eval 暴露全局 exprEval.Parser
    root.FormulaParser = factory(root.exprEval.Parser);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ExprParser) {

  // expr-eval 实例，禁用不安全的操作
  const parser = new ExprParser({
    operators: {
      logical: false,
      comparison: false,
      assignment: false,
      'in': false,
      conditional: false
    }
  });

  /**
   * 展开 SUM(标签名) — 将 SUM(expense) 替换为 (field1 + field2 + ...)
   *
   * @param {string} formulaText - 公式文本
   * @param {Object} tags - 标签映射，如 { expense: ['worker_wage', 'supervisor_wage', ...] }
   * @param {string} department - 当前部门 key（用于合并 _shared 和部门特有标签）
   * @returns {string} 展开后的公式文本
   */
  function expandSUM(formulaText, tags, department) {
    return formulaText.replace(/SUM\((\w+)\)/g, function (match, tagName) {
      // 合并 _shared 和部门特有的同名标签字段
      const sharedFields = (tags['_shared'] && tags['_shared'][tagName]) || [];
      const deptFields = (department && tags[department] && tags[department][tagName]) || [];
      const fields = [...new Set([...sharedFields, ...deptFields])];

      if (fields.length === 0) {
        // 标签无对应字段，返回 0 并记录警告
        console.warn('[FormulaParser] SUM(' + tagName + ') 未找到对应字段');
        return '0';
      }
      // 展开为 ({field1} + {field2} + ...)，保留花括号供后续替换
      return '(' + fields.map(function(f) { return '{' + f + '}'; }).join(' + ') + ')';
    });
  }

  /**
   * 替换 {字段名} 为实际数值
   *
   * @param {string} formulaText - 展开 SUM 后的公式文本
   * @param {Object} data - 当前行数据
   * @param {Object} prevResults - 前序公式计算结果
   * @returns {{ expression: string, warnings: string[] }}
   */
  function substituteFields(formulaText, data, prevResults) {
    var warnings = [];

    var expression = formulaText.replace(/\{(\w+)\}/g, function (match, fieldKey) {
      // 优先从前序结果取值（链式计算）
      if (prevResults && prevResults[fieldKey] !== undefined && prevResults[fieldKey] !== null) {
        return String(prevResults[fieldKey]);
      }
      // 再从当前行数据取值
      if (data && data[fieldKey] !== undefined && data[fieldKey] !== null) {
        var val = parseFloat(data[fieldKey]);
        if (isNaN(val)) {
          warnings.push('字段 ' + fieldKey + ' 值无法转为数字');
          return '0';
        }
        return String(val);
      }
      // 字段缺失
      warnings.push('字段 ' + fieldKey + ' 缺失');
      return '0';
    });

    return { expression: expression, warnings: warnings };
  }

  /**
   * 替换 $常量名 为实际数值
   *
   * @param {string} formulaText - 公式文本
   * @param {Object} constants - 常量映射，如 { tax_rate: 1.13, exchange_rate: 0.8 }
   * @returns {{ expression: string, warnings: string[] }}
   */
  function substituteConstants(formulaText, constants) {
    var warnings = [];
    var expression = formulaText.replace(/\$(\w+)/g, function (match, constName) {
      if (constants && constants[constName] !== undefined && constants[constName] !== null) {
        return String(constants[constName]);
      }
      warnings.push('常量 $' + constName + ' 未定义');
      return '0';
    });
    return { expression: expression, warnings: warnings };
  }

  /**
   * 安全求值
   *
   * @param {string} expression - 纯数学表达式字符串
   * @returns {number|null} 计算结果，出错返回 null
   */
  function safeEvaluate(expression) {
    try {
      var result = parser.evaluate(expression);
      // 处理除以零（Infinity / -Infinity / NaN）
      if (!isFinite(result) || isNaN(result)) {
        return 0;
      }
      return result;
    } catch (e) {
      console.error('[FormulaParser] 求值错误:', expression, e.message);
      return null;
    }
  }

  /**
   * 计算单个公式
   *
   * @param {Object} formulaConfig - 公式配置对象
   *   - formula_text: 公式文本
   *   - decimal_places: 小数位数
   *   - display_format: 显示格式
   * @param {Object} data - 当前行的字段数据
   * @param {Object} tags - 标签映射（按部门分组）
   * @param {Object} prevResults - 前序公式结果
   * @param {string} department - 部门 key
   * @param {Object} constants - 常量映射，如 { tax_rate: 1.13 }（可选）
   * @returns {{ value: number|null, warnings: string[] }}
   */
  function calculateFormula(formulaConfig, data, tags, prevResults, department, constants) {
    var formulaText = formulaConfig.formula_text;
    var decimalPlaces = formulaConfig.decimal_places != null ? formulaConfig.decimal_places : 2;

    // 第 1 步：展开 SUM()
    var expanded = expandSUM(formulaText, tags || {}, department);

    // 第 2 步：替换 $常量
    var constResult = substituteConstants(expanded, constants || {});
    var allWarnings = constResult.warnings.slice();

    // 第 3 步：替换 {字段} 引用
    var fieldResult = substituteFields(constResult.expression, data, prevResults);
    allWarnings = allWarnings.concat(fieldResult.warnings);

    // 第 4 步：安全求值
    var value = safeEvaluate(fieldResult.expression);

    // 第 5 步：精度处理
    if (value !== null) {
      var factor = Math.pow(10, decimalPlaces);
      value = Math.round(value * factor) / factor;
    }

    return { value: value, warnings: allWarnings };
  }

  /**
   * 链式计算：按 sort_order 顺序依次计算所有公式
   *
   * @param {Array} formulas - 公式配置数组（已按 sort_order 排序）
   * @param {Object} data - 当前行数据
   * @param {Object} tags - 标签映射
   * @param {string} department - 部门 key
   * @param {Object} constants - 常量映射（可选）
   * @returns {{ results: Object, warnings: Object }}
   *   results: { field_key: value, ... }
   *   warnings: { field_key: [warning1, ...], ... }
   */
  function calculateAll(formulas, data, tags, department, constants) {
    var results = {};
    var allWarnings = {};

    for (var i = 0; i < formulas.length; i++) {
      var formula = formulas[i];
      if (formula.enabled === false) continue;

      var calc = calculateFormula(formula, data, tags, results, department, constants);
      results[formula.field_key] = calc.value;

      if (calc.warnings.length > 0) {
        allWarnings[formula.field_key] = calc.warnings;
      }
    }

    return { results: results, warnings: allWarnings };
  }

  /**
   * 验证公式文本
   *
   * @param {string} formulaText - 公式文本
   * @param {Array} availableFields - 可用字段列表 ['field1', 'field2', ...]
   * @param {Object} availableTags - 可用标签 { expense: [...], ... }
   * @param {Array} formulaKeys - 已有公式 field_key 列表（用于循环引用检测）
   * @param {string} selfKey - 当前公式自身的 field_key
   * @returns {{ valid: boolean, errors: string[] }}
   */
  function validateFormula(formulaText, availableFields, availableTags, formulaKeys, selfKey, availableConstants) {
    var errors = [];
    var fieldSet = new Set(availableFields || []);
    var tagSet = new Set(Object.keys(availableTags || {}));
    var formulaKeySet = new Set(formulaKeys || []);

    // 检查括号匹配
    var depth = 0;
    for (var i = 0; i < formulaText.length; i++) {
      if (formulaText[i] === '(') depth++;
      else if (formulaText[i] === ')') depth--;
      if (depth < 0) { errors.push('括号不匹配：多余的右括号'); break; }
    }
    if (depth > 0) errors.push('括号不匹配：缺少右括号');

    // 检查 SUM() 内的标签名是否存在
    var sumPattern = /SUM\((\w+)\)/g;
    var sumMatch;
    while ((sumMatch = sumPattern.exec(formulaText)) !== null) {
      if (!tagSet.has(sumMatch[1])) {
        errors.push('SUM(' + sumMatch[1] + ') 中的标签 "' + sumMatch[1] + '" 不存在');
      }
    }

    // 检查 {字段名} 是否存在
    var fieldPattern = /\{(\w+)\}/g;
    var fieldMatch;
    var referencedFields = [];
    while ((fieldMatch = fieldPattern.exec(formulaText)) !== null) {
      var fk = fieldMatch[1];
      referencedFields.push(fk);
      // 字段可以是输入字段或其他公式的 field_key
      if (!fieldSet.has(fk) && !formulaKeySet.has(fk)) {
        errors.push('字段 {' + fk + '} 不存在');
      }
    }

    // 检查 $常量名 是否存在
    var constSet = new Set(availableConstants || []);
    var constPattern = /\$(\w+)/g;
    var constMatch;
    while ((constMatch = constPattern.exec(formulaText)) !== null) {
      if (constSet.size > 0 && !constSet.has(constMatch[1])) {
        errors.push('常量 $' + constMatch[1] + ' 未定义');
      }
    }

    // 检查自引用
    if (selfKey && referencedFields.indexOf(selfKey) !== -1) {
      errors.push('公式不能引用自身 {' + selfKey + '}');
    }

    // 尝试将 SUM 展开后做一次语法检查（用 0 替代所有字段和常量）
    try {
      var testExpr = formulaText
        .replace(/SUM\(\w+\)/g, '0')
        .replace(/\{\w+\}/g, '1')
        .replace(/\$\w+/g, '1');
      parser.evaluate(testExpr);
    } catch (e) {
      errors.push('公式语法错误: ' + e.message);
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // ===== 公开 API =====
  return {
    calculateFormula: calculateFormula,
    calculateAll: calculateAll,
    validateFormula: validateFormula,
    expandSUM: expandSUM,
    substituteFields: substituteFields,
    substituteConstants: substituteConstants,
    safeEvaluate: safeEvaluate
  };
});
