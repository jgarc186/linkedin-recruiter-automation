# LinkedIn Recruiter Automation

A Chrome extension that automates recruiter message handling on LinkedIn with Telegram approval workflow and Google Calendar integration.

## Features

- **🔍 Auto-Detection**: Identifies recruiter messages on LinkedIn
- **✅ Approval Workflow**: Sends messages to Telegram for your review
- **📅 Calendar Integration**: Auto-schedules meetings for approved opportunities
- **🎯 Smart Filtering**: Analyzes roles based on your criteria (Go/Rust, $200K+, etc.)
- **💬 Reply Drafting**: AI-drafted responses you approve before sending

## Architecture

```
Chrome Extension → Backend (Fastify) → Telegram Bot → Google Calendar
     ↓                                              ↓
  Detects                                    You approve
  recruiter                                  via Telegram
  messages                                   buttons
```

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/linkedin-recruiter-automation.git
cd linkedin-recruiter-automation

# Install backend dependencies
cd backend
npm install

# Install extension dependencies
cd ../extension
npm install
```

### 2. Configure Environment

**Backend** (`backend/.env`):
```env
# Telegram Bot (get from @BotFather)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_USER_ID=your_user_id

# Google Calendar (OAuth2 credentials)
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REFRESH_TOKEN=your_refresh_token

# Extension Auth
EXTENSION_API_KEY=your_secret_key

# Server
PORT=8000
HOST=127.0.0.1
```

**Extension** (`extension/.env`):
```env
WEBHOOK_URL=http://localhost:8000/webhook/message
API_KEY=your_secret_key
```

### 3. Start Backend

```bash
cd backend
npm run dev
```

### 4. Build & Load Extension

```bash
cd extension
npm run build
```

1. Open Chrome → `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `extension/dist/` folder (not `extension/` directly — Chrome rejects `__tests__/` directories)

### 5. Configure Extension

1. Click extension icon → "Settings"
2. Set your preferences:
   - Tech stack: Go, Rust
   - Min compensation: $200K+
   - Avoid: PHP, consulting

## Usage

1. **Receive recruiter message** on LinkedIn
2. **Get Telegram notification** with message preview
3. **Tap button**: ❌ Not interested | 🤔 Tell me more | ✅ Let's talk
4. **If "Let's talk"**: Calendar event auto-created
5. **Draft reply** injected into LinkedIn — you click "Send"

## Development

### Backend

```bash
cd backend
npm run test:coverage    # Run tests with coverage
npm run dev              # Start dev server
```

### Extension

```bash
cd extension
npm run test:coverage    # Run tests with coverage
npm run build            # Build for production
```

## Tech Stack

- **Extension**: TypeScript, Manifest V3, Vitest
- **Backend**: Fastify, TypeScript, Vitest
- **Bot**: Telegram Bot API
- **Calendar**: Google Calendar API
- **Database**: SQLite

## Testing

- **Total Tests**: 148
- **Coverage**: 97%+ overall
- **Backend**: 85 tests, 97% coverage
- **Extension**: 63 tests, 100% coverage

## Project Structure

```
linkedin-chrome-plugin/
├── extension/          # Chrome Extension
│   ├── src/
│   │   ├── content.ts      # LinkedIn page injection
│   │   ├── background.ts   # Service worker
│   │   ├── popup.ts       # Status popup
│   │   └── options.ts     # Settings page
│   └── __tests__/        # Extension tests
├── backend/            # Fastify API
│   ├── src/
│   │   ├── server.ts      # Fastify entry
│   │   ├── routes/
│   │   │   └── webhook.ts # Webhook handlers
│   │   └── services/
│   │       ├── telegram.ts  # Bot integration
│   │       ├── analyzer.ts  # Role analysis
│   │       └── calendar.ts  # Google Calendar
│   └── __tests__/        # Backend tests
├── shared/             # Shared types
└── PLAN.md            # Project plan
```

## Security

- API key authentication between extension and backend
- Local-only webhook server (localhost)
- No credentials stored in extension
- User approval required for all outgoing messages

## License

MIT