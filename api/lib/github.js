/**
 * GitHub Contents API 封装 —— 把仓库当数据库用。
 *
 * 核心能力：
 *  - readFile(path)        读取文件（raw 内容 + sha）
 *  - writeFile(path, obj)  写入/更新 JSON 文件（自动处理 sha，支持幂等覆盖）
 *  - commitMany(updates)   一次 commit 提交多个文件（用 Git Data API 的 tree 机制）
 *
 * 环境变量：GH_TOKEN / GH_OWNER / GH_REPO
 */

'use strict';

const { BASE } = require('./qhrb');

const API_ROOT = 'https://api.github.com';

function cfg() {
  const { GH_TOKEN, GH_OWNER, GH_REPO } = process.env;
  if (!GH_TOKEN || !GH_OWNER || !GH_REPO) {
    throw new Error('缺少环境变量 GH_TOKEN / GH_OWNER / GH_REPO');
  }
  return { token: GH_TOKEN, owner: GH_OWNER, repo: GH_REPO };
}

async function gh(path, init = {}) {
  const { token } = cfg();
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'futures-hold-tracker',
  };
  if (init.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_ROOT + path, { ...init, headers });
  return res;
}

/** 读取单个文件。返回 { content, sha, exists }。 */
async function readFile(path) {
  const { owner, repo } = cfg();
  const res = await gh(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`,
    { method: 'GET' }
  );
  if (res.status === 404) return { content: null, sha: null, exists: false };
  if (!res.ok) throw new Error(`GitHub read ${path} 失败: HTTP ${res.status}`);
  const data = await res.json();
  // content 是 base64
  const buf = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
  return { content: buf.toString('utf8'), sha: data.sha, exists: true };
}

/** 写入单个 JSON 文件（覆盖式，幂等）。 */
async function writeFile(path, obj, message) {
  const { owner, repo } = cfg();
  const content = Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64');

  // 先取现有 sha（如存在）
  const existing = await readFile(path);
  const body = {
    message: message || `chore(data): update ${path}`,
    content,
    branch: process.env.GH_BRANCH || 'main',
  };
  if (existing.sha) body.sha = existing.sha;

  const res = await gh(
    `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`,
    { method: 'PUT', body: JSON.stringify(body) }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub write ${path} 失败: HTTP ${res.status} ${txt}`);
  }
  return res.json();
}

/**
 * 一次 commit 多个文件（用 Git Data API）。
 * @param updates  [{ path, content(string) }, ...]
 * @param message  commit message
 */
async function commitMany(updates, message) {
  if (updates.length === 0) return null;
  const { owner, repo } = cfg();
  const branch = process.env.GH_BRANCH || 'main';

  // 1. 拿分支当前 commit 及其 tree
  const refRes = await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  if (!refRes.ok) throw new Error(`获取 ref 失败: HTTP ${refRes.status}`);
  const ref = await refRes.json();
  const latestCommitSha = ref.object.sha;

  // 2. 拿 base tree
  const commitRes = await gh(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`);
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 3. 构造新 tree（仅含变更的文件，基于 base tree）
  const treeEntries = updates.map((u) => ({
    path: u.path,
    mode: '100644',
    type: 'blob',
    content: typeof u.content === 'string' ? u.content : JSON.stringify(u.content, null, 2),
  }));
  const treeRes = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw new Error(`创建 tree 失败: HTTP ${treeRes.status} ${await treeRes.text()}`);
  const newTree = await treeRes.json();

  // 4. 创建 commit
  const newCommitRes = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message || 'chore(data): batch update',
      tree: newTree.sha,
      parents: [latestCommitSha],
    }),
  });
  const newCommit = await newCommitRes.json();

  // 5. 更新分支 ref
  await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  });

  return newCommit.sha;
}

module.exports = { readFile, writeFile, commitMany };
