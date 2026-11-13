#!/usr/bin/env node
/**
 * 科协运营管理平台 MCP 工具服务（stdio，零依赖）
 * 通过已有的 REST API + API Key 暴露只读查询能力，供 AI 助手/Agent 调用。
 *
 * 环境变量：
 *   KX_API_URL  平台地址，默认 http://1.14.125.216/api/v1
 *   KX_API_KEY  在平台「API 密钥」页签发的密钥（需所属成员具备 api 权限）
 */
import readline from 'node:readline';

const API_URL = (process.env.KX_API_URL || 'http://1.14.125.216/api/v1').replace(/\/+$/, '');
const API_KEY = process.env.KX_API_KEY || '';
const VERSION = '1.0.0';

const tools = [
  {
    name: 'list_equipment',
    description: '查询设备列表与状态（可预约/维护中/停用），支持按名称或编号搜索',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索关键词，匹配名称/编号/分类' },
        status: { type: 'string', enum: ['available', 'maintenance', 'retired'], description: '按状态过滤' },
      },
    },
    handler: async ({ q, status }) => {
      const data = await api('/equipment' + qs({ q }));
      let items = data.items || [];
      if (status) items = items.filter((item) => item.status === status);
      return { summary: data.summary, count: items.length, items: items.slice(0, 50) };
    },
  },
  {
    name: 'list_inventory',
    description: '查询元器件库存，可只看低库存预警项',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '搜索名称/规格/封装' },
        lowOnly: { type: 'boolean', description: '仅返回低于预警阈值的物料' },
      },
    },
    handler: async ({ q, lowOnly }) => {
      const data = await api('/inventory' + qs({ q, low: lowOnly ? '1' : undefined }));
      return { summary: data.summary, count: (data.items || []).length, items: (data.items || []).slice(0, 50) };
    },
  },
  {
    name: 'list_consumables',
    description: '查询耗材库存（3D 打印丝材、耗材等）',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', description: '搜索名称/规格' } },
    },
    handler: async ({ q }) => {
      const data = await api('/consumables' + qs({ q }));
      return { count: (data.items || []).length, items: (data.items || []).slice(0, 50) };
    },
  },
  {
    name: 'list_activities',
    description: '查询科协活动列表、报名情况与我的报名状态',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'open', 'closed', 'finished', 'cancelled'] },
        mine: { type: 'boolean', description: '只看我报名的活动' },
      },
    },
    handler: async ({ status, mine }) => {
      const data = await api('/activities' + qs({ status, mine: mine ? '1' : undefined }));
      return { open: data.open, count: (data.items || []).length, items: (data.items || []).slice(0, 30) };
    },
  },
  {
    name: 'my_bookings',
    description: '查询当前账号的设备预约记录（状态、时间段、设备名）',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const data = await api('/equipment/bookings?mine=1');
      return { count: (data.items || []).length, items: (data.items || []).slice(0, 30) };
    },
  },
  {
    name: 'operations_summary',
    description: '获取运营总览：待审核预约、门禁待办、开放活动数、低库存数、今日值班',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => api('/summary/operations'),
  },
  {
    name: 'search_documents',
    description: '搜索科协资料库（技术文档、培训材料等）',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: '按分类过滤' } },
    },
    handler: async ({ category }) => {
      const data = await api('/documents' + qs({ category }));
      return { categories: data.categories, count: (data.items || []).length, items: (data.items || []).slice(0, 30) };
    },
  },
];

function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function api(path) {
  if (!API_KEY) throw new Error('缺少 KX_API_KEY 环境变量，请先在平台签发 API 密钥');
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'X-API-Key': API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(`接口 ${path} 返回 ${res.status}：${body.error || text.slice(0, 200)}`);
  return body;
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'kx-ops', version: VERSION },
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, {
      tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const tool = tools.find((item) => item.name === name);
    if (!tool) return replyError(id, -32602, `未知工具：${name}`);
    try {
      const data = await tool.handler(params?.arguments || {});
      return reply(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (err) {
      return reply(id, { content: [{ type: 'text', text: String(err.message || err) }], isError: true });
    }
  }
  if (id !== undefined && id !== null) replyError(id, -32601, `未实现的方法：${method}`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    process.stderr.write(`[kx-mcp] 无法解析的请求：${text.slice(0, 120)}\n`);
    return;
  }
  handle(msg).catch((err) => {
    process.stderr.write(`[kx-mcp] 处理失败：${err.message}\n`);
    if (msg.id !== undefined) replyError(msg.id, -32603, err.message);
  });
});
