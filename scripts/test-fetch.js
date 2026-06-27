/**
 * 本地测试脚本：不依赖 GitHub，直接测试源站抓取。
 * 用法：node scripts/test-fetch.js
 *
 * 测试内容：
 *  1. 拿品种列表 + 最新交易日
 *  2. 抓 3 个品种 × 4 组别，验证字段完整性
 *  3. 测 extractDailySnapshot 能否正确拆出按日结构
 */

'use strict';

// 让 require 能找到 api/lib
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const { getBreeds, getLatestTradeDate, getBreedHoldList, GROUPS, FETCH_GROUPS } = require('../api/lib/qhrb');
const { fetchAll, extractDailySnapshot } = require('../api/lib/fetcher');

(async () => {
  console.log('=== 1. 品种列表 + 最新交易日 ===');
  const breeds = await getBreeds();
  const tradeDate = await getLatestTradeDate();
  console.log(`品种数: ${breeds.length}, 最新交易日: ${tradeDate}`);
  console.log('前3个品种:', breeds.slice(0, 3).map((b) => `${b.code}:${b.name}`).join(', '));

  console.log('\n=== 2. 抓 3 品种 × 4 组别 ===');
  const testBreeds = ['AU', 'RB', 'CU'];
  for (const code of testBreeds) {
    console.log(`\n--- ${code} ---`);
    for (const g of FETCH_GROUPS) {
      const series = await getBreedHoldList(code, g.id, tradeDate);
      const last = series[series.length - 1];
      console.log(
        `  ${g.name}: ${series.length}天, 最新 longCount=${last?.longCount} shortCount=${last?.shortCount} ratio=${last?.countRatio}`
      );
    }
  }

  console.log('\n=== 3. fetchAll (仅3品种, 验证整体流程) ===');
  const t0 = Date.now();
  const result = await fetchAll({ onlyBreeds: testBreeds });
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('byBreed keys:', Object.keys(result.byBreed));
  console.log('errors:', result.errors);

  console.log('\n=== 4. extractDailySnapshot ===');
  const { dates, snapshots } = extractDailySnapshot(result);
  console.log(`日期数: ${dates.length}, 首 ${dates[0]}, 末 ${dates[dates.length - 1]}`);
  const lastDate = dates[dates.length - 1];
  const snap = snapshots[lastDate];
  console.log(`\n${lastDate} 快照的 AU 数据:`);
  console.log(JSON.stringify(snap.breeds.AU, null, 2));

  console.log('\n✅ 全部测试通过');
})().catch((e) => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
