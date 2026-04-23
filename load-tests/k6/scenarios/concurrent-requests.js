/**
 * Concurrent request load test
 *
 * Ramps from 10 to 50 VUs and exercises /health, /webhook/pending-replies,
 * and /webhook/reply. The /webhook/message endpoint is intentionally excluded
 * here because its 10 req/min per-key rate limit makes it unsuitable for
 * high-VU throughput measurement — use rate-limit-spike.js for that.
 *
 * Run:
 *   k6 run load-tests/k6/scenarios/concurrent-requests.js \
 *     --env API_KEY=<your_key> \
 *     [--env BASE_URL=http://127.0.0.1:8000]
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, authHeaders } from '../helpers.js';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{endpoint:health}': ['p(95)<50'],
    'http_req_duration{endpoint:pending-replies}': ['p(95)<200'],
    'http_req_duration{endpoint:reply}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // Health check (unauthenticated)
  const health = http.get(`${BASE_URL}/health`, {
    tags: { endpoint: 'health' },
  });
  check(health, { 'health: status 200': (r) => r.status === 200 });
  errorRate.add(health.status !== 200);

  // Poll for pending replies
  const pending = http.get(`${BASE_URL}/webhook/pending-replies`, {
    headers: authHeaders,
    tags: { endpoint: 'pending-replies' },
  });
  check(pending, { 'pending-replies: status 200': (r) => r.status === 200 });
  errorRate.add(pending.status !== 200);

  // Confirm reply delivery (message_id need not exist — handler silently no-ops)
  const reply = http.post(
    `${BASE_URL}/webhook/reply`,
    JSON.stringify({
      message_id: `msg_load_${__VU}_${__ITER}`,
      drafted_reply: 'Load test reply',
    }),
    { headers: authHeaders, tags: { endpoint: 'reply' } },
  );
  check(reply, { 'reply: status 200': (r) => r.status === 200 });
  errorRate.add(reply.status !== 200);

  sleep(1);
}
