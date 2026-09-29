# apis-to-mcp

A TypeScript Express server that exposes every [JSONPlaceholder](https://jsonplaceholder.typicode.com/) endpoint two ways:

- **REST proxy** – each request is forwarded upstream with its method, path, query string and JSON body, and the upstream status code and body are returned unchanged.
- **MCP server** – the same operations as MCP tools, served over Streamable HTTP at `POST /mcp`.

## Run

```bash
npm install
npm run dev          # tsx watch, http://localhost:3000
# or
npm run build && npm start
```

Environment variables:

| Variable | Default |
| --- | --- |
| `PORT` | `3000` |
| `UPSTREAM_BASE_URL` | `https://jsonplaceholder.typicode.com` |

## REST endpoints

Resources: `posts`, `comments`, `albums`, `photos`, `users`, `todos`.

| Method | Path |
| --- | --- |
| GET | `/:resource` (query filters pass through, e.g. `/comments?postId=1`) |
| GET | `/:resource/:id` |
| POST | `/:resource` |
| PUT | `/:resource/:id` |
| PATCH | `/:resource/:id` |
| DELETE | `/:resource/:id` |
| GET | `/posts/:id/comments`, `/albums/:id/photos`, `/users/:id/albums`, `/users/:id/todos`, `/users/:id/posts` |
| GET | `/health` |

Unknown routes return 404; an unreachable upstream returns 502.

## MCP

Endpoints (Streamable HTTP, stateless; `GET`/`DELETE` return 405):

| Environment | URL |
| --- | --- |
| Deployed (Vercel) | `https://apis-to-mcp.vercel.app/mcp` |
| Local | `http://localhost:3000/mcp` |

The deployed endpoint has no authentication: anyone with the URL can list and call every tool.

Tools are generated from the OpenAPI spec in `src/openapi.json`: one tool per operation, named by its `operationId`, described by its `description` (or `summary`), with its path, query and JSON body fields as tool arguments. Arguments are validated against the spec's schemas before the upstream call. To add, remove or change a tool, edit the spec.

`src/mcp-hardcoded.ts` holds the earlier hardcoded tool registration. It is inactive (nothing imports it) and kept for reference.

The current spec gives 41 tools:

| Tool | Upstream call |
| --- | --- |
| `list_<resource>` (optional field filters, e.g. `postId`, `userId`, `completed`) | `GET /<resource>?…` |
| `get_<singular>` | `GET /<resource>/:id` |
| `create_<singular>` | `POST /<resource>` |
| `update_<singular>` (all fields) | `PUT /<resource>/:id` |
| `patch_<singular>` (some fields) | `PATCH /<resource>/:id` |
| `delete_<singular>` | `DELETE /<resource>/:id` |
| `list_post_comments`, `list_album_photos`, `list_user_albums`, `list_user_todos`, `list_user_posts` | nested `GET` routes |

Tools return the upstream JSON as text. A non-2xx upstream status comes back with `isError: true`. JSONPlaceholder fakes writes, so create/update/delete responses look real but nothing is persisted.

Add it to Claude Code:

```bash
# deployed
claude mcp add --transport http jsonplaceholder https://apis-to-mcp.vercel.app/mcp
# local
claude mcp add --transport http jsonplaceholder http://localhost:3000/mcp
```

In claude.ai or Claude Desktop, add `https://apis-to-mcp.vercel.app/mcp` as a custom connector (Settings → Connectors).

Or inspect it with `npx @modelcontextprotocol/inspector` (transport: Streamable HTTP).

## Validate

Lint the spec:

```bash
npx @redocly/cli lint src/openapi.json
```


With the server running:

```bash
npm run validate     # 51 REST requests, compared against the upstream
npm run mcp-smoke    # MCP client: lists tools and calls a sample of them
```
# apis-to-mcp
