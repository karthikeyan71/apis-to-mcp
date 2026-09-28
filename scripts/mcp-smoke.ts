/**
 * Connects to the MCP endpoint as a client, lists tools and calls a few. Usage:
 *   MCP_URL=http://localhost:3000/mcp npx tsx scripts/mcp-smoke.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3000/mcp';

async function main() {
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));

  const { tools } = await client.listTools();
  console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

  const calls: Array<[string, Record<string, unknown>]> = [
    ['get_post', { id: 1 }],
    ['list_comments', { postId: 1 }],
    ['list_todos', { userId: 1, completed: true }],
    ['list_user_albums', { id: 1 }],
    ['create_post', { userId: 1, title: 'foo', body: 'bar' }],
    ['patch_todo', { id: 1, completed: true }],
    ['delete_album', { id: 1 }],
    ['get_user', { id: 999999 }],
  ];
  let failed = 0;
  for (const [name, args] of calls) {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    let summary = text.slice(0, 60).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(text);
      summary = Array.isArray(j) ? `${j.length} items` : JSON.stringify(j).slice(0, 60);
    } catch {}
    const expectError = name === 'get_user' && args.id === 999999;
    const ok = Boolean(res.isError) === expectError;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(18)} ${JSON.stringify(args).padEnd(34)} ${res.isError ? 'isError ' : ''}${summary}`);
  }
  await client.close();
  console.log(`\n${calls.length - failed}/${calls.length} passed`);
  process.exit(failed ? 1 : 0);
}

main();
