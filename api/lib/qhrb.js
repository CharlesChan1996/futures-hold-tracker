/**
 * 源站 API 封装
 * 源站：https://spdspc.qhrb.com.cn （期货日报实盘大赛 - 品种持仓统计）
 *
 * 已实测验证的 3 个接口（均为 GET，baseURL=/api，必须带 Referer）：
 *  1. /common/spsbreed/getBreedFront          88 个品种列表
 *  2. /spsread2026/adm/getLastDayFront        最新交易日
 *  3. /spsread2026/statistics/getBreedHoldList 品种持仓统计(返回整赛季时间序列)
 *
 * 持仓字段对照（用户需求）：
 *   holdEmptyCount   持仓做空人数      holdMoreCount   持仓做多人数
 *   holdEmptyHands   持仓做空手数      holdMoreHands   持仓做多手数
 *   countProportion  做多人数/做空人数 比   handsProportion 做多手数/做空手数 比
 */

'use strict';

const BASE = 'https://spdspc.qhrb.com.cn';
const API = BASE + '/api';
const REFERER = BASE + '/';

/** 组别定义（groupType 值 → 中文名）。已实测数据各不相同。 */
const GROUPS = [
  { id: 0, name: '全部',   key: 'all' },
  { id: 1, name: '轻量组', key: 'light' },
  { id: 2, name: '重量组', key: 'heavy' },
  { id: 3, name: '基金组', key: 'fund' },
  { id: 4, name: '量化组', key: 'quant' },
];

/** 实际抓取用到的组别（不含「全部」，因为「全部」可能含重复账户）。如需可改。 */
const FETCH_GROUPS = GROUPS.filter((g) => g.id !== 0);

/** 带超时的 GET，自动加 Referer。返回 JSON。 */
async function getJSON(path, params) {
  let url = API + path;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    if (qs) url += '?' + qs;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Referer: REFERER,
        Accept: 'application/json, text/plain, */*',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${path}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 获取全部品种列表 */
async function getBreeds() {
  const data = await getJSON('/common/spsbreed/getBreedFront');
  if (data.statusCode !== 1) {
    throw new Error('getBreedFront 失败: ' + data.statusMessage);
  }
  // 字段：breedCode, breedName, breedType, breedCoefficient, breedExchange
  return (data.dataPoints || []).map((b) => ({
    code: b.breedCode,
    name: b.breedName,
    type: b.breedType,
    exchange: b.breedExchange,
    coefficient: b.breedCoefficient,
  }));
}

/** 获取最新交易日（格式 YYYY-MM-DD） */
async function getLatestTradeDate() {
  const data = await getJSON('/spsread2026/adm/getLastDayFront');
  if (data.statusCode !== 1) {
    throw new Error('getLastDayFront 失败: ' + data.statusMessage);
  }
  // 返回 "2026-06-18 00:00:00"
  const raw = data.dataPoints;
  if (!raw) throw new Error('getLastDayFront 返回空');
  return String(raw).slice(0, 10);
}

/**
 * 获取某品种在某组别的持仓时间序列
 * @param tradeDate 截止交易日（YYYY-MM-DD）。实测：传未来日期会返回空，
 *                  必须传真实交易日；接口返回从赛季起点到该日期的全部序列。
 * @returns 数组，每项含 holdEmptyCount/holdMoreCount/holdEmptyHands/holdMoreHands/countProportion/handsProportion/tradeDate
 */
async function getBreedHoldList(breedCode, groupType, tradeDate) {
  if (!tradeDate) {
    tradeDate = await getLatestTradeDate();
  }
  const data = await getJSON('/spsread2026/statistics/getBreedHoldList', {
    tradeDate,
    breedCode,
    groupType,
  });
  if (data.statusCode !== 1) {
    throw new Error(`getBreedHoldList(${breedCode},g${groupType}) 失败: ` + data.statusMessage);
  }
  return (data.dataPoints || []).map((d) => ({
    date: String(d.tradeDate).slice(0, 10),
    shortCount: d.holdEmptyCount,     // 做空人数
    longCount: d.holdMoreCount,       // 做多人数
    shortHands: d.holdEmptyHands,     // 做空手数
    longHands: d.holdMoreHands,       // 做多手数
    countRatio: d.countProportion,    // 做多人数/做空人数
    handsRatio: d.handsProportion,    // 做多手数/做空手数
  }));
}

/** 简单限速 sleep */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 并发批处理执行任务，避免对源站压力过大、也避免 Serverless 超时。
 * batchHandler 负责处理一批 items（可通过闭包做副作用收集，如 push 到外部数组）。
 * @param items 待处理数组
 * @param batchHandler 每批处理函数（接收一批 items，返回 Promise；返回值被忽略）
 * @param batchSize 每批大小（批内 Promise.all 并发）
 * @param gapMs 批之间间隔毫秒
 */
async function runInBatches(items, batchHandler, batchSize = 10, gapMs = 200) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await batchHandler(batch, Math.floor(i / batchSize));
    if (i + batchSize < items.length && gapMs > 0) await sleep(gapMs);
  }
}

module.exports = {
  BASE,
  GROUPS,
  FETCH_GROUPS,
  getBreeds,
  getLatestTradeDate,
  getBreedHoldList,
  runInBatches,
  sleep,
};
