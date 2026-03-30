# Labric Sync

Desktop file sync client built with Tauri, React, and Rust. Monitors a local folder and automatically uploads changes to the Labric platform.

## Features

- **Real-time file watching** - Detects created, modified, and deleted files
- **Batched uploads** - Queues changes and uploads concurrently with retry logic
- **Device heartbeat** - Reports device status and app version to the server
- **Pattern-based ignoring** - Configure file patterns to exclude from sync
- **Auto-updates** - Built-in updater via Tauri plugin

## Tech Stack

- **Frontend:** React 18, TypeScript, TanStack Router, Tailwind CSS, shadcn/ui
- **Backend:** Rust, Tauri 2, tokio, notify (file watcher), reqwest (HTTP)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Setup

```bash
pnpm install
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```
