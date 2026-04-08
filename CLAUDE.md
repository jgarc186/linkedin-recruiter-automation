# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension that automates LinkedIn recruiter message handling with a Telegram approval workflow and Google Calendar integration. Monorepo with three workspaces managed by npm workspaces + Turborepo.

**Flow:** Extension content script detects recruiter messages on LinkedIn → sends to Fastify backend → backend analyzes and forwards to Telegram for user approval → user responds via Telegram buttons → backend drafts reply and schedules calendar → extension polls for pending replies and injects draft into LinkedIn messaging UI.

## Commands

```bash
# Install all dependencies (from root)
npm install

# Run all tests across workspaces
npm test

# Run tests with coverage
npm run test:coverage

# Run backend tests only
cd backend && npx vitest run

# Run extension tests only
cd extension && npx vitest run

# Run a single test file
cd backend && npx vitest run __tests__/server.test.ts

# Watch mode
cd backend && npx vitest
cd extension && npx vitest

# Start backend dev server (watches for changes)
cd backend && npm run dev

# Build all workspaces
npm run build
```

## Architecture

### Workspaces

- **`shared/`** — Shared TypeScript types and constants (no build step, imported directly via `types.ts`). Contains `MessageData`, `WebhookReplyPayload`, `UserCriteria`, and other interfaces used by both backend and extension.
- **`backend/`** — Fastify server (ESM, `"type": "module"`). Runs with `tsx`. Services: `analyzer.ts` (role matching), `telegram.ts` (Telegram bot), `calendar.ts` (Google Calendar). Database: SQLite via `better-sqlite3`. Routes in `src/routes/webhook.ts`.
- **`extension/`** — Chrome MV3 extension. `content.ts` (injected into LinkedIn messaging pages, detects recruiter messages via keyword matching, injects reply UI), `background.ts` (service worker: webhook sends with retry queue, polling for replies via alarms), `popup.ts`/`options.ts` (UI).

### Key Patterns

- Backend uses `createApp()` factory in `server.ts` for testability — tests import and build the app without starting the server.
- Extension background script uses named listener functions exported with `__test` prefix for testing (e.g., `__testOnAlarmHandler`).
- API auth via `X-API-Key` header with timing-safe comparison. Telegram webhook auth via `X-Telegram-Bot-Api-Secret-Token`.
- Extension uses `chrome.storage.local` for settings and pending send queue with TTL-based pruning.
- Shared types are imported via relative paths (`../../shared/types`) in source and via aliases (`@linkedin-plugin/shared`, `@shared`) in vitest configs.

### Testing

- Both workspaces use **Vitest** with globals enabled.
- Backend: `environment: 'node'`, coverage thresholds ~93-96%.
- Extension: `environment: 'jsdom'`, coverage thresholds 100%.
- Tests live in `__tests__/` directories in each workspace.
- Backend has both unit tests and integration tests (`integration.test.ts`, `database.integration.test.ts`) that test the full Fastify request lifecycle.

### Environment

Backend requires a `.env` file — see `backend/.env.example` for all required variables. Key vars: `EXTENSION_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`, `TELEGRAM_WEBHOOK_SECRET`, `EXTENSION_ID`, Google Calendar OAuth credentials.
