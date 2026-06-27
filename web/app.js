/**
 * 前端看板逻辑。
 *
 * 数据来源：GitHub 仓库（通过 jsDelivr CDN 读取，commit 后立即可见）
 *   {DATA_BASE}/meta.json       元数据（日期列表、组别定义、最新日期）
 *   {DATA_BASE}/breeds.json     品种列表
 *   {DATA_BASE}/series/all.json 全部品种×组别×日期的时间序列（趋势图、分歧排行）
 *   {DATA_BASE}/latest.json     最新一天快照（首屏、对比视图默认值）
 *
 * 配置：在 <body> 末尾或 URL 参数指定 DATA_OWNER / DATA_REPO / DATA_BRANCH。
 *       默认从 URL ?repo=owner/name 读取，便于部署后灵活切换数据源。
 */

'use strict';

/* ============ 数据源配置 ============ */
const params = new URLSearchParams(location.search);
const REPO_PARAM = params.get('repo'); // ?repo=owner/name
const BRANCH = params.get('branch') || 'main';

/**
 * 数据源解析优先级：
 *  1. ?repo=owner/name  → jsDelivr CDN（生产推荐，commit 后立即可见、带 CDN 加速）
 *  2. 其他情况          → 同源 /data/*.json（本地 vercel dev 联调、或仓库 data/ 一同部署）
 */
function buildDataBase() {
  if (REPO_PARAM) {
    const [owner, name] = REPO_PARAM.split('/');
    if (owner && name) {
      return `https://cdn.jsdelivr.net/gh/${owner}/${name}@${BRANCH}/data`;
    }
  }
  return '/data';
}

const GROUP_KEYS = ['light', 'heavy', 'fund', 'quant'];
const GROUP_NAMES = { light: '轻量组', heavy: '重量组', fund: '基金组', quant: '量化组' };
const GROUP_COLORS = { light: '#58a6ff', heavy: '#bc8cff', fund: '#d29922', quant: '#3fb950' };

const METRIC_LABELS = {
  countRatio: '做多人数/做空人数',
  handsRatio: '做多手数/做空手数',
  longCount: '做多人数',
  shortCount: '做空人数',
  longHands: '做多手数',
  shortHands: '做空手数',
};

/* ============ 全局状态 ============ */
let STATE = {
  dataBase: null,
  meta: null,
  breeds: [],      // [{code,name,...}]
  breedMap: {},    // code -> breed
  series: null,    // series/all.json 内容
  latest: null,    // latest.json 内容
};

/* ============ 工具 ============ */
async function fetchJSON(url) {
  // jsDelivr 带 ?v=时间戳 防缓存（数据每日更新）
  const u = url + (url.indexOf('?') > -1 ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return res.json();
}

function fmt(n, digits = 0) {
  if (n == null || isNaN(n)) return '-';
  return Number(n).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function ratioCell(v) {
  if (v == null) return '<td>-</td>';
  const cls = v >= 1.5 ? 'pos' : v <= 0.67 ? 'neg' : '';
  return `<td class="${cls}">${fmt(v, 2)}</td>`;
}

function destroyChart(c) {
  if (c) { c.destroy(); return null; }
  return null;
}

/* ============ 初始化 ============ */
async function init() {
  STATE.dataBase = buildDataBase();
  if (!STATE.dataBase) {
    showConfigPrompt();
    return;
  }

  try {
    // 并行加载元数据
    const [meta, breeds, latest] = await Promise.all([
      fetchJSON(`${STATE.dataBase}/meta.json`),
      fetchJSON(`${STATE.dataBase}/breeds.json`),
      fetchJSON(`${STATE.dataBase}/latest.json`),
    ]);
    STATE.meta = meta;
    STATE.breeds = breeds.breeds || [];
    STATE.breedMap = Object.fromEntries(STATE.breeds.map((b) => [b.code, b]));
    STATE.latest = latest;

    renderMeta(meta, latest);
    populateSelectors();

    // 绑定 tab 切换
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    // 绑定各视图事件
    document.getElementById('cmpBreed').addEventListener('change', renderCompare);
    document.getElementById('cmpDate').addEventListener('change', renderCompare);
    document.getElementById('trBreed').addEventListener('change', renderTrend);
    document.getElementById('trGroup').addEventListener('change', renderTrend);
    document.getElementById('trMetric').addEventListener('change', renderTrend);
    document.getElementById('trOverlay').addEventListener('change', renderTrend);
    document.getElementById('dvDate').addEventListener('change', renderDivergence);
    document.getElementById('dvMetric').addEventListener('change', renderDivergence);

    // 首次渲染对比视图
    renderCompare();
  } catch (e) {
    console.error(e);
    document.getElementById('metaBox').innerHTML =
      `<span style="color:var(--short)">数据加载失败：${e.message}<br>请确认仓库已运行过数据抓取（/api/backfill）。</span>`;
  }
}

function showConfigPrompt() {
  document.getElementById('metaBox').innerHTML =
    `<span style="color:var(--warn)">未配置数据源仓库。请在 URL 加 ?repo=你的用户名/仓库名，例如 ?repo=octocat/futures-hold-tracker</span>`;
  document.querySelector('.container').innerHTML =
    `<div class="panel"><h3>请配置数据源</h3>
     <p>前端需要读取你部署时写入数据的 GitHub 仓库。请在地址栏添加参数：</p>
     <pre style="background:var(--panel-2);padding:12px;border-radius:6px;overflow:auto;">?repo=你的GitHub用户名/仓库名</pre>
     <p class="muted">数据源仓库需为「公开」仓库（jsDelivr CDN 才能访问）。如用私有仓库，需改用带 token 的 raw.githubusercontent.com。</p></div>`;
}

function renderMeta(meta, latest) {
  const date = latest.date || meta.latestDate;
  const gen = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('zh-CN') : '';
  document.getElementById('metaBox').innerHTML =
    `最新交易日 <strong>${date}</strong><br>` +
    `品种数 ${STATE.breeds.length} · 共 ${meta.dates?.length || 0} 个交易日` +
    (gen ? `<br>更新于 ${gen}` : '');
}

function populateSelectors() {
  // 品种下拉（按名称排序，更易找）
  const sorted = [...STATE.breeds].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const breedOpts = sorted
    .map((b) => `<option value="${b.code}">${b.name} (${b.code})</option>`)
    .join('');
  document.getElementById('cmpBreed').innerHTML = breedOpts;
  document.getElementById('trBreed').innerHTML = breedOpts;

  // 日期下拉（最新在前）
  const dates = [...(STATE.meta.dates || [])].sort().reverse();
  const dateOpts = dates.map((d) => `<option value="${d}">${d}</option>`).join('');
  document.getElementById('cmpDate').innerHTML = dateOpts;
  document.getElementById('dvDate').innerHTML = dateOpts;

  // 默认选最新日期 + 一个热门品种
  if (dates.length) {
    document.getElementById('cmpDate').value = dates[0];
    document.getElementById('dvDate').value = dates[0];
  }
  const defaultBreed = STATE.breedMap['AU'] ? 'AU' : STATE.breeds[0]?.code;
  if (defaultBreed) {
    document.getElementById('cmpBreed').value = defaultBreed;
    document.getElementById('trBreed').value = defaultBreed;
  }

  // 趋势图组别下拉
  const grpOpts = GROUP_KEYS.map((k) => `<option value="${k}">${GROUP_NAMES[k]}</option>`).join('');
  document.getElementById('trGroup').innerHTML = grpOpts;
}

/* ============ 视图切换 ============ */
function switchView(view) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');

  // 趋势和分歧视图需要 series 数据，懒加载
  if ((view === 'trend' || view === 'divergence') && !STATE.series) {
    loadSeries().then(() => {
      if (view === 'trend') renderTrend();
      if (view === 'divergence') renderDivergence();
    });
  } else {
    if (view === 'trend') renderTrend();
    if (view === 'divergence') renderDivergence();
  }
}

async function loadSeries() {
  STATE.series = await fetchJSON(`${STATE.dataBase}/series/all.json`);
}

/* ============ 视图 1：单品种 × 多组别对比 ============ */

let CMP_CHART_COUNT = null;
let CMP_CHART_HANDS = null;

async function renderCompare() {
  const code = document.getElementById('cmpBreed').value;
  const date = document.getElementById('cmpDate').value;
  if (!code || !date) return;

  // 从 latest 或 series 取该品种该日数据
  let snapshot = STATE.latest && STATE.latest.date === date ? STATE.latest : null;
  if (!snapshot && STATE.series) {
    snapshot = buildDailyFromSeries(date);
  }
  if (!snapshot) {
    // 临时加载一次 series
    await loadSeries();
    snapshot = buildDailyFromSeries(date);
  }

  const breedData = snapshot.breeds[code];
  const hint = document.getElementById('cmpHint');
  if (!breedData) {
    hint.textContent = `${STATE.breedMap[code]?.name || code} 在 ${date} 无数据`;
    document.getElementById('cmpCards').innerHTML = '';
    document.querySelector('#cmpTable tbody').innerHTML = '';
    CMP_CHART_COUNT = destroyChart(CMP_CHART_COUNT);
    CMP_CHART_HANDS = destroyChart(CMP_CHART_HANDS);
    return;
  }
  hint.textContent = '';

  // 卡片
  const rows = GROUP_KEYS.map((k) => ({ key: k, name: GROUP_NAMES[k], ...(breedData.groups[k] || {}) }));
  const totalLong = rows.reduce((s, r) => s + (r.longCount || 0), 0);
  const totalShort = rows.reduce((s, r) => s + (r.shortCount || 0), 0);
  const totalLongHands = rows.reduce((s, r) => s + (r.longHands || 0), 0);
  const totalShortHands = rows.reduce((s, r) => s + (r.shortHands || 0), 0);

  document.getElementById('cmpCards').innerHTML = `
    <div class="card long"><div class="card-title">合计做多人数</div><div class="card-big">${fmt(totalLong)}</div></div>
    <div class="card short"><div class="card-title">合计做空人数</div><div class="card-big">${fmt(totalShort)}</div></div>
    <div class="card long"><div class="card-title">合计做多手数</div><div class="card-big">${fmt(totalLongHands)}</div></div>
    <div class="card short"><div class="card-title">合计做空手数</div><div class="card-big">${fmt(totalShortHands)}</div></div>
    <div class="card"><div class="card-title">合计多空人数比</div><div class="card-big">${fmt(totalLong / (totalShort || 1), 2)}</div><div class="card-sub">做多人数 ÷ 做空人数</div></div>
  `;

  // 表格
  document.querySelector('#cmpTable tbody').innerHTML = rows.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${fmt(r.shortCount)}</td>
      <td class="pos">${fmt(r.longCount)}</td>
      <td>${fmt(r.shortHands)}</td>
      <td class="pos">${fmt(r.longHands)}</td>
      ${ratioCell(r.countRatio)}
      ${ratioCell(r.handsRatio)}
    </tr>
  `).join('');

  // 柱状图：人数
  CMP_CHART_COUNT = destroyChart(CMP_CHART_COUNT);
  CMP_CHART_COUNT = new Chart(document.getElementById('cmpChartCount'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [
        { label: '做多人数', data: rows.map((r) => r.longCount || 0), backgroundColor: 'rgba(248,81,73,0.7)' },
        { label: '做空人数', data: rows.map((r) => r.shortCount || 0), backgroundColor: 'rgba(63,185,80,0.7)' },
      ],
    },
    options: chartOpts(),
  });

  // 柱状图：手数
  CMP_CHART_HANDS = destroyChart(CMP_CHART_HANDS);
  CMP_CHART_HANDS = new Chart(document.getElementById('cmpChartHands'), {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.name),
      datasets: [
        { label: '做多手数', data: rows.map((r) => r.longHands || 0), backgroundColor: 'rgba(248,81,73,0.7)' },
        { label: '做空手数', data: rows.map((r) => r.shortHands || 0), backgroundColor: 'rgba(63,185,80,0.7)' },
      ],
    },
    options: chartOpts(),
  });
}

/* ============ 视图 2：时间趋势 ============ */
let TR_CHART = null;

function renderTrend() {
  const code = document.getElementById('trBreed').value;
  const group = document.getElementById('trGroup').value;
  const metric = document.getElementById('trMetric').value;
  const overlay = document.getElementById('trOverlay').checked;
  if (!code || !STATE.series) return;

  const breedSeries = STATE.series.breeds[code];
  document.getElementById('trTitle').textContent =
    `${STATE.breedMap[code]?.name || code} · ${METRIC_LABELS[metric]}`;

  TR_CHART = destroyChart(TR_CHART);
  if (!breedSeries) return;

  const groups = overlay ? GROUP_KEYS : [group];
  // 收集所有日期（取该品种所有组别日期的并集）
  const dateSet = new Set();
  for (const k of GROUP_KEYS) {
    (breedSeries[k] || []).forEach((d) => dateSet.add(d.date));
  }
  const dates = [...dateSet].sort();

  const datasets = groups.map((gk) => {
    const arr = breedSeries[gk] || [];
    const byDate = Object.fromEntries(arr.map((d) => [d.date, d]));
    return {
      label: GROUP_NAMES[gk],
      data: dates.map((d) => (byDate[d] ? byDate[d][metric] : null)),
      borderColor: GROUP_COLORS[gk],
      backgroundColor: GROUP_COLORS[gk] + '33',
      tension: 0.3,
      pointRadius: 2,
      spanGaps: true,
    };
  });

  TR_CHART = new Chart(document.getElementById('trChart'), {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      ...chartOpts(),
      scales: {
        x: scaleOpts(),
        y: { ...scaleOpts(), title: { display: true, text: METRIC_LABELS[metric], color: '#8b98a5' } },
      },
      plugins: {
        legend: { labels: { color: '#e6edf3' } },
        tooltip: { mode: 'index', intersect: false },
      },
    },
  });
}

/* ============ 视图 3：组别分歧排行 ============ */
function renderDivergence() {
  const date = document.getElementById('dvDate').value;
  const metric = document.getElementById('dvMetric').value; // countRatio or handsRatio
  if (!date || !STATE.series) return;

  // 从 series 构造该日快照
  const snapshot = buildDailyFromSeries(date);
  if (!snapshot) return;

  const rows = [];
  for (const code of Object.keys(snapshot.breeds)) {
    const b = snapshot.breeds[code];
    const vals = GROUP_KEYS.map((k) => (b.groups[k] ? b.groups[k][metric] : null)).filter((v) => v != null);
    if (vals.length < 2) continue;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const spread = max - min;
    rows.push({
      code,
      name: b.name,
      light: b.groups.light?.[metric],
      heavy: b.groups.heavy?.[metric],
      fund: b.groups.fund?.[metric],
      quant: b.groups.quant?.[metric],
      spread,
    });
  }
  rows.sort((a, b) => b.spread - a.spread);
  const top = rows.slice(0, 30);

  document.querySelector('#dvTable tbody').innerHTML = top.map((r, i) => {
    // 方向：所有组别都 >1.5 偏多，都 <0.67 偏空，否则分歧
    const allVals = [r.light, r.heavy, r.fund, r.quant].filter((v) => v != null);
    const allBull = allVals.every((v) => v >= 1.5);
    const allBear = allVals.every((v) => v <= 0.67);
    const tag = allBull
      ? '<span class="tag tag-bull">一致偏多</span>'
      : allBear
      ? '<span class="tag tag-bear">一致偏空</span>'
      : '<span class="tag tag-split">组间分歧</span>';
    return `<tr>
      <td>${i + 1}</td>
      <td>${r.name} <span class="muted">${r.code}</span></td>
      ${ratioCell(r.light)}
      ${ratioCell(r.heavy)}
      ${ratioCell(r.fund)}
      ${ratioCell(r.quant)}
      <td class="pos"><strong>${fmt(r.spread, 2)}</strong></td>
      <td>${tag}</td>
    </tr>`;
  }).join('');
}

/* ============ 辅助：从 series 构造某日快照 ============ */
function buildDailyFromSeries(date) {
  if (!STATE.series) return null;
  const breeds = {};
  for (const code of Object.keys(STATE.series.breeds)) {
    const bs = STATE.series.breeds[code];
    const groups = {};
    for (const k of GROUP_KEYS) {
      const p = (bs[k] || []).find((d) => d.date === date);
      if (p) {
        groups[k] = {
          shortCount: p.shortCount, longCount: p.longCount,
          shortHands: p.shortHands, longHands: p.longHands,
          countRatio: p.countRatio, handsRatio: p.handsRatio,
        };
      }
    }
    if (Object.keys(groups).length > 0) {
      breeds[code] = { name: bs.name, groups };
    }
  }
  return { date, breeds };
}

/* ============ Chart.js 暗色主题配置 ============ */
function chartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#e6edf3' } },
    },
  };
}
function scaleOpts() {
  return {
    grid: { color: 'rgba(255,255,255,0.06)' },
    ticks: { color: '#8b98a5' },
  };
}

/* ============ 实时更新按钮 ============ */
/**
 * 「获取最新数据」按钮逻辑。
 *
 * 工作原理：
 *  - 直接从源站 API（通过 Vercel 代理 /api/proxy/* 或直接 fetch）拉取最新数据
 *  - 在本地内存中更新 STATE（不依赖 GitHub CDN 的延迟）
 *  - 无论落后 1 天还是多天，都能自动补全到最新日期
 *
 * 生产环境（有 ?repo= 参数）：
 *  - 先调用 /api/refresh 触发后端重新抓取并 commit 到 GitHub
 *  - 再刷新前端数据（强制绕过 CDN 缓存）
 *
 * 本地开发（无 ?repo= 参数 / 同源）：
 *  - 直接重新 fetch 同源 /data/*.json（假设已 vercel dev 或 gen-local-data.js 更新过）
 *  - 若需要触发重新抓取，需在命令行手动运行 gen-local-data.js
 */

const QHRB_BASE = 'https://spdspc.qhrb.com.cn';
const QHRB_API = QHRB_BASE + '/api';
const QHRB_REFERER = QHRB_BASE + '/';

/** 直接从源站 fetch JSON（CORS 不支持时会失败，此时依赖后端代理） */
async function fetchFromSource(path, params) {
  let url = QHRB_API + path;
  if (params) url += '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Referer': QHRB_REFERER,
      'Accept': 'application/json, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
    },
    mode: 'cors',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 获取源站最新交易日 */
async function getSourceLatestDate() {
  const data = await fetchFromSource('/spsread2026/adm/getLastDayFront');
  if (data.statusCode !== 1) throw new Error('getLastDayFront: ' + data.statusMessage);
  return String(data.dataPoints).slice(0, 10);
}

/** 批量并发抓取，每批 size 个并行 */
async function runBatch(items, handler, size = 20, delayMs = 100) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    const batchResults = await Promise.all(batch.map(handler));
    results.push(...batchResults);
    if (i + size < items.length && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

/**
 * 核心：从源站直接抓取全量最新数据，更新 STATE.series / STATE.latest / STATE.meta
 */
async function fetchLatestFromSource(onProgress) {
  onProgress('正在查询最新交易日…');

  // 1. 获取最新交易日
  const latestDate = await getSourceLatestDate();
  const knownLatest = STATE.meta?.latestDate || '';

  if (latestDate === knownLatest) {
    return { latestDate, updated: false, message: `已是最新数据（${latestDate}）` };
  }

  onProgress(`发现新数据：${latestDate}，正在抓取 88 品种 × 4 组别…`);

  // 2. 获取品种列表（优先用已有的）
  const breeds = STATE.breeds.length > 0
    ? STATE.breeds
    : await fetchFromSource('/common/spsbreed/getBreedFront').then(d => {
        if (d.statusCode !== 1) throw new Error('品种列表获取失败');
        return (d.dataPoints || []).map(b => ({ code: b.breedCode, name: b.breedName }));
      });

  // 3. 构造全部抓取任务
  const GROUP_IDS = [
    { id: 1, key: 'light' },
    { id: 2, key: 'heavy' },
    { id: 3, key: 'fund' },
    { id: 4, key: 'quant' },
  ];
  const tasks = [];
  for (const b of breeds) {
    for (const g of GROUP_IDS) {
      tasks.push({ breed: b, group: g });
    }
  }

  let done = 0;
  const byBreed = {};

  // 4. 并发批量抓取（每批 40 个并发，批间 100ms）
  await runBatch(tasks, async (t) => {
    try {
      const data = await fetchFromSource('/spsread2026/statistics/getBreedHoldList', {
        tradeDate: latestDate,
        breedCode: t.breed.code,
        groupType: t.group.id,
      });
      const series = (data.dataPoints || []).map(d => ({
        date: String(d.tradeDate).slice(0, 10),
        shortCount: d.holdEmptyCount,
        longCount:  d.holdMoreCount,
        shortHands: d.holdEmptyHands,
        longHands:  d.holdMoreHands,
        countRatio: d.countProportion,
        handsRatio: d.handsProportion,
      }));
      if (!byBreed[t.breed.code]) byBreed[t.breed.code] = { name: t.breed.name };
      byBreed[t.breed.code][t.group.key] = series;
    } catch (e) {
      // 单品种失败不影响整体
    }
    done++;
    if (done % 80 === 0 || done === tasks.length) {
      onProgress(`抓取进度：${done} / ${tasks.length} 完成…`);
    }
    return null;
  }, 40, 100);

  onProgress('数据抓取完成，正在更新看板…');

  // 5. 更新 STATE
  const newSeries = {
    generatedAt: new Date().toISOString(),
    latestDate,
    breeds: byBreed,
  };

  // 合并到现有 series（保留旧数据，只覆盖已更新品种）
  if (STATE.series) {
    for (const code of Object.keys(byBreed)) {
      STATE.series.breeds[code] = byBreed[code];
    }
    STATE.series.latestDate = latestDate;
    STATE.series.generatedAt = newSeries.generatedAt;
  } else {
    STATE.series = newSeries;
  }

  // 提取 latest（最新日期快照）
  const latestBreeds = {};
  for (const code of Object.keys(byBreed)) {
    const bd = byBreed[code];
    const groups = {};
    for (const g of GROUP_IDS) {
      const p = (bd[g.key] || []).find(d => d.date === latestDate);
      if (p) groups[g.key] = { ...p };
    }
    if (Object.keys(groups).length) {
      latestBreeds[code] = { name: bd.name, groups };
    }
  }
  STATE.latest = { date: latestDate, breeds: latestBreeds };

  // 更新 meta
  if (STATE.meta) {
    const existingDates = new Set(STATE.meta.dates || []);
    // 从新 series 收集所有日期
    for (const code of Object.keys(byBreed)) {
      const bd = byBreed[code];
      for (const g of GROUP_IDS) {
        (bd[g.key] || []).forEach(d => existingDates.add(d.date));
      }
    }
    STATE.meta.dates = [...existingDates].sort();
    STATE.meta.latestDate = latestDate;
    STATE.meta.generatedAt = newSeries.generatedAt;
  }

  return { latestDate, updated: true, message: `已更新到 ${latestDate}` };
}

/** 更新按钮状态辅助 */
function setUpdateBtn(loading, text) {
  const btn = document.getElementById('btnUpdate');
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.classList.add('loading');
    btn.querySelector('.btn-update-label').textContent = text || '更新中…';
  } else {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.querySelector('.btn-update-label').textContent = '获取最新数据';
  }
}

function setUpdateStatus(msg, type = '') {
  const el = document.getElementById('updateStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'update-status' + (type ? ' ' + type : '');
}

/** 按钮点击处理 */
async function handleUpdate() {
  setUpdateBtn(true, '查询中…');
  setUpdateStatus('');
  try {
    const result = await fetchLatestFromSource((msg) => {
      setUpdateBtn(true, msg.length > 20 ? msg.slice(0, 20) + '…' : msg);
      setUpdateStatus(msg);
    });

    if (!result.updated) {
      setUpdateBtn(false);
      setUpdateStatus(result.message, 'ok');
      return;
    }

    // 重新渲染看板（全部视图都需刷新）
    renderMeta(STATE.meta, STATE.latest);
    populateSelectors();

    // 重新渲染当前激活视图
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      const view = activeTab.dataset.view;
      if (view === 'compare') renderCompare();
      else if (view === 'trend') renderTrend();
      else if (view === 'divergence') renderDivergence();
    }

    setUpdateBtn(false);
    setUpdateStatus(`✓ ${result.message}`, 'ok');
  } catch (e) {
    setUpdateBtn(false);
    // CORS 错误时给出明确提示
    const isCors = e.message && (e.message.includes('Failed to fetch') || e.message.includes('CORS') || e.message.includes('NetworkError'));
    if (isCors) {
      setUpdateStatus('⚠ 浏览器 CORS 限制，请通过 Vercel 后端更新：访问 /api/backfill?token=你的SECRET', 'err');
    } else {
      setUpdateStatus('❌ 更新失败：' + e.message, 'err');
    }
    console.error('[update]', e);
  }
}

/* ============ 启动 ============ */
document.addEventListener('DOMContentLoaded', () => {
  init();
  const btn = document.getElementById('btnUpdate');
  if (btn) btn.addEventListener('click', handleUpdate);
});
