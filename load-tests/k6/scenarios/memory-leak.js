/**
 * Memory leak soak test
 *
 * Runs 20 VUs at steady load for 10 minutes while a separate probe VU
 * samples /debug/memory every 30 seconds. If heap growth exceeds 50 MB
 * from the baseline, the test fails.
 *
 * Prerequisites:
 *   - Server must be started with NODE_ENV != 'production' so that
 *     /debug/memory is available (it is the default for npm run dev).
 *
 * Run:
 *   k6 run load-tests/k6/scenarios/memory-leak.js \
 *     --env API_KEY=<your_key> \
 *     [--env BASE_URL=http://127.0.0.1:8000]
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, authHeaders } from '../helpers.js';

const heapUsed = new Trend('heap_used_bytes');
const heapGrowthExceeded = new Counter('heap_growth_exceeded');
const MAX_HEAP_GROWTH_MB = 50;

export const options = {
  scenarios: {
    steady_load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '10m',
      exec: 'workload',
    },
    memory_probe: {
      executor: 'constant-arrival-rate',
      rate: 1,
      timeUnit: '30s',
      preAllocatedVUs: 1,
      duration: '10m',
      exec: 'probeMemory',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    heap_growth_exceeded: ['count<1'],
  },
};

// Capture baseline heap before load starts
export function setup() {
  const res = http.get(`${BASE_URL}/debug/memory`);
  if (res.status === 200) {
    return { initialHeap: res.json().heapUsed || 0 };
  }
  return { initialHeap: 0 };
}

export function workload() {
  http.get(`${BASE_URL}/health`);

  http.get(`${BASE_URL}/webhook/pending-replies`, { headers: authHeaders });

  http.post(
    `${BASE_URL}/webhook/reply`,
    JSON.stringify({
      message_id: `msg_soak_${__VU}_${__ITER}`,
      drafted_reply: 'Soak test reply',
    }),
    { headers: authHeaders },
  );

  sleep(1);
}

export function probeMemory(data) {
  const res = http.get(`${BASE_URL}/debug/memory`);
  check(res, { 'memory probe: status 200': (r) => r.status === 200 });
  if (res.status !== 200) return;

  const body = res.json();
  heapUsed.add(body.heapUsed);

  if (data.initialHeap > 0) {
    const growthMB = (body.heapUsed - data.initialHeap) / (1024 * 1024);
    if (growthMB > MAX_HEAP_GROWTH_MB) {
      heapGrowthExceeded.add(1);
    }
  }
}

export default function () {}
