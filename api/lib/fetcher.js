/**
 * 全量抓取：88 品种 × 5 组别（轻量/重量/基金/量化 + 全部）。
 * 被 cron/daily.js（每日增量）和 backfill.js（首次历史回补）复用。
 *
 * 抓取策略：
 *  - 先拿品种列表 + 最新交易日
 *  - 每个品种 × 每个组别一次请求，源站返回整赛季时间序列
 *  - 并发批处理（每批 10 品种 × 5 组 = 50 请求），批间 200ms 间隔
 *  - 全量约 440 请求，实测 ~3-5 秒完成（maxDuration: 60 足够）
 */

'use strict';

const {
  GROUPS,
  FETCH_GROUPS,
  getBreeds,
  getLatestTradeDate,
  getBreedHoldList,
  runInBatches,
  sleep,
} = require('./qhrb');

/**
 * 抓取全量数据。
 * @returns {Object} {
 *   tradeDate: '2026-06-18',
 *   breeds: [{code,name,type,exchange}],
 *   byBreed: { 'AU': { light: [...序列], heavy: [...], ... } },
 *   errors:  [{breed, group, error}]
 * }
 */
async function fetchAll({ onlyBreeds = null, onlyGroups = null } = {}) {
  // 1. 品种列表
  const breeds = await getBreeds();
  const targetBreeds = onlyBreeds
    ? breeds.filter((b) => onlyBreeds.includes(b.code))
    : breeds;

  // 2. 最新交易日
  const tradeDate = await getLatestTradeDate();

  // 决定抓哪些组别（默认轻量/重量/基金/量化；可选追加全部）
  const groups = onlyGroups
    ? GROUPS.filter((g) => onlyGroups.includes(g.id))
    : FETCH_GROUPS;

  // 3. 并发抓取
  const byBreed = {};
  const errors = [];

  // 构造全部任务：每个 (品种, 组别) 一个任务
  const tasks = [];
  for (const b of targetBreeds) {
    for (const g of groups) {
      tasks.push({ breed: b, group: g });
    }
  }

  console.log(`[fetchAll] 开始抓取 ${targetBreeds.length} 品种 × ${groups.length} 组 = ${tasks.length} 任务, 截止日 ${tradeDate}`);

  await runInBatches(tasks, async (batch) => {
    const results = await Promise.all(
      batch.map(async (t) => {
        try {
          const series = await getBreedHoldList(t.breed.code, t.group.id, tradeDate);
          return { breed: t.breed, group: t.group, series };
        } catch (e) {
          return { breed: t.breed, group: t.group, error: e.message };
        }
      })
    );
    for (const r of results) {
      if (r.error) {
        errors.push({ breed: r.breed.code, group: r.group.key, error: r.error });
      } else {
        if (!byBreed[r.breed.code]) byBreed[r.breed.code] = { name: r.breed.name };
        byBreed[r.breed.code][r.group.key] = r.series;
      }
    }
  }, 50, 150); // 每批 50 并发（=10品种×5组 或 50品种×1组），批间 150ms

  console.log(`[fetchAll] 完成。成功 ${Object.keys(byBreed).length} 品种，错误 ${errors.length} 个`);
  return { tradeDate, breeds: targetBreeds, byBreed, errors };
}

/**
 * 把抓取结果整理成「按日」结构：某一天每个品种每个组别的快照。
 * 用于写 data/daily/{date}.json
 */
function extractDailySnapshot(fetchResult) {
  // 收集所有出现过的交易日
  const dateSet = new Set();
  for (const code of Object.keys(fetchResult.byBreed)) {
    const breedData = fetchResult.byBreed[code];
    for (const g of FETCH_GROUPS) {
      const series = breedData[g.key];
      if (series) series.forEach((d) => dateSet.add(d.date));
    }
  }
  const dates = [...dateSet].sort();

  // 对每个日期，构造快照
  const snapshots = {};
  for (const date of dates) {
    const breeds = {};
    for (const code of Object.keys(fetchResult.byBreed)) {
      const breedData = fetchResult.byBreed[code];
      const groups = {};
      for (const g of FETCH_GROUPS) {
        const point = (breedData[g.key] || []).find((d) => d.date === date);
        if (point) {
          groups[g.key] = {
            shortCount: point.shortCount,
            longCount: point.longCount,
            shortHands: point.shortHands,
            longHands: point.longHands,
            countRatio: point.countRatio,
            handsRatio: point.handsRatio,
          };
        }
      }
      if (Object.keys(groups).length > 0) {
        breeds[code] = { name: breedData.name, groups };
      }
    }
    snapshots[date] = { date, breeds };
  }
  return { dates, snapshots };
}

module.exports = { fetchAll, extractDailySnapshot };
