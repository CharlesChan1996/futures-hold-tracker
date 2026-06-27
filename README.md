# 期货实盘大赛 · 品种持仓多空看板

每日自动抓取 [期货日报实盘大赛](https://spdspc.qhrb.com.cn/) 的**品种持仓统计**数据，按**不同比赛组别**（轻量组 / 重量组 / 基金组 / 量化组）分别记录每个品种的：

- 持仓做空人数 / 持仓做多人数
- 持仓做空手数 / 持仓做多手数
- 做多人数 ÷ 做空人数 比例
- 做多手数 ÷ 做空手数 比例

并提供三个看板视图，用于**对比不同组别的持仓结构**。

---

## ✨ 功能特性

- **每日自动抓取**：Vercel Cron 每天 19:00（北京时间）自动抓取最新交易日数据
- **全量覆盖**：88 个期货品种 × 4 个组别，单次约 2-3 秒完成
- **历史回补**：首次部署后一键回补整个赛季历史数据（约 56 天）
- **零数据库成本**：用 GitHub 仓库当数据库，天然版本化、零运维
- **三个看板视图**：
  1. **单品种 × 多组别对比** — 选定品种，横向对比 4 个组别的多空数据
  2. **时间趋势曲线** — 选定品种 + 组别 + 指标，看多空比例随时间演变（可叠加全部组别）
  3. **组别分歧排行** — 找出各组观点分歧最大的品种（如散户看多、量化看空）

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Vercel Serverless                                          │
│                                                             │
│  ┌─────────────────┐     ┌──────────────────────────────┐   │
│  │ /api/cron/daily │────▶│ fetcher.js                   │   │
│  │ (每天 19:00 触发)│     │  抓 88品种×4组 (并发批处理)   │   │
│  └─────────────────┘     └──────────┬───────────────────┘   │
│                                     │                       │
│  ┌─────────────────┐                ▼                       │
│  │ /api/backfill   │     ┌──────────────────────────────┐   │
│  │ (手动触发回补)   │────▶│ github.js                    │   │
│  └─────────────────┘     │  commit JSON 到仓库 data/    │   │
│                          └──────────┬───────────────────┘   │
│                                     │                       │
│  ┌──────────────────────────────────┘                       │
│  │                                                          │
│  ▼                                                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ web/index.html (Chart.js 看板)                       │    │
│  │   读 data/*.json (经 jsDelivr CDN, commit 后即时可见)│    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
        ┌────────────────────────┐
        │ GitHub 仓库 (= 数据库)  │
        │  data/breeds.json      │
        │  data/meta.json        │
        │  data/latest.json      │
        │  data/series/all.json  │
        │  data/daily/{date}.json│
        └────────────────────────┘
```

**数据源接口**（均为 GET，需带 `Referer` 头）：

| 接口 | 作用 |
|------|------|
| `/api/common/spsbreed/getBreedFront` | 88 个品种列表 |
| `/api/spsread2026/adm/getLastDayFront` | 最新交易日 |
| `/api/spsread2026/statistics/getBreedHoldList` | 品种持仓统计（`groupType` 区分组别，返回整赛季时间序列） |

---

## 📦 项目结构

```
futures-hold-tracker/
├── api/
│   ├── lib/
│   │   ├── qhrb.js        # 源站 API 封装（3 接口 + 组别常量 + 并发批处理）
│   │   ├── github.js      # GitHub Contents API 封装（读写 + 批量 commit）
│   │   └── fetcher.js     # 抓取编排：88品种×4组 → 按日快照
│   ├── cron/
│   │   └── daily.js       # Cron 入口：抓全量 → commit 到仓库
│   └── backfill.js        # 历史回补（首次部署后手动触发一次）
├── web/
│   ├── index.html         # 看板页面（3 视图）
│   ├── app.js             # 前端逻辑
│   └── style.css          # 暗色主题样式
├── scripts/
│   ├── test-fetch.js      # 本地抓取测试（不依赖 GitHub）
│   └── gen-local-data.js  # 生成本地样本数据（用于前端联调）
├── data/                  # 运行后生成（抓取结果存这里）
├── vercel.json            # Cron + 路由 + maxDuration 配置
├── package.json
└── .env.example           # 环境变量模板
```

---

## 🚀 部署指南（约 10 分钟）

### 第 1 步：创建 GitHub 仓库

1. 在 GitHub 新建一个**公开仓库**（公开仓库才能用 jsDelivr CDN 免费加速；私有仓库需改用带 token 的 raw URL）
2. 把本项目代码 push 上去

### 第 2 步：创建 GitHub Token

1. 打开 https://github.com/settings/personal-access-tokens/new （Fine-grained tokens）
2. 填写：
   - **Token name**: `futures-hold-tracker`
   - **Expiration**: 建议选 1 年
   - **Repository access**: 选 `Only select repositories` → 选你刚建的仓库
   - **Permissions** → `Repository permissions` → **Contents** = `Read and write`
   - 其他权限保持 `No access`
3. 生成后复制 token（形如 `github_pat_xxx...`），**只显示一次**

### 第 3 步：导入 Vercel

1. 打开 https://vercel.com/new
2. 选 `Import Git Repository` → 选你的仓库
3. **不用改任何构建配置**（本项目零构建，Vercel 会自动识别）
4. 展开 **Environment Variables**，添加 4 个：

   | Name | Value |
   |------|-------|
   | `GH_TOKEN` | 第 2 步的 token |
   | `GH_OWNER` | 你的 GitHub 用户名 |
   | `GH_REPO` | 仓库名 |
   | `CRON_SECRET` | 随便一串随机字符（如 `my-secret-xyz123`，用于保护接口） |

5. 点 **Deploy**

### 第 4 步：触发首次历史回补

部署完成后（约 1-2 分钟），手动触发一次回补，把整个赛季历史数据写入仓库：

```bash
# 把 your-app 换成你的 Vercel 域名
curl "https://your-app.vercel.app/api/backfill?token=你的CRON_SECRET"
```

约 5-10 秒后返回类似：
```json
{ "ok": true, "tradeDate": "2026-06-18", "breedsCount": 88, "totalDates": 56, "filesWritten": 60 }
```

回成功后，去 GitHub 仓库能看到 `data/` 目录下生成了 `breeds.json`、`latest.json`、`series/all.json`、`daily/*.json`。

### 第 5 步：打开看板

访问你的 Vercel 域名，URL 加上 `?repo=用户名/仓库名` 参数指定数据源：

```
https://your-app.vercel.app/?repo=你的用户名/你的仓库名
```

> 也可以把默认数据源写死在 `web/index.html` 里（在 `<script src="app.js">` 前加一行 `<script>window.DATA_OWNER='用户名';window.DATA_REPO='仓库名'</script>`），就不用每次带参数。

---

## ⏰ 自动更新

`vercel.json` 已配置好 Cron：

```json
"crons": [{ "path": "/api/cron/daily", "schedule": "0 11 * * *" }]
```

`0 11 * * *` 是 UTC 11:00 = **北京时间 19:00**（A 股收盘后数据已结算）。

Vercel 会在部署后自动注册这个 Cron。可在 Vercel 控制台 → 你的项目 → **Cron Jobs** 查看执行历史。

**手动触发当日更新**（调试用）：
```bash
curl "https://your-app.vercel.app/api/cron/daily?token=你的CRON_SECRET"
```

---

## 💻 本地开发

### 环境要求
- Node.js ≥ 18（用到了原生 `fetch`）

### 测试抓取逻辑（不依赖 GitHub）

```bash
node scripts/test-fetch.js
```

抓 3 个品种 × 4 组别，验证字段完整性。

### 生成全量样本数据到本地

```bash
node scripts/gen-local-data.js
```

抓全量 88 品种 × 4 组别，写入本地 `data/` 目录（约 3 秒）。生成后即可本地预览看板。

### 本地预览看板

```bash
# 方式 1：用 Python 自带静态服务器（最简单）
python -m http.server 8080
# 然后浏览器打开 http://localhost:8080/web/index.html

# 方式 2：用 Vercel CLI（完整模拟生产环境，含 API 路由）
npm i -g vercel
vercel dev
# 然后浏览器打开 http://localhost:3000
```

本地预览时前端默认读同源 `/data/*.json`，所以 `gen-local-data.js` 生成的数据会被直接使用。

### 测试 GitHub 写入

复制 `.env.example` 为 `.env`，填入真实 `GH_TOKEN` / `GH_OWNER` / `GH_REPO`，然后用 `vercel dev` 启动后访问：

```
http://localhost:3000/api/backfill?token=你的CRON_SECRET
```

---

## 📊 数据字段说明

### 持仓数据点（每个品种 × 每个组别 × 每个交易日）

| 字段 | 含义 | 对应需求 |
|------|------|---------|
| `shortCount` | 持仓做空人数 | ✅ |
| `longCount` | 持仓做多人数 | ✅ |
| `shortHands` | 持仓做空手数 | ✅ |
| `longHands` | 持仓做多手数 | ✅ |
| `countRatio` | 做多人数 ÷ 做空人数 | ✅ |
| `handsRatio` | 做多手数 ÷ 做空手数 | ✅ |

### 组别映射（`groupType` 参数）

| groupType | key | 中文名 |
|-----------|-----|--------|
| 1 | `light` | 轻量组 |
| 2 | `heavy` | 重量组 |
| 3 | `fund` | 基金组（高净值组） |
| 4 | `quant` | 量化组 |

> 源站不同赛季可能用「高净值组」或「基金组」称呼 groupType=3，本看板统一显示为「基金组」。如需修改，编辑 `api/lib/qhrb.js` 的 `GROUPS` 常量。

---

## ❓ 常见问题

**Q: 为什么用 GitHub 仓库当数据库，不用真正的数据库？**
A: 本场景数据量小（每天 ~80KB，整个赛季 ~4MB）、写入频率低（每天 1 次）、需要历史归档——GitHub commit 天然就是版本化的快照，零成本零运维。且通过 jsDelivr CDN 读取，全球加速、commit 后立即可见。

**Q: 前端为什么默认走 jsDelivr CDN 而不是同源？**
A: Vercel 部署的静态文件在「下一次部署」才更新，而 Cron 是运行时 commit 文件——如果走同源，当天抓的数据要等到重新部署才看得见。走 jsDelivr 读 GitHub raw，commit 后立即可见。

**Q: 私有仓库能用吗？**
A: 能，但 jsDelivr 不支持私有仓库。需把 `web/app.js` 的 `buildDataBase()` 改为走 `https://raw.githubusercontent.com/{owner}/{repo}/{branch}/data` 并带 token（不推荐把 token 放前端，更稳妥的做法是加一个 `/api/data/:file` 的代理路由）。

**Q: 抓取会失败吗？**
A: 单品种单组别失败会被记录到 `data/meta.json` 的 `fetchErrors`，不影响其他品种。全量抓取有并发批处理 + 超时控制，实测 352 请求约 2-3 秒完成，0 错误。

**Q: 赛季结束后会怎样？**
A: 源站 API 在新赛季开始后会切换路径前缀（如 `spsread2026` → `spsread2027`）。届时需更新 `api/lib/qhrb.js` 里的接口路径前缀。

---

## ⚖️ 数据来源与免责声明

- 数据来源：[期货日报实盘大赛 spdspc.qhrb.com.cn](https://spdspc.qhrb.com.cn/)
- 本项目仅对该网站的公开数据进行汇总展示，不存储任何账户个人信息（持仓统计是聚合数据，不含个人明细）
- 本看板不构成任何投资建议

---

## 🔧 自定义

| 想改什么 | 改哪里 |
|---------|--------|
| 组别名称 | `api/lib/qhrb.js` → `GROUPS`，`web/app.js` → `GROUP_NAMES` |
| 抓取时间 | `vercel.json` → `crons.schedule` |
| 配色主题 | `web/style.css` → `:root` CSS 变量 |
| 默认品种 | `web/app.js` → `populateSelectors()` 里 `defaultBreed` |
| 分歧排行阈值 | `web/app.js` → `renderDivergence()` 里 `allBull`/`allBear` 的 1.5 / 0.67 |
