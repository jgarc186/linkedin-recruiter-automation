/**
 * Rate-limit spike test
 *
 * Spikes to 200 VUs hitting POST /webhook/message (limit: 10 req/min per key).
 * Asserts that:
 *   - The rate limiter triggers: > 80% of requests return 429
 *   - Every 429 response includes the Retry-After header
 *   - No 5xx responses occur (rate limiter must not cause server errors)
 *
 * Run:
 *   k6 run load-tests/k6/scenarios/rate-limit-spike.js \
 *     --env API_KEY=<your_key> \
 *     [--env BASE_URL=http://127.0.0.1:8000]
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { BASE_URL, authHeaders, makeMessagePayload } from '../helpers.js';

const rateLimited = new Rate('rate_limited');
const retryAfterMissing = new Counter('retry_after_missing');
const serverErrors = new Rate('server_errors');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      exec: 'spike',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '0s',
    },
  },
  thresholds: {
    // Rate limiter must be active: expect > 80% of requests to be throttled
    rate_limited: ['rate>0.8'],
    // Retry-After header must always accompany a 429
    retry_after_missing: ['count<1'],
    // No 5xx responses — rate limiting must not destabilise the server
    server_errors: ['rate<0.01'],
  },
};

export function spike() {
  const res = http.post(
    `${BASE_URL}/webhook/message`,
    makeMessagePayload(`${__VU}_${__ITER}`),
    { headers: authHeaders },
  );

  rateLimited.add(res.status === 429);
  serverErrors.add(res.status >= 500);

  if (res.status === 429) {
    const hasRetryAfter =
      res.headers['retry-after'] !== undefined ||
      res.headers['Retry-After'] !== undefined;
    if (!hasRetryAfter) {
      retryAfterMissing.add(1);
    }
    check(res, { '429 has Retry-After header': () => hasRetryAfter });
  } else {
    check(res, { 'non-429: no server error': (r) => r.status < 500 });
  }
}

export default function () {}
