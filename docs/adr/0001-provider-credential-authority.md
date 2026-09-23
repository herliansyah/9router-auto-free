# Provider Credential Authority & Auto-Sync Scope

9router Core is the sole authority for provider credential management (OAuth flows, API keys, endpoints, connection lifecycle). 9router-auto-free does not implement provider CRUD and acts strictly as a read-only consumer and Auto-Sync filter.

## Context

Originally, `9router-auto-free` had a partial "Tambah Provider" form writing directly into 9router's SQLite `providerConnections`. This created an architectural mismatch:
1. OAuth providers (e.g. Kilo, Antigravity) require complex browser authorization, token exchange, and automatic refresh tokens managed by 9router Core daemon; writing raw static keys bypassed this lifecycle and caused silent credential failures.
2. Duplicating credential editing and deletion in the companion tool created two unsynchronized sources of truth and state drift.

## Decision

We removed credential creation and editing from `9router-auto-free`.
- **9router Core**: Manages all provider installations, OAuth logins (`9router login`), API keys, base URLs, and connection deletions.
- **9router-auto-free**: Discovers free models from active connections in SQLite (`providerConnections WHERE isActive = 1`) plus account-free public sources (OpenAgentic web, OpenCode).
- **User Control**: Restricted exclusively to toggling **Auto-Sync (Enabled / Disabled)** per provider in `custom-providers.json`, controlling whether discovered models are evaluated and written to `combos`.
