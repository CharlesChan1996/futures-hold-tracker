/**
 * 本地数据生成器：抓全量数据，直接写入本地 data/ 目录（不经过 GitHub）。
 * 用于：
 *   1. 前端本地联调（让 web/index.html 能读到真实数据）
 *   2. 全量压力测试（验证 88 品种 × 4 组别 = 352 请求能稳定完成）
 *
 * 用法：node scripts/gen-local-data.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const { GROUPS } = require('../api/lib/qhrb');
const { fetchAll, extractDailySnapshot } = require('../api/lib/fetcher');

(async () => {
  const t0 = Date.now();
  console.log('抓取全量数据（88 品种 × 4 组别）...');
  const result = await fetchAll();
  console.log(`抓取完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，错误 ${result.errors.length}`);

  const { snapshots } = extractDailySnapshot(result);
  const dates = Object.keys(snapshots).sort();
  const latestDate = result.tradeDate;
  const dataDir = path.resolve('data');
  const dailyDir = path.resolve('data', 'daily');
  fs.mkdirSync(dailyDir, { recursive: true });

  // breeds.json
  fs.writeFileSync(
    path.join(dataDir, 'breeds.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: result.breeds.length,
        breeds: result.breeds,
      },
      null,
      2
    )
  );

  // meta.json
  fs.writeFileSync(
    path.join(dataDir, 'meta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latestDate,
        dates,
        groups: GROUPS,
        fetchErrors: result.errors,
      },
      null,
      2
    )
  );

  // latest.json
  fs.writeFileSync(
    path.join(dataDir, 'latest.json'),
    JSON.stringify(snapshots[latestDate] || { date: latestDate, breeds: {} }, null, 2)
  );

  // daily/{date}.json —— 仅写最新一天（本地联调用，避免 56 个文件）
  fs.writeFileSync(
    path.join(dailyDir, `${latestDate}.json`),
    JSON.stringify(snapshots[latestDate] || { date: latestDate, breeds: {} }, null, 2)
  );

  // series/all.json —— 前端趋势/分鄙视图必需
  const seriesDir = path.join(dataDir, 'series');
  fs.mkdirSync(seriesDir, { recursive: true });
  fs.writeFileSync(
    path.join(seriesDir, 'all.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        latestDate,
        breeds: result.byBreed,
      },
      null,
      2
    )
  );

  // 体积统计
  const seriesSize = fs.statSync(path.join(dataDir, 'series', 'all.json')).size;
  console.log(`\n生成完成:`);
  console.log(`  品种数: ${result.breeds.length}`);
  console.log(`  日期范围: ${dates[0]} ~ ${dates[dates.length - 1]} (${dates.length} 天)`);
  console.log(`  series/all.json 体积: ${(seriesSize / 1024).toFixed(1)} KB`);
  console.log(`\n错误详情 (前10):`);
  result.errors.slice(0, 10).forEach((e) => console.log(`  ${e.breed}/${e.group}: ${e.error}`));
})().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
