/**
 * 每日定时抓取入口。
 * Vercel Cron 每天 UTC 11:00（北京时间 19:00，盘后数据已结算）触发。
 *
 * 流程：
 *  1. 抓全量（88品种×4组别）
 *  2. 整理成按日快照
 *  3. 一次 commit 写入 GitHub 仓库：
 *     - data/breeds.json       品种列表
 *     - data/latest.json       最新一天快照（前端首屏用）
 *     - data/daily/{date}.json 当天完整快照
 *     - data/series/all.json   所有品种×组别的完整时间序列（趋势图用，每次全量覆盖）
 *
 * 本地手动触发：vercel dev 后访问 http://localhost:3000/api/cron/daily?token=xxx
 */

'use strict';

const { fetchAll, extractDailySnapshot } = require('../lib/fetcher');
const { commitMany, writeFile } = require('../lib/github');
const { GROUPS } = require('../lib/qhrb');

module.exports = async (req, res) => {
  // Cron 来源校验：Vercel 会带 x-vercel-cron-auth，本地用 ?token=CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers['authorization'];
    const qpToken = req.query && req.query.token;
    const ok =
      (authHeader && authHeader === 'Bearer ' + cronSecret) ||
      qpToken === cronSecret;
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const startedAt = Date.now();
  console.log('[cron/daily] 开始执行', new Date().toISOString());

  try {
    // 1. 抓全量
    const fetchResult = await fetchAll();
    const { tradeDate, breeds, byBreed, errors } = fetchResult;

    // 2. 整理快照
    const { snapshots } = extractDailySnapshot(fetchResult);
    const dates = Object.keys(snapshots).sort();
    const latestDate = tradeDate; // 以源站最新交易日为准

    // 3. 准备要 commit 的文件
    const updates = [];

    // 3a. 品种列表
    updates.push({
      path: 'data/breeds.json',
      content: JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          count: breeds.length,
          breeds: breeds.map((b) => ({
            code: b.code,
            name: b.name,
            type: b.type,
            exchange: b.exchange,
            coefficient: b.coefficient,
          })),
        },
        null,
        2
      ),
    });

    // 3b. 元数据（日期列表 + 组别定义）
    updates.push({
      path: 'data/meta.json',
      content: JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          latestDate,
          dates,
          groups: GROUPS,
          fetchErrors: errors,
        },
        null,
        2
      ),
    });

    // 3c. 最新一天快照（前端首屏）
    const latestSnapshot = snapshots[latestDate] || {
      date: latestDate,
      breeds: {},
    };
    updates.push({
      path: 'data/latest.json',
      content: JSON.stringify(latestSnapshot, null, 2),
    });

    // 3d. 当天完整快照（归档）
    updates.push({
      path: `data/daily/${latestDate}.json`,
      content: JSON.stringify(latestSnapshot, null, 2),
    });

    // 3e. 完整时间序列（所有品种×组别，趋势图用，全量覆盖）
    // 这是最大的文件，但因为是单赛季数据（~56天×88品种×4组），仍在合理范围
    updates.push({
      path: 'data/series/all.json',
      content: JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          latestDate,
          breeds: byBreed,
        },
        null,
        2
      ),
    });

    // 4. 一次 commit
    const commitSha = await commitMany(
      updates,
      `data: 截止 ${latestDate} 的品种持仓数据 (${breeds.length} 品种)`
    );

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[cron/daily] 完成 commit ${commitSha}, 耗时 ${elapsed}s`);

    return res.status(200).json({
      ok: true,
      elapsed: elapsed + 's',
      tradeDate: latestDate,
      breedsCount: breeds.length,
      totalDates: dates.length,
      errorsCount: errors.length,
      errors: errors.slice(0, 10),
      commitSha,
    });
  } catch (e) {
    console.error('[cron/daily] 失败:', e);
    return res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
};
