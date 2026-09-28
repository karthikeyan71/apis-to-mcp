import express, { type Request, type Response, type NextFunction } from 'express';
import { RESOURCES, NESTED } from './resources';
import { forward, UPSTREAM_BASE_URL } from './upstream';
import { handleMcp, methodNotAllowed } from './mcp';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', upstream: UPSTREAM_BASE_URL });
  });

  app.post('/mcp', handleMcp);
  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  for (const resource of RESOURCES) {
    const router = express.Router();
    // Query filters such as ?postId=1 or ?userId=1&completed=true pass through via originalUrl.
    router.get('/', forward);
    router.post('/', forward);
    router.get('/:id', forward);
    router.put('/:id', forward);
    router.patch('/:id', forward);
    router.delete('/:id', forward);
    app.use(`/${resource}`, router);
  }

  for (const { parent, child } of NESTED) {
    app.get(`/${parent}/:id/${child}`, forward);
  }

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: 'Upstream request failed', detail: message });
  });

  return app;
}
