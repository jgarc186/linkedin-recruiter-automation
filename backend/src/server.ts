import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { webhookRoutes } from './routes/webhook.js';
import { config, validateConfig } from './config.js';

export async function createApp() {
  const app = Fastify({
    trustProxy: false, // GHSA-444r-cwp2-x5xf: never trust X-Forwarded-* from clients
    bodyLimit: 65536,
    logger: {
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
          };
        },
      },
    },
  });

  // Register plugins
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'];
      return typeof apiKey === 'string' && apiKey ? apiKey : request.ip;
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  await app.register(cors, {
    origin: `chrome-extension://${config.extensionId}`,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
  });

  // Register routes
  await app.register(webhookRoutes);

  // Health check — excluded from rate limiting
  app.get('/health', { config: { rateLimit: false } }, async () => {
    return { status: 'ok' };
  });

  // Memory diagnostics — dev/test only, never expose in production
  if (process.env.NODE_ENV !== 'production') {
    app.get('/debug/memory', { config: { rateLimit: false } }, async () => {
      const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
      return { rss, heapTotal, heapUsed, external };
    });
  }

  return app;
}

export function registerShutdownHandlers(app: FastifyInstance, timeoutMs = 10_000): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}, shutting down`);

    const timer = setTimeout(() => {
      app.log.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();

    try {
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

/* v8 ignore start */
const start = async () => {
  try {
    validateConfig();
    const app = await createApp();
    await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`Server running on http://${config.host}:${config.port}`);
    registerShutdownHandlers(app);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}
/* v8 ignore end */

export { start };
