import type { Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RESOURCES, NESTED, type Resource } from './resources';
import { callUpstream } from './upstream';

const SINGULAR: Record<Resource, string> = {
  posts: 'post',
  comments: 'comment',
  albums: 'album',
  photos: 'photo',
  users: 'user',
  todos: 'todo',
};

const id = z.number().int().positive();
const json = z.record(z.string(), z.unknown());

// Writable fields of each resource.
const FIELDS: Record<Resource, z.ZodRawShape> = {
  posts: { userId: id, title: z.string(), body: z.string() },
  comments: { postId: id, name: z.string(), email: z.string(), body: z.string() },
  albums: { userId: id, title: z.string() },
  photos: { albumId: id, title: z.string(), url: z.string(), thumbnailUrl: z.string() },
  users: {
    name: z.string(),
    username: z.string(),
    email: z.string(),
    phone: z.string(),
    website: z.string(),
    address: json.optional(),
    company: json.optional(),
  },
  todos: { userId: id, title: z.string(), completed: z.boolean() },
};

// Scalar fields that can be used as ?field=value filters on list endpoints.
const FILTERS: Record<Resource, z.ZodRawShape> = {
  posts: { userId: id },
  comments: { postId: id, email: z.string() },
  albums: { userId: id },
  photos: { albumId: id },
  users: { username: z.string(), email: z.string() },
  todos: { userId: id, completed: z.boolean() },
};

function partial(shape: z.ZodRawShape): z.ZodRawShape {
  return z.object(shape).partial().shape;
}

function withQuery(path: string, params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

async function run(method: string, path: string, body?: unknown): Promise<CallToolResult> {
  const { status, text } = await callUpstream(method, path, body);
  let payload = text;
  try {
    payload = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // Non-JSON body: return as-is.
  }
  const ok = status >= 200 && status < 300;
  return {
    content: [{ type: 'text', text: ok ? payload : `HTTP ${status} ${method} ${path}\n${payload}` }],
    isError: !ok,
  };
}

const READ = { readOnlyHint: true, openWorldHint: true } as const;

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'apis-to-mcp', version: '1.0.0' });

  for (const r of RESOURCES) {
    const one = SINGULAR[r];

    server.registerTool(
      `list_${r}`,
      {
        description: `List ${r}. Optional filters narrow results by field value.`,
        inputSchema: partial(FILTERS[r]),
        annotations: READ,
      },
      (args) => run('GET', withQuery(`/${r}`, args)),
    );

    server.registerTool(
      `get_${one}`,
      { description: `Get one ${one} by id.`, inputSchema: { id }, annotations: READ },
      ({ id }) => run('GET', `/${r}/${id}`),
    );

    server.registerTool(
      `create_${one}`,
      {
        description: `Create a ${one}. Writes are faked: the response echoes the new ${one} but nothing is persisted.`,
        inputSchema: FIELDS[r],
        annotations: { openWorldHint: true },
      },
      (args) => run('POST', `/${r}`, args),
    );

    server.registerTool(
      `update_${one}`,
      {
        description: `Replace a ${one} (PUT). All fields are required. Writes are faked and not persisted.`,
        inputSchema: { id, ...FIELDS[r] },
        annotations: { idempotentHint: true, openWorldHint: true },
      },
      ({ id, ...body }) => run('PUT', `/${r}/${id}`, { id, ...body }),
    );

    server.registerTool(
      `patch_${one}`,
      {
        description: `Update some fields of a ${one} (PATCH). Writes are faked and not persisted.`,
        inputSchema: { id, ...partial(FIELDS[r]) },
        annotations: { openWorldHint: true },
      },
      ({ id, ...body }) => run('PATCH', `/${r}/${id}`, body),
    );

    server.registerTool(
      `delete_${one}`,
      {
        description: `Delete a ${one} by id. Writes are faked and not persisted.`,
        inputSchema: { id },
        annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      ({ id }) => run('DELETE', `/${r}/${id}`),
    );
  }

  for (const { parent, child } of NESTED) {
    const one = SINGULAR[parent];
    server.registerTool(
      `list_${one}_${child}`,
      { description: `List the ${child} that belong to a ${one}.`, inputSchema: { id }, annotations: READ },
      ({ id }) => run('GET', `/${parent}/${id}/${child}`),
    );
  }

  return server;
}

/**
 * Stateless Streamable HTTP endpoint: each POST gets a fresh server and
 * transport, so no session state is kept between requests.
 */
export async function handleMcp(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal server error' },
        id: null,
      });
    }
  }
}

export function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: this MCP server is stateless, use POST.' },
    id: null,
  });
}
