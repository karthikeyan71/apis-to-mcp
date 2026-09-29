import type { Request, Response } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { callUpstream } from './upstream';
import openapi from './openapi.json';

// One MCP tool is registered per operation in ./openapi.json. The previous
// hardcoded registration is kept, inactive, in ./mcp-hardcoded.ts.

type JsonSchema = Record<string, unknown>;
type Parameter = { name: string; in: string; required?: boolean; description?: string; schema?: JsonSchema };
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
};
type PathItem = { parameters?: Parameter[] } & Partial<Record<Method, Operation>>;
type Method = (typeof METHODS)[number];

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const ANNOTATIONS: Record<Method, ToolAnnotations> = {
  get: { readOnlyHint: true, openWorldHint: true },
  post: { openWorldHint: true },
  put: { idempotentHint: true, openWorldHint: true },
  patch: { openWorldHint: true },
  delete: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
};

type ToolDef = {
  name: string;
  title?: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: z.ZodRawShape;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  bodyFields: string[];
};

/** Replaces every local `$ref` (e.g. `#/components/schemas/Post`) with its target. The spec must be acyclic. */
function deref<T>(node: unknown): T {
  if (Array.isArray(node)) return node.map((n) => deref(n)) as T;
  if (!node || typeof node !== 'object') return node as T;
  const ref = (node as { $ref?: unknown }).$ref;
  if (typeof ref === 'string') {
    const target = ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((obj, key) => (obj as Record<string, unknown>)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], openapi);
    if (target === undefined) throw new Error(`openapi.json: unresolved $ref ${ref}`);
    return deref(target);
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, deref(v)])) as T;
}

function toZod(schema: JsonSchema, description?: string, required = true): z.ZodType {
  let t = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  if (description) t = t.describe(description);
  return required ? t : t.optional();
}

/** Turns one OpenAPI operation into a tool: path, query and JSON body fields become flat tool arguments. */
function toolFromOperation(path: string, method: Method, item: PathItem, op: Operation): ToolDef {
  const name = op.operationId;
  if (!name) throw new Error(`openapi.json: ${method.toUpperCase()} ${path} has no operationId`);

  const shape: Record<string, z.ZodType> = {};
  const add = (arg: string, zod: z.ZodType) => {
    if (arg in shape) throw new Error(`openapi.json: ${name} has two inputs named "${arg}"`);
    shape[arg] = zod;
  };

  // Operation-level parameters override path-level ones with the same name and location.
  const params = new Map<string, Parameter>();
  for (const p of [...(item.parameters ?? []), ...(op.parameters ?? [])]) params.set(`${p.in}:${p.name}`, p);

  const pathParams: string[] = [];
  const queryParams: string[] = [];
  for (const p of params.values()) {
    if (p.in !== 'path' && p.in !== 'query') continue; // header/cookie parameters are not exposed as tool inputs
    add(p.name, toZod(p.schema ?? {}, p.description, p.in === 'path' || !!p.required));
    (p.in === 'path' ? pathParams : queryParams).push(p.name);
  }

  const bodyFields: string[] = [];
  const body = op.requestBody?.content?.['application/json']?.schema;
  if (body) {
    const props = (body.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((body.required as string[] | undefined) ?? []);
    if (body.type !== 'object' || !Object.keys(props).length) {
      throw new Error(`openapi.json: ${name} request body must be an object with properties`);
    }
    for (const [field, schema] of Object.entries(props)) {
      add(field, toZod(schema, undefined, !!op.requestBody?.required && required.has(field)));
      bodyFields.push(field);
    }
  }

  return {
    name,
    title: op.summary,
    description: op.description ?? op.summary ?? `${method.toUpperCase()} ${path}`,
    annotations: ANNOTATIONS[method],
    inputSchema: shape,
    method: method.toUpperCase(),
    path,
    pathParams,
    queryParams,
    bodyFields,
  };
}

function loadTools(): ToolDef[] {
  const paths = deref<Record<string, PathItem>>(openapi.paths);
  const tools: ToolDef[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (op) tools.push(toolFromOperation(path, method, item, op));
    }
  }
  return tools;
}

// Parsed once per cold start; each request then only registers the prebuilt definitions.
const TOOLS = loadTools();

function buildUrl(tool: ToolDef, args: Record<string, unknown>): string {
  let url = tool.path;
  for (const p of tool.pathParams) url = url.replace(`{${p}}`, encodeURIComponent(String(args[p])));
  const qs = new URLSearchParams();
  for (const q of tool.queryParams) if (args[q] !== undefined) qs.set(q, String(args[q]));
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

function buildBody(tool: ToolDef, args: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!tool.bodyFields.length) return undefined;
  return Object.fromEntries(tool.bodyFields.filter((f) => args[f] !== undefined).map((f) => [f, args[f]]));
}

export async function run(method: string, path: string, body?: unknown): Promise<CallToolResult> {
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

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'apis-to-mcp', version: openapi.info.version });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      (args: Record<string, unknown>) => run(tool.method, buildUrl(tool, args), buildBody(tool, args)),
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
