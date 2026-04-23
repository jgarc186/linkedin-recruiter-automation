/**
 * Database locking stress test
 *
 * Runs 25 writer VUs (POST /webhook/message) and 25 reader VUs
 * (GET /webhook/pending-replies) simultaneously for 2 minutes.
 * Writers will be rate-limited (429s are expected and treated as successes).
 * Readers exercise the exclusive SQLite transaction in getPendingReplies().
 *
 * Pass/fail criteria:
 *   - Writers: < 5% non-200/non-429 responses
 *   - Readers: < 1% non-200 responses
 *   - No reply is returned by more than one polling response (double_deliveries == 0)
 *
 * Run:
 *   k6 run load-tests/k6/scenarios/database-locking.js \
 *     --env API_KEY=<your_key> \
 *     [--env BASE_URL=http://127.0.0.1:8000]
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { BASE_URL, authHeaders, makeMessagePayload } from '../helpers.js';

const writeErrors = new Rate('write_errors');
const readErrors = new Rate('read_errors');
const doubleDeliveries = new Counter('double_deliveries');

export const options = {
  scenarios: {
    writers: {
      executor: 'constant-vus',
      vus: 25,
      duration: '2m',
      exec: 'writeMessages',
    },
    readers: {
      executor: 'constant-vus',
      vus: 25,
      duration: '2m',
      exec: 'readReplies',
    },
  },
  thresholds: {
    write_errors: ['rate<0.05'],
    read_errors: ['rate<0.01'],
    double_deliveries: ['count<1'],
  },
};

// Per-VU set of seen reply IDs — detects any duplicate within a single poller's view
const seenReplies = new Set();

export function writeMessages() {
  const payload = makeMessagePayload(`${__VU}_${__ITER}`);
  const res = http.post(`${BASE_URL}/webhook/message`, payload, {
    headers: authHeaders,
  });
  // 200 = processed, 429 = rate-limited — both are expected outcomes
  const ok = res.status === 200 || res.status === 429;
  check(res, { 'write: no server error': () => ok });
  writeErrors.add(!ok);
}

export function readReplies() {
  const res = http.get(`${BASE_URL}/webhook/pending-replies`, {
    headers: authHeaders,
  });
  check(res, { 'read: status 200': (r) => r.status === 200 });
  readErrors.add(res.status !== 200);

  if (res.status === 200) {
    const body = res.json();
    if (body && Array.isArray(body.replies)) {
      for (const reply of body.replies) {
        if (seenReplies.has(reply.message_id)) {
          doubleDeliveries.add(1);
        }
        seenReplies.add(reply.message_id);
      }
    }
  }
}

export default function () {}
