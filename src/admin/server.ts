/**
 * config-ui：部署配置的浏览器编辑服务（独立入口，零依赖）。
 * Standalone config-editing web service. 设计对齐 docs/config-ui.md。
 *
 * 访问控制靠网络层（compose 默认只绑 127.0.0.1），服务本身无登录；
 * 页面会明文展示密钥，严禁暴露到公网。
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { MANAGED_FILES, validateContent } from './validate';

const CONFIG_DIR = process.env.CONFIG_DIR?.trim() || '/config';
const PORT = Number(process.env.ADMIN_PORT || 8081);
if (!Number.isInteger(PORT)) throw new Error(`环境变量 ADMIN_PORT 必须是整数，实际为: ${process.env.ADMIN_PORT}`);

function fileState(name: string): { name: string; label: string; exists: boolean; content: string } {
  const meta = MANAGED_FILES.find((f) => f.name === name)!;
  const p = path.join(CONFIG_DIR, name);
  if (!fs.existsSync(p)) return { name, label: meta.label, exists: false, content: '' };
  return { name, label: meta.label, exists: true, content: fs.readFileSync(p, 'utf-8') };
}

/**
 * 原地覆写（O_TRUNC 不换 inode）。禁止改成「临时文件 + rename」的原子写法：
 * bot 容器按单文件 bind mount 挂载这些 json，rename 换 inode 会让挂载点指向旧文件。
 */
function saveFile(name: string, content: string): void {
  fs.writeFileSync(path.join(CONFIG_DIR, name), content, 'utf-8');
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('请求体超过 1MB'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FeiShuBot 配置</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 24px auto; padding: 0 16px; background: #f6f7f9; color: #1f2328; }
  h1 { font-size: 20px; }
  .notice { background: #fff8e6; border: 1px solid #e0c060; border-radius: 6px; padding: 10px 14px; margin-bottom: 20px; font-size: 14px; }
  .notice code { background: #f0e6c8; padding: 1px 5px; border-radius: 4px; }
  section { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; margin-bottom: 16px; padding: 14px 16px; }
  section h2 { font-size: 15px; margin: 0 0 2px; font-family: ui-monospace, monospace; }
  section p { margin: 2px 0 10px; font-size: 13px; color: #57606a; }
  textarea { width: 100%; min-height: 140px; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 13px; border: 1px solid #d0d7de; border-radius: 6px; padding: 8px; resize: vertical; }
  .row { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  button { background: #1f6feb; color: #fff; border: 0; border-radius: 6px; padding: 6px 16px; font-size: 14px; cursor: pointer; }
  button:disabled { background: #8bb4f0; cursor: default; }
  .status { font-size: 13px; }
  .status.ok { color: #1a7f37; }
  .status.err { color: #cf222e; white-space: pre-wrap; }
  .missing { color: #cf222e; font-size: 13px; }
</style>
</head>
<body>
<h1>FeiShuBot 配置</h1>
<div class="notice">
  保存只写宿主机上的文件；<b>改动要生效必须重建 bot 容器</b>：<code>docker compose up -d --force-recreate feishubot</code>
  （不能用 <code>restart</code>，它不会重新读 .env）。
</div>
<div id="sections">加载中…</div>
<script>
async function load() {
  const res = await fetch('/api/files');
  const { files } = await res.json();
  const root = document.getElementById('sections');
  root.innerHTML = '';
  for (const f of files) {
    const sec = document.createElement('section');
    const missing = f.exists ? '' : '<span class="missing">（文件尚不存在，保存时会创建）</span>';
    sec.innerHTML =
      '<h2>' + f.name + '</h2><p>' + f.label + ' ' + missing + '</p>' +
      '<textarea></textarea>' +
      '<div class="row"><button>保存</button><span class="status"></span></div>';
    sec.querySelector('textarea').value = f.content;
    sec.querySelector('button').addEventListener('click', () => save(sec, f.name));
    root.appendChild(sec);
  }
}
async function save(sec, name) {
  const btn = sec.querySelector('button');
  const status = sec.querySelector('.status');
  btn.disabled = true;
  status.className = 'status';
  status.textContent = '保存中…';
  try {
    const res = await fetch('/api/files/' + encodeURIComponent(name), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: sec.querySelector('textarea').value,
    });
    const body = await res.json();
    if (res.ok) {
      status.className = 'status ok';
      status.textContent = '已保存 ' + new Date().toLocaleTimeString() + '（重建 bot 容器后生效）';
    } else {
      status.className = 'status err';
      status.textContent = '校验失败: ' + body.error;
    }
  } catch (e) {
    status.className = 'status err';
    status.textContent = '请求失败: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}
load();
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/files') {
      json(res, 200, { files: MANAGED_FILES.map((f) => fileState(f.name)) });
      return;
    }

    const m = url.pathname.match(/^\/api\/files\/(.+)$/);
    if (req.method === 'PUT' && m) {
      const name = decodeURIComponent(m[1]);
      const meta = MANAGED_FILES.find((f) => f.name === name);
      if (!meta) {
        json(res, 404, { error: `不受管理的文件: ${name}` });
        return;
      }
      const content = await readBody(req);
      const error = validateContent(meta.kind, content);
      if (error) {
        json(res, 400, { error });
        return;
      }
      saveFile(name, content);
      console.log(`[config-ui] 已保存 ${name} (${content.length} 字节)`);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(`[config-ui] 处理 ${req.method} ${url.pathname} 失败:`, e);
    json(res, 500, { error: (e as Error).message });
  }
});

if (!fs.existsSync(CONFIG_DIR)) {
  throw new Error(`配置目录不存在: ${CONFIG_DIR}（应把部署目录挂载到容器内 CONFIG_DIR，见 docs/config-ui.md）`);
}

server.listen(PORT, () => {
  console.log(`[config-ui] 已启动 http://0.0.0.0:${PORT} 配置目录=${CONFIG_DIR}`);
  console.log('[config-ui] 无登录鉴权，访问控制靠端口绑定/防火墙，严禁暴露公网（docs/config-ui.md §1）');
});
