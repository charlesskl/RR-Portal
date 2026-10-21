# Vue 3 + TypeScript + Vite

## 巡查总结新版02

主表按“2026年10月16日湖南加工厂检查总结02.xlsx”的列序展示责任范围、责任主管、
加工费（万）、评级及整改内容。加工费保存原统计期间；跨期间查询时在各金额下显示期间，
不将不同累计期间的费用合并。主表隐藏计划完成时间，原数据仍可编辑并参加历史对比。
整改完成时间中的分项日期或文字保存在 `completion_details` 并原文展示，不推断单一完成日期；
明确的完整日期仍保存在 `completed_date`。规则预警不会据这些自由文本自动认定整改完成。

部署前应用增量迁移 `1792537200_extend_patrol_template02.js`，再部署对应前端及巡查校验钩子。
迁移只添加字段，保留既有巡查和权限。新旧Excel模板均可导入；同厂同日仍跳过，不自动覆盖已有记录。
新增字段可通过编辑既有记录补充。回退前端时保留该迁移，避免删除已收集的新字段数据。

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
FACTORY_REVIEW_AI_PROVIDER=openai
FACTORY_REVIEW_AI_ENABLED=false
FACTORY_REVIEW_AI_API_KEY=
FACTORY_REVIEW_AI_MODEL=
FACTORY_REVIEW_AI_BASE_URL=https://api.openai.com/v1
```

开通服务后，选择提供商（openai 或 qwen），配置对应的模型ID、专用密钥和地址，再将 ENABLED 改为 true 并重新创建 factory-review 容器。
测试版对应 `FACTORY_REVIEW_TEST_AI_ENABLED/API_KEY/MODEL/BASE_URL`，必须独立配置，不继承正式密钥。
管理员可在“动态分析中心 → AI综合分析 → AI服务配置入口”查看配置方法与刷新状态；不会返回或接收密钥。
只配置变量不会证明模型可用：先在测试版使用合成数据完成真实模型验收，再统一部署两期。当前未开通服务时，不应宣称真实AI已上线。

随镜像部署同时应用 `1792454400_create_analysis_followups.js` 与 `1792454500_create_analysis_ai_usage.js`。
前者保存个人跟进状态；后者为仅服务端可读写的限额台账，仅保存账号、调用时间及分钟去重标识，不存问题、业务明细、密钥或模型答案。
台账保留约30天，清理任务每天运行。每账号每分钟1次、北京时间每天20次；上游失败也占额度。AI请求45秒超时，无自动付费重试。
浏览器只向自有后端提交日期、工厂和问题；服务端重新取证、校验模块/部门/厂区及原集合查看规则，再请求模型。模型调用前后重新校验账号和相关记录快照。工厂使用临时代号，联系人字段、照片和订单价格不进入模型请求；业务自由文本仍应按实际敏感程度管理。
结果引用只能指向本次已授权证据；无效引用、未完成或异常输出不展示为成功。回答是当前快照的辅助判断，不自动修改业务数据。服务不可用时规则预警仍保留。
OpenAI 请求使用 `store:false`，不代表供应商的零数据留存承诺。接入规范参考 [OpenAI结构化输出文档](https://developers.openai.com/api/docs/guides/structured-outputs) 和 [数据控制文档](https://developers.openai.com/api/docs/guides/your-data)。

### 验证与回滚

```sh
npm test -- tests/AnalysisAiPanel.spec.ts tests/dynamicAnalysis.spec.ts tests/dynamicAnalysisLoading.spec.ts
POCKETBASE_BINARY=/path/to/pocketbase-0.39.6 npm run test:analysis-backend
npm run build
```

AI后端集成测试只连接本机模拟上游，不调用真实模型，不使用真实业务数据。
测试专用 `FACTORY_REVIEW_AI_LOCAL_TEST=true` 仅允许本机HTTP模拟服务，不应加入正式或测试部署环境配置。
可先将 ENABLED=false 并重建容器关闭AI；不影响规则预警。回滚迁移会移除对应个人状态或调用台账，需按既有数据库备份流程处理。


## PMC到期交付登记提醒

登录后进入货期管理首页、部门列表或延期列表，按北京时间当天检查约定交期已到且尚无实际交付日期的本人订单。
页面可见时每60秒检查，返回页面时补查；在输入、已有弹窗或订单编辑页不会自动抢占焦点。
关闭网页不会发送系统外通知。支持本机一小时延后提醒及手动查看，交期变更按新交期重新判断。

旧订单的PMC是姓名文本：仅在其精确匹配当前账号且系统中该姓名唯一时提醒；PMC为空才回退到创建账号。
已有其他PMC姓名的订单不会因管理员代为导入而提醒管理员。同名账号不唯一时显示提示；姓名不一致的历史订单需核对下单PMC与账号姓名，不做模糊匹配。
后端同时检查订单模块编辑/查看权限、部门、订单管理厂区和原记录查看规则。已交付、取消、退货或已有实际交货日期均排除。
最多展示最近到期的500条，超过时明确提示，处理后继续显示其余记录。旧记录不会因逾期时间长而自动关闭。

“去登记交付情况”定位原订单的交期登记栏。已交付填写实际交货日期；未交付在生产进度栏补充原因。
本功能无需迁移，部署需同时包含前端、`pb_hooks/delivery_reminders.pb.js` 及已有 `pb_hooks/lib/analysis_ai.js` 权限工具；不调用AI服务。

验证：`npm test -- tests/DeliveryReminder.spec.ts tests/OrderDeliveryRegistration.spec.ts`；
`POCKETBASE_BINARY=/path/to/pocketbase-0.39.6 npm run test:delivery-reminders-backend`（只使用本机合成数据）。


### 阿里云百炼千问3接入

服务器 `.env.cloud.production` 设置 `FACTORY_REVIEW_AI_PROVIDER=qwen`、`FACTORY_REVIEW_AI_MODEL=qwen3-max`、`FACTORY_REVIEW_AI_ENABLED=true`，密钥填入 `FACTORY_REVIEW_AI_API_KEY`（不要提交代码、发到聊天或使用 VITE 环境变量）。模型须已在百炼账号开通。已有密钥还需确认变量名称正确并重新创建容器才能生效。

`FACTORY_REVIEW_AI_BASE_URL` 留空时千问使用北京地址 `https://dashscope.aliyuncs.com/compatible-mode/v1`；也可使用百炼控制台提供的业务空间专属 BASE_URL。地址必须与密钥地域一致，不含 `/chat/completions`。原配置若仍是 OpenAI 地址，必须清空或改为百炼地址。测试版独立使用 `FACTORY_REVIEW_TEST_AI_PROVIDER/API_KEY/MODEL/BASE_URL/ENABLED`。

适配 Chat Completions 非流式接口，关闭思考模式以使用 JSON Object 输出；服务器继续检查结构、长度及证据引用，拒绝截断或无效输出。仅点击分析时调用，每分钟1次、每天20次限制不变。未配置 provider 的旧部署仍走 OpenAI Responses。未使用真实业务数据进行付费接口测试。

官方参考：[OpenAI兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)。
