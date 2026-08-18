# BOSS 有交换采集插件（Edge/Chrome）

这个目录是浏览器插件版本，目标是让采集开箱即用，不依赖本地 Python 运行。

## 功能

- 消息页增量采集（优先“有交换”）
- 当前处理会话高亮
- 账号隔离ID（同一插件内可切 `boss_a` / `boss_b`，数据互不混淆）
- 本地去重存储（IndexedDB）
- 会话签名断点续跑（避免重复刷旧会话）
- 一键导出 CSV（含序号列）

## 去重规则

- 有微信：`wx:{微信号}`
- 否则有电话：`tel:{电话}`
- 否则：`namejob:{HR姓名}_{岗位名称}`

## 增量策略（解决“老会话被顶到顶部”）

- 每个左侧会话会生成 `session_key`（姓名+岗位）和 `signature`（会话预览+时间等）
- 插件保存上次 `signature`
- 本次扫描时：
  - `signature` 未变化 -> 视为已处理，跳过
  - `signature` 变化 -> 重新进入会话提取（适配 HR 新消息后被顶到顶部）

## 安装（Edge）

1. 打开 `edge://extensions`
2. 开启「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择目录：`/Users/rec/codex/boss_zhipin_exchange_plugin`

## 使用步骤

1. 在 Edge 打开并登录 BOSS：`https://www.zhipin.com/web/geek/chat`
2. 手动切到「有交换」列表（建议）
3. 点击插件图标打开侧边栏
4. 先设置「账号隔离ID」（示例：`boss_a`、`boss_b`）
5. 点击「开始」启动采集（运行中同一按钮会变成「结束」）
6. 完成后点击「导出CSV」

## 数据存储位置

- 浏览器本地 IndexedDB（按账号隔离ID分库）：
  - 默认兼容旧数据：`boss_exchange_collector`
  - `boss_exchange_collector__boss_a`
  - `boss_exchange_collector__boss_b`
- 不上传云端

## 主要文件

- `manifest.json`：插件声明
- `content.js`：页面侧逻辑（列表扫描、点会话、提取、滚动、高亮）
- `sidepanel.js`：主控循环、增量判断、日志、导出
- `db.js`：IndexedDB 封装
- `sidepanel.html` / `sidepanel.css`：UI
- `background.js`：插件入口和 side panel 打开逻辑

## 选择器变更时改哪里

- 优先修改：`content.js`
- 重点函数：
  - `findLeftPanel`
  - `listVisibleSessions`
  - `findRightPanel`
  - `JOB_SELECTORS` / `HR_SELECTORS`
  - `extractWeChat` / `extractPhone`
