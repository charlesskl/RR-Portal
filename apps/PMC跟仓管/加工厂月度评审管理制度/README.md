# Vue 3 + TypeScript + Vite

This template should help get you started developing with Vue 3 and TypeScript in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

Learn more about the recommended Project Setup and IDE Support in the [Vue Docs TypeScript Guide](https://vuejs.org/guide/typescript/overview.html#project-setup).


## 动态分析中心与AI综合分析（两期统一部署）

规则预警在首页、工厂详情及 `/analysis` 提供整改逾期、评级下降和交期风险。
AI综合分析为主动调用，用户选择不超过180天的范围和可选工厂后提问；读取当前账号有权限的巡查、品质检验、订单、评分和产值。
订单以约定交期、巡查以检查日期、检验以送货日期筛选，月度数据以范围涉及的整月筛选；不包含无日期及范围外记录。最多500条明细，超限明确要求缩小范围，不静默截取。

### 部署前配置

本期默认关闭AI服务，不提供默认模型或密钥。规则预警不依赖外部AI。
运维在服务器的 `.env.cloud.production` 配置专用变量，密钥不能使用 `VITE_` 前缀、不能提交到Git，也不要写进聊天或日志：

```dotenv
FACTORY_REVIEW_AI_ENABLED=false
FACTORY_REVIEW_AI_API_KEY=
FACTORY_REVIEW_AI_MODEL=
FACTORY_REVIEW_AI_BASE_URL=https://api.openai.com/v1
```

开通服务后，配置支持 OpenAI Responses API 和严格结构化输出的模型ID、专用密钥，再将 ENABLED 改为 true 并重新创建 factory-review 容器。
测试版对应 `FACTORY_REVIEW_TEST_AI_ENABLED/API_KEY/MODEL/BASE_URL`，必须独立配置，不继承正式密钥。
管理员可在“动态分析中心 → AI综合分析 → AI服务配置入口”查看配置方法与刷新状态；不会返回或接收密钥。
只配置变量不会证明模型可用：先在测试版使用合成数据完成真实模型验收，再统一部署两期。当前未开通服务时，不应宣称真实AI已上线。

随镜像部署同时应用 `1792454400_create_analysis_followups.js` 与 `1792454500_create_analysis_ai_usage.js`。
前者保存个人跟进状态；后者为仅服务端可读写的限额台账，仅保存账号、调用时间及分钟去重标识，不存问题、业务明细、密钥或模型答案。
台账保留约30天，清理任务每天运行。每账号每分钟1次、北京时间每天20次；上游失败也占额度。AI请求45秒超时，无自动付费重试。
浏览器只向自有后端提交日期、工厂和问题；服务端重新取证、校验模块/部门/厂区及原集合查看规则，再请求模型。模型调用前后重新校验账号和相关记录快照。工厂使用临时代号，联系人字段、照片和订单价格不进入模型请求；业务自由文本仍应按实际敏感程度管理。
结果引用只能指向本次已授权证据；无效引用、未完成或异常输出不展示为成功。回答是当前快照的辅助判断，不自动修改业务数据。服务不可用时规则预警仍保留。
请求使用 `store:false`，不代表供应商的零数据留存承诺。接入规范参考 [OpenAI结构化输出文档](https://developers.openai.com/api/docs/guides/structured-outputs) 和 [数据控制文档](https://developers.openai.com/api/docs/guides/your-data)。

### 验证与回滚

```sh
npm test -- tests/AnalysisAiPanel.spec.ts tests/dynamicAnalysis.spec.ts tests/dynamicAnalysisLoading.spec.ts
POCKETBASE_BINARY=/path/to/pocketbase-0.39.6 npm run test:analysis-backend
npm run build
```

AI后端集成测试只连接本机模拟上游，不调用真实模型，不使用真实业务数据。
测试专用 `FACTORY_REVIEW_AI_LOCAL_TEST=true` 仅允许本机HTTP模拟服务，不应加入正式或测试部署环境配置。
可先将 ENABLED=false 并重建容器关闭AI；不影响规则预警。回滚迁移会移除对应个人状态或调用台账，需按既有数据库备份流程处理。
