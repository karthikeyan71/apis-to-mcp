import type { Request, Response, NextFunction } from 'express';

export const UPSTREAM_BASE_URL = (
  process.env.UPSTREAM_BASE_URL ?? 'https://jsonplaceholder.typicode.com'
).replace(/\/$/, '');

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export type UpstreamResponse = { status: number; contentType: string | null; text: string };

/**
 * Sends one request to JSONPlaceholder. `path` includes any query string.
 * Shared by the REST proxy and the MCP tools.
 */
export async function callUpstream(method: string, path: string, body?: unknown): Promise<UpstreamResponse> {
  const hasBody = BODY_METHODS.has(method);
  const upstream = await fetch(UPSTREAM_BASE_URL + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}),
    },
    body: hasBody ? JSON.stringify(body ?? {}) : undefined,
  });
  return {
    status: upstream.status,
    contentType: upstream.headers.get('content-type'),
    text: await upstream.text(),
  };
}

/**
 * Forwards the incoming request (method, path, query string, JSON body) to
 * JSONPlaceholder and relays the upstream status code and body unchanged.
 */
export async function forward(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, contentType, text } = await callUpstream(req.method, req.originalUrl, req.body);
    if (contentType) res.type(contentType);
    res.status(status).send(text);
  } catch (err) {
    next(err);
  }
}
