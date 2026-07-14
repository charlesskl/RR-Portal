const { parseBeihuoImage } = require('./beihuoImageParser');
const { parseImageOrders } = require('./imageParser');
const {
  parseImageWithQwen,
  getAiReviewReasons,
  mergeRuleAndAiOrders,
} = require('./qwenOcr');

function createPipelineError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function emptyAiReview(available) {
  return {
    available,
    status: 'not_needed',
    suspect_rows: 0,
    reviewed_rows: 0,
    corrected_fields: 0,
  };
}

async function parseImageOrderWithFallback(imagePath, options = {}) {
  const recognitionMode = String(options.recognitionMode || 'auto').trim().toLowerCase();
  const aiOnly = recognitionMode === 'ai';
  const aiAvailable = Boolean(process.env.BAILIAN_API_KEY);
  let orders = [];
  let parser = 'unknown';
  let aiReview = emptyAiReview(aiAvailable);
  let fixedError = null;
  let aiError = null;
  let localError = null;

  if (aiOnly) {
    if (!aiAvailable) {
      throw createPipelineError(
        'AI重新识别未启用：本机未配置 BAILIAN_API_KEY。配置百炼视觉识别密钥并重启服务后即可使用。',
        503,
      );
    }
    try {
      orders = await parseImageWithQwen(imagePath);
      if (orders.length === 0) throw new Error('AI未识别出订单行');
      parser = 'qwen-image-vision';
      aiReview = {
        available: true,
        status: 'forced',
        suspect_rows: 0,
        reviewed_rows: orders.length,
        corrected_fields: 0,
        message: '已完全改用AI重新识别，请核对后导入',
      };
      return { orders, parser, aiReview };
    } catch (error) {
      throw createPipelineError('AI重新识别失败：' + error.message, 502);
    }
  }

  try {
    const fixedResult = await parseBeihuoImage(imagePath);
    if (fixedResult && fixedResult.orders.length > 0) {
      orders = fixedResult.orders;
      parser = fixedResult.template || 'beihuo-image-grid';
      console.log('[啤货表图片解析命中]', parser, '→', orders.length, '条');
    }
  } catch (error) {
    fixedError = error;
    console.log('[啤货表图片解析异常]:', error.message);
  }

  if (orders.length > 0) {
    const suspectRows = orders.filter(row => getAiReviewReasons(row).length > 0);
    if (suspectRows.length > 0 && aiAvailable) {
      try {
        const aiOrders = await parseImageWithQwen(imagePath);
        if (aiOrders.length === 0) throw new Error('AI未识别出订单行');
        const merged = mergeRuleAndAiOrders(orders, aiOrders);
        orders = merged.orders;
        if (merged.corrected_fields > 0) parser += '+qwen-review';
        aiReview = {
          available: true,
          status: 'applied',
          suspect_rows: suspectRows.length,
          reviewed_rows: aiOrders.length,
          corrected_fields: merged.corrected_fields,
          corrections: merged.corrections,
          message: merged.corrected_fields > 0
            ? 'AI已补全或修正 ' + merged.corrected_fields + ' 个异常字段'
            : 'AI已复核，未发现可安全自动替换的字段',
        };
        console.log('[AI自动复核] 疑点', suspectRows.length, '行，修正', merged.corrected_fields, '个字段');
      } catch (error) {
        aiError = error;
        aiReview = {
          available: true,
          status: 'failed',
          suspect_rows: suspectRows.length,
          reviewed_rows: 0,
          corrected_fields: 0,
          message: 'AI复核失败：' + error.message,
        };
        console.log('[AI自动复核失败]:', error.message);
      }
    } else if (suspectRows.length > 0) {
      aiReview = {
        available: false,
        status: 'not_configured',
        suspect_rows: suspectRows.length,
        reviewed_rows: 0,
        corrected_fields: 0,
        message: '规则结果存在疑点，但本机未配置AI识别密钥',
      };
    }
    return { orders, parser, aiReview };
  }

  if (aiAvailable) {
    try {
      orders = await parseImageWithQwen(imagePath);
      if (orders.length > 0) {
        parser = 'qwen-image-vision';
        aiReview = {
          available: true,
          status: 'fallback',
          suspect_rows: 0,
          reviewed_rows: orders.length,
          corrected_fields: 0,
          message: '规则未识别到订单，已自动切换AI识别',
        };
        console.log('[AI自动兜底] 解析结果:', orders.length, '条');
        return { orders, parser, aiReview };
      }
    } catch (error) {
      aiError = error;
      console.log('[AI自动兜底失败]:', error.message);
    }
  } else {
    aiError = new Error('未配置云端图片识别密钥');
  }

  try {
    const localResult = await parseImageOrders(imagePath);
    orders = localResult.orders || [];
    if (orders.length > 0) {
      parser = 'local-image-ocr';
      const suspectRows = orders.filter(row => getAiReviewReasons(row).length > 0);
      if (suspectRows.length > 0 && !aiAvailable) {
        aiReview = {
          available: false,
          status: 'not_configured',
          suspect_rows: suspectRows.length,
          reviewed_rows: 0,
          corrected_fields: 0,
          message: '本地OCR结果存在疑点，但本机未配置AI识别密钥',
        };
      }
      console.log('[本地通用图片OCR] 解析结果:', orders.length, '条');
      return { orders, parser, aiReview };
    }
  } catch (error) {
    localError = error;
    console.log('[本地通用图片OCR失败]:', error.message);
  }

  const reason = localError || fixedError || aiError;
  throw createPipelineError(
    '图片未解析出订单数据'
      + (reason ? '：' + reason.message : '')
      + '。建议上传完整、清晰且未裁掉表头的原图。',
  );
}

module.exports = { parseImageOrderWithFallback };
