// ToyQMS AI assistant — Moonshot (Kimi) API integration.
// Translates pending complaints into Chinese drafts and suggests issue-type
// classifications. Every AI result is a DRAFT: it only enters statistics
// after a human confirms it in the UI.
//
// Configuration (server environment):
//   MOONSHOT_API_KEY   — required; without it /api/ai/* returns 503
//   MOONSHOT_BASE_URL  — optional, default https://api.moonshot.cn/v1
//     (any OpenAI-compatible endpoint works, e.g. OpenRouter:
//      https://openrouter.ai/api/v1)
//   MOONSHOT_MODEL     — optional, default kimi-k2-0905-preview
//     (on OpenRouter use e.g. moonshotai/kimi-k2-0905)
//   MOONSHOT_MAX_TOKENS — optional, default 8000

const DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const DEFAULT_MODEL = "kimi-k2-0905-preview";
const CHUNK_SIZE = 10;
const REQUEST_TIMEOUT_MS = 90_000;

export function aiConfigured() {
  return Boolean(process.env.MOONSHOT_API_KEY?.trim());
}

export function modelName() {
  return process.env.MOONSHOT_MODEL?.trim() || DEFAULT_MODEL;
}

function config() {
  const apiKey = process.env.MOONSHOT_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error("AI 功能未配置：请在服务器环境变量中设置 MOONSHOT_API_KEY 后重启服务。");
    error.statusCode = 503;
    throw error;
  }
  return {
    apiKey,
    baseUrl: (process.env.MOONSHOT_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.MOONSHOT_MODEL?.trim() || DEFAULT_MODEL,
  };
}

async function chat(systemPrompt, userPrompt) {
  const { apiKey, baseUrl, model } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: Number(process.env.MOONSHOT_MAX_TOKENS || 8000),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("AI 服务响应超时，请稍后重试。");
    throw new Error("无法连接 AI 服务，请检查服务器网络。");
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`AI 服务返回错误：${detail}`);
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 服务没有返回有效内容。");
  return content;
}

function parseJsonArray(content, key) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI 返回内容无法解析。");
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.[key];
  if (!Array.isArray(list)) throw new Error("AI 返回格式不符合预期。");
  return list;
}

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

// ---------- translation ----------

const TRANSLATE_SYSTEM = [
  "你是玩具制造业质量投诉的专业翻译。把英文客户投诉翻译成准确、通顺的简体中文。",
  "要求：",
  "1. 保留所有 SKU、型号、订单号、日期、数字和品牌名原文，不要翻译；",
  "2. 忠实原文，不添加、不省略、不评论；",
  "3. 涉及安全隐患（窒息、尖点、小零件、过热等）的描述必须准确翻译；",
  "4. 只输出 JSON，格式：{\"items\":[{\"index\":0,\"translation\":\"…\"}]}，index 与输入一一对应。",
].join("\n");

export async function translateBatch(records) {
  const results = new Map(); // id -> { translation } | { error }
  for (const part of chunk(records, CHUNK_SIZE)) {
    const payload = part.map((record, index) => ({ index, text: record.complaintMessageOriginal }));
    try {
      const content = await chat(TRANSLATE_SYSTEM, JSON.stringify({ items: payload }));
      const items = parseJsonArray(content, "items");
      for (const item of items) {
        const record = part[Number(item?.index)];
        const translation = String(item?.translation || "").trim();
        if (record && translation) results.set(record.id, { translation });
      }
      for (const record of part) if (!results.has(record.id)) results.set(record.id, { error: "AI 未返回该条译文。" });
    } catch (error) {
      for (const record of part) results.set(record.id, { error: error instanceof Error ? error.message : "翻译失败。" });
    }
  }
  return results;
}

// ---------- classification ----------

const CLASSIFY_SYSTEM = [
  "你是玩具制造业质量投诉的分类专家。根据英文投诉原文，从给定的问题类型清单中选择最匹配的一个。",
  "要求：",
  "1. 只能从给定清单中选择 issueType，原样返回英文名称，不得编造新类型；",
  "2. confidence 为 0 到 1 的小数，表示你对该分类的把握；",
  "3. reason 用一句简体中文说明判断依据；",
  "4. 若清单中没有合适类型，issueType 返回 null，confidence 返回 0，reason 说明原因；",
  "5. 只输出 JSON，格式：{\"items\":[{\"index\":0,\"issueType\":\"…\",\"confidence\":0.9,\"reason\":\"…\"}]}。",
].join("\n");

export async function classifyBatch(records, issueTypes) {
  const results = new Map(); // id -> { issueType, confidence, reason } | { error }
  const typeList = issueTypes.map((item) => item.chineseName && item.chineseName !== item.name ? `${item.name}（${item.chineseName}）` : item.name).join("\n");
  for (const part of chunk(records, CHUNK_SIZE)) {
    const payload = part.map((record, index) => ({ index, text: record.complaintMessageOriginal }));
    const userPrompt = `问题类型清单：\n${typeList}\n\n待分类投诉：\n${JSON.stringify({ items: payload })}`;
    try {
      const content = await chat(CLASSIFY_SYSTEM, userPrompt);
      const items = parseJsonArray(content, "items");
      for (const item of items) {
        const record = part[Number(item?.index)];
        if (!record) continue;
        const issueType = typeof item?.issueType === "string" && issueTypes.some((type) => type.name === item.issueType) ? item.issueType : null;
        const confidence = Math.max(0, Math.min(1, Number(item?.confidence) || 0));
        const reason = String(item?.reason || "").trim();
        results.set(record.id, { issueType, confidence, reason });
      }
      for (const record of part) if (!results.has(record.id)) results.set(record.id, { error: "AI 未返回该条建议。" });
    } catch (error) {
      for (const record of part) results.set(record.id, { error: error instanceof Error ? error.message : "分类失败。" });
    }
  }
  return results;
}
