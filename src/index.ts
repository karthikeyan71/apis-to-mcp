import { createApp } from './create-app';
import { UPSTREAM_BASE_URL } from './upstream';

const port = Number(process.env.PORT ?? 3000);

createApp().listen(port, () => {
  console.log(`JSONPlaceholder proxy listening on http://localhost:${port} (upstream: ${UPSTREAM_BASE_URL})`);
});
