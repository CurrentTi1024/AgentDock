// AgentDock Copilot Runtime 服务入口（方案 A）：
// 与前端同仓库、同进程托管；OAuth2 Proxy 把 /api/copilotkit 固定转发到这里。
// 职责：single-route 官方 Runtime handler + FabRoutingAgent（按 fab 选上游）+ 可选静态资源托管。
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

import { CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2';
import { createCopilotNodeHandler } from '@copilotkit/runtime/v2/node';

import { FabRoutingAgent } from './copilot-runtime/fabRoutingAgent.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = process.env.AGENTDOCK_DIST_DIR ?? join(process.cwd(), 'dist');

const parseFabEndpoints = (): Record<string, string> => {
  const raw = process.env.AGENT_ORCHESTRATION_BASE_URLS_JSON;
  if (!raw) return {};
  let endpoints: Record<string, string>;
  try {
    endpoints = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error('AGENT_ORCHESTRATION_BASE_URLS_JSON is not valid JSON');
  }
  // 协议（http/https）由公司内网部署规范决定，代码不做强制校验。
  return endpoints;
};

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const serveStatic = (req: IncomingMessage, res: ServerResponse, distDir: string) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0] || '/');
  let filePath = normalize(join(distDir, urlPath === '/' ? 'index.html' : urlPath));
  // 防目录穿越：必须仍位于 distDir 内
  const normalizedDist = normalize(distDir);
  if (filePath !== normalizedDist && !filePath.startsWith(`${normalizedDist}${sep}`)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, 'index.html');
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
  });
  const body = readFileSync(filePath);
  res.end(req.method === 'HEAD' ? undefined : body);
};

const runtime = new CopilotRuntime({
  agents: {
    orchestration: new FabRoutingAgent({ fabToBaseUrl: parseFabEndpoints() }),
  },
  a2ui: {},
});

const fetchHandler = createCopilotRuntimeHandler({
  basePath: '/api/copilotkit',
  mode: 'single-route',
  runtime,
});
const nodeHandler = createCopilotNodeHandler(fetchHandler);

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/healthz' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/api/copilotkit' || req.url?.startsWith('/api/copilotkit/')) {
      await nodeHandler(req, res);
      return;
    }
    if (existsSync(DIST_DIR)) {
      serveStatic(req, res, DIST_DIR);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (error) {
    console.error('[AgentDock Runtime] unhandled error', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }));
  }
});

const HOST = process.env.HOST ?? '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`[AgentDock Runtime] listening on http://${HOST}:${PORT}`);
  console.log(`[AgentDock Runtime] FAB endpoints: ${Object.keys(parseFabEndpoints()).join(', ') || '(none)'}`);
});
