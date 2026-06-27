/**
 * 历史回补（首次部署后手动触发一次）。
 *
 * 源站 API 实测：单次请求即返回整赛季时间序列（约 56 天），
 * 所以「回补」本质上和「每日抓取」是一次相同操作——都是抓全量、写归档。
 *
 * 本接口额外做的事：
 *  - 把每个交易日的快照都写一份 data/daily/{date}.json（让历史可按日单独访问）
 *  - 提供 ?breeds=AU,RB 这样的分品种模式，便于在 Serverless 限制下分批跑
 *
 * 触发方式：
 *   - 全量回补:  GET /api/backfill
 *   - 分品种:    GET /api/backfill?breeds=AU,RB,CU  （每批建议 ≤30 品种）
 *   - 仅写序列:  GET /api/backfill?mode=series       （只更新 series/all.json，不写 daily/）
 */

'use strict';

const { fetchAll, extractDailySnapshot } = require('./lib/fetcher');
const { commitMany } = require('./lib/github');
const { GROUPS } = require('./lib/qhrb');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const qpToken = req.query && req.query.token;
    const authHeader = req.headers['authorization'];
    if (qpToken !== cronSecret && authHeader !== 'Bearer ' + cronSecret) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const startedAt = Date.now();
  const breedsFilter = req.query.breeds
    ? String(req.query.breeds).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    : null;
  const mode = req.query.mode || 'full';

  console.log('[backfill] 开始', { breedsFilter: breedsFilter || '全部', mode });

  try {
    const fetchResult = await fetchAll({ onlyBreeds: breedsFilter });
    const { tradeDate, breeds, byBreed, errors } = fetchResult;
    const { snapshots } = extractDailySnapshot(fetchResult);
    const dates = Object.keys(snapshots).sort();

    const updates = [];

    // 品种列表只在全量回补时更新
    if (!breedsFilter) {
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
      updates.push({
        path: 'data/meta.json',
        content: JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            latestDate: tradeDate,
            dates,
            groups: GROUPS,
            fetchErrors: errors,
          },
          null,
          2
        ),
      });
    }

    // 序列总文件（每次都更新，全量覆盖）
    updates.push({
      path: 'data/series/all.json',
      content: JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          latestDate: tradeDate,
          breeds: byBreed,
        },
        null,
        2
      ),
    });

    // latest.json
    if (!breedsFilter && snapshots[tradeDate]) {
      updates.push({
        path: 'data/latest.json',
        content: JSON.stringify(snapshots[tradeDate], null, 2),
      });
    }

    // 每日归档（mode=full 时才写，避免大量 commit）
    if (mode === 'full') {
      for (const date of dates) {
        updates.push({
          path: `data/daily/${date}.json`,
          content: JSON.stringify(snapshots[date], null, 2),
        });
      }
    }

    // 单个 commit 提交全部（Git Data API 一次可处理多文件；如超过 GitHub 限制会自动报错，可改分批）
    const commitSha = await commitMany(
      updates,
      `data(backfill): 截止 ${tradeDate} 持仓数据回补 ${updates.length} 文件`
    );

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[backfill] 完成, 耗时 ${elapsed}s, 提交 ${updates.length} 文件`);

    return res.status(200).json({
      ok: true,
      elapsed: elapsed + 's',
      tradeDate,
      breedsCount: breeds.length,
      totalDates: dates.length,
      filesWritten: updates.length,
      errorsCount: errors.length,
      errors: errors.slice(0, 20),
      commitSha,
    });
  } catch (e) {
    console.error('[backfill] 失败:', e);
    return res.status(500).json({ ok: false, error: e.message, stack: e.stack });
  }
};
