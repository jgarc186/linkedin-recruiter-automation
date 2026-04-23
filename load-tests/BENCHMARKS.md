# Performance Benchmarks

Backend: Fastify 5 + better-sqlite3 (single-process, synchronous SQLite).  
Tool: [k6](https://k6.io) — install from https://k6.io/docs/get-started/installation/

## Prerequisites

1. Install k6 (standalone binary, not an npm package).
2. Start the backend server in a terminal:
   ```bash
   cd backend && npm run dev
   ```
3. Set your API key env var before running:
   ```bash
   export API_KEY=<value from backend/.env>
   ```

---

## Scenarios

### 1. Concurrent Requests (`concurrent-requests.js`)

Validates that the server handles sustained concurrent load without errors.

| Metric | Threshold | Measured |
|--------|-----------|---------|
| `http_req_duration{endpoint:health}` p95 | < 50 ms | — |
| `http_req_duration{endpoint:pending-replies}` p95 | < 200 ms | — |
| `http_req_duration{endpoint:reply}` p95 | < 200 ms | — |
| `http_req_failed` | < 1 % | — |

**Run:**
```bash
cd backend
npm run load-test:concurrent
```

**Profile:** 10 VUs → 50 VUs → 0 over ~4.5 minutes.

---

### 2. Database Locking (`database-locking.js`)

25 writers (POST `/webhook/message`) and 25 readers (GET `/webhook/pending-replies`) run
simultaneously. Validates the exclusive SQLite transaction in `getPendingReplies()` under contention.

| Metric | Threshold | Measured |
|--------|-----------|---------|
| `write_errors` (non-200/non-429) | < 5 % | — |
| `read_errors` | < 1 % | — |
| `double_deliveries` | 0 | — |

**Run:**
```bash
cd backend
npm run load-test:db
```

**Profile:** 50 constant VUs (25 writers + 25 readers) for 2 minutes.

---

### 3. Memory Leak Soak (`memory-leak.js`)

20 VUs cycle through all endpoints for 10 minutes. A probe VU samples
`/debug/memory` every 30 s and checks that heap growth stays under 50 MB.

| Metric | Threshold | Measured |
|--------|-----------|---------|
| `http_req_failed` | < 1 % | — |
| `heap_growth_exceeded` | 0 | — |
| `heap_used_bytes` p95 | — (informational) | — |

**Run:**
```bash
cd backend
npm run load-test:memory
```

**Profile:** 20 constant VUs for 10 minutes (~600 s).

> **Note:** The server must run with `NODE_ENV != production` (default for `npm run dev`)
> so that the `/debug/memory` endpoint is active.

---

### 4. Rate-Limit Spike (`rate-limit-spike.js`)

200 VUs simultaneously hit POST `/webhook/message` (limit: 10 req/min per API key).
Confirms the rate limiter activates and returns well-formed 429 responses.

| Metric | Threshold | Measured |
|--------|-----------|---------|
| `rate_limited` (fraction of 429 responses) | > 80 % | — |
| `retry_after_missing` (429s without `Retry-After` header) | 0 | — |
| `server_errors` (5xx responses) | < 1 % | — |

**Run:**
```bash
cd backend
npm run load-test:spike
```

**Profile:** 0 → 200 VUs in 10 s, hold 30 s, ramp down 10 s.

---

## Running all scenarios (except soak)

```bash
cd backend
npm run load-test:all
```

---

## Recording results

After running each scenario, paste the k6 summary output into the **Measured** column above.
Key lines to record: `p(95)` for durations, and final metric values for Rates and Counters.
