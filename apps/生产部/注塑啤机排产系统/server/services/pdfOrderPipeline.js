const { pdfToImages, cleanupTmp } = require('./pdfToImages');
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

async function parsePdfWithQwen(pdfPath) {
  if (!process.env.BAILIAN_API_KEY) {
    throw createPipelineError(
      'AI重新识别未启用：本机未配置 BAILIAN_API_KEY。配置百炼视觉识别密钥并重启服务后即可使用。',
      503,
    );
  }

  const { tmpDir, files } = pdfToImages(pdfPath);
  try {
    if (files.length === 0) throw new Error('PDF没有可识别的页面');
    const orders = [];
    console.log('[PDF转PNG] 共', files.length, '页');
    for (let index = 0; index < files.length; index += 1) {
      console.log('[PDF→百炼] 处理第', index + 1, '/', files.length, '页');
      const pageOrders = await parseImageWithQwen(files[index]);
      orders.push(...pageOrders);
    }
    console.log('[百炼PDF识别] 共解析', orders.length, '条');
    return orders;
  } finally {
    cleanupTmp(tmpDir);
  }
}

async function forcePdfAiRecognition(pdfPath) {
  try {
    const orders = await parsePdfWithQwen(pdfPath);
    if (orders.length === 0) throw new Error('AI未识别出订单行');
    return {
      orders,
      parser: 'qwen-pdf-vision',
      aiReview: {
        available: true,
        status: 'forced',
        suspect_rows: 0,
        reviewed_rows: orders.length,
        corrected_fields: 0,
        message: '已完全改用AI重新识别PDF，请核对后导入',
      },
    };
  } catch (error) {
    if (error.statusCode === 503) throw error;
    throw createPipelineError('PDF AI重新识别失败：' + error.message, 502);
  }
}

async function reviewPdfOrders(pdfPath, ruleOrders, parser) {
  const aiAvailable = Boolean(process.env.BAILIAN_API_KEY);
  const suspectRows = ruleOrders.filter(row => getAiReviewReasons(row).length > 0);
  if (suspectRows.length === 0) {
    return { orders: ruleOrders, parser, aiReview: emptyAiReview(aiAvailable) };
  }
  if (!aiAvailable) {
    return {
      orders: ruleOrders,
      parser,
      aiReview: {
        available: false,
        status: 'not_configured',
        suspect_rows: suspectRows.length,
        reviewed_rows: 0,
        corrected_fields: 0,
        message: 'PDF规则结果存在疑点，但本机未配置AI识别密钥',
      },
    };
  }

  try {
    const aiOrders = await parsePdfWithQwen(pdfPath);
    if (aiOrders.length === 0) throw new Error('AI未识别出订单行');
    const merged = mergeRuleAndAiOrders(ruleOrders, aiOrders);
    return {
      orders: merged.orders,
      parser: merged.corrected_fields > 0 ? parser + '+qwen-review' : parser,
      aiReview: {
        available: true,
        status: 'applied',
        suspect_rows: suspectRows.length,
        reviewed_rows: aiOrders.length,
        corrected_fields: merged.corrected_fields,
        corrections: merged.corrections,
        message: merged.corrected_fields > 0
          ? 'AI已补全或修正 ' + merged.corrected_fields + ' 个PDF异常字段'
          : 'AI已复核PDF，未发现可安全自动替换的字段',
      },
    };
  } catch (error) {
    return {
      orders: ruleOrders,
      parser,
      aiReview: {
        available: true,
        status: 'failed',
        suspect_rows: suspectRows.length,
        reviewed_rows: 0,
        corrected_fields: 0,
        message: 'PDF AI复核失败：' + error.message,
      },
    };
  }
}

module.exports = {
  forcePdfAiRecognition,
  parsePdfWithQwen,
  reviewPdfOrders,
};
