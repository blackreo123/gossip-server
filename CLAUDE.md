# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"임귀당귀" (gossip-server) — an anonymous gossip/complaint sharing server for an iOS app. Users submit short messages (max 50 chars) that display one-at-a-time to all connected clients for 10 seconds each, then auto-delete. Korean-language app.

## Commands

- `npm start` — run production server (`node server.js`)
- `npm run dev` — run with auto-reload (`nodemon server.js`)
- Server runs on `PORT` env var or 3000 by default

## Architecture

Single-file Express + Socket.IO server (`server.js`). All data is in-memory (no database) — restarting the server clears all state.

**Data stores (all in-memory):**
- `gossipQueue` — FIFO queue of pending messages
- `activeGossip` — the single message currently being displayed
- `userUsage` — daily per-device submission counts (keyed by `deviceId-dateString`, cleared at midnight)
- `reportQueue` — abuse reports (auto-cleaned after 7 days)
- `bannedUsers` — globally banned device IDs (auto-ban on serious violations)
- `userBlocks` — per-user block lists (`Map<deviceId, Set<blockedDeviceId>>`)

**Key flow:** POST `/api/gossip` → content filter → daily limit check (10/day) → enqueue → if nothing displaying, `processNextGossip()` → Socket.IO broadcasts message for 10s countdown → auto-deletes → next in queue.

**API endpoints:**
- `POST /api/gossip` — submit a message (content + deviceId)
- `POST /api/report` — report abusive content
- `POST /api/block` — block another user (per-device)
- `GET /api/usage/:deviceId` — check daily usage
- `GET /api/admin/reports` — view recent reports (no auth)
- `GET /` — server status

**Socket.IO events (server→client):** `current-state`, `new-gossip`, `gossip-display`, `countdown`

## Notable Details

- Content filtering uses a Korean banned-word list and regex patterns for PII (phone numbers, URLs, messenger names)
- `isSeriosViolation` (typo in original) handles auto-banning logic
- `userBlocks` map is populated but never checked when delivering messages — blocking is stored but not yet enforced in display logic
- Admin reports endpoint has no authentication
