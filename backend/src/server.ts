import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { webhookRoutes } from './routes/webhook.js';
import { config, validateConfig } from './config.js';

export async function createApp() {
  const app = Fastify({
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
  });

  await app.register(cors, {
    origin: /^chrome-extension:\/\//,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-API-Key'],
  });

  // Register routes
  await app.register(webhookRoutes);

  // Health check
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  return app;
}

// Start server
const start = async () => {
  try {
    validateConfig();
    const app = await createApp();
    await app.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`Server running on http://${config.host}:${config.port}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { start };
