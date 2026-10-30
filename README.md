# Tonic Rails

**Payment rails for moving stablecoins across borders.** Tonic Rails is the backend for a multi-currency wallet sandbox. Wallets hold five stablecoins (cNGN, cGHS, cXAF, USDx, EURx), take simulated deposits, swap between coins at live FX rates, and send money to other wallets, converting automatically when the currencies differ. Every movement is recorded in a double-entry ledger that the database itself keeps honest.

> Cardtonic Backend Assessment: *Operation Borderless*. The full design (decisions, trade-offs, diagrams) is in [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md). The API spec is [docs/openapi.json](docs/openapi.json), also served live at `/docs`.

---

## Contents

- [Quick start](#quick-start)
- [Tech stack and why PostgreSQL](#tech-stack-and-why-postgresql)
- [Running the tests](#running-the-tests)
- [API walkthrough](#api-walkthrough)
- [Data model](#data-model)
- [How the hard parts are handled](#how-the-hard-parts-are-handled)
  - [Money precision](#money-precision) · [Idempotency](#idempotency) · [Concurrency](#concurrency) · [FX rate failures](#fx-rate-failures)
- [Assumptions](#assumptions)
- [Known limitations and what I left out](#known-limitations-and-what-i-left-out)
- [With more time](#with-more-time)
- [Project layout and scripts](#project-layout-and-scripts)

---

## Quick start

```bash
docker compose up --build
```

That one command starts PostgreSQL 16, Redis 7 and the API. **Migrations and seed data run automatically** when the API boots: the schema, the five currencies, the two system ledger accounts and the static FX fallback table. No extra step is needed.

| What | Where |
|---|---|
| API base URL | `http://127.0.0.1:9000/api/v1` |
| Swagger UI | `http://127.0.0.1:9000/docs` |
| OpenAPI JSON | `http://127.0.0.1:9000/docs-json` (committed copy: `docs/openapi.json`) |
| Health | `GET /health/live`, `GET /health/ready` |

> **If `localhost:9000` resets the connection on Windows,** use `127.0.0.1:9000`. `localhost` tries IPv6 `::1` first, and a leftover WSL port relay (`wslrelay`) can be holding `[::1]:9000`. Check with `Get-NetTCPConnection -LocalPort 9000`.

**Without Docker for the API** (Postgres and Redis still need to be running):

```bash
cp .env.example .env    # DB_HOST=localhost, REDIS_HOST=localhost
yarn install
yarn start:dev          # migrations run on boot; or: yarn migration:run
```

Configuration is validated at boot (Joi), so a missing or malformed variable stops the app with a clear message. Every variable is documented in [.env.example](.env.example). Set `FX_PROVIDER=static` to run fully offline.

---

## Tech stack and why PostgreSQL

| Area | Choice |
|---|---|
| Language / runtime | TypeScript (`strict: true`), Node.js 22 LTS |
| Framework | NestJS 11 |
| Database | PostgreSQL 16 via TypeORM 0.3 (hand-written migrations) |
| Cache / locks | Redis 7 via `ioredis`. Optional: the API keeps working without it |
| Validation & docs | Zod (`nestjs-zod`), one schema for runtime validation, TS types and OpenAPI |
| Money maths | `decimal.js` |
| Logging | `nestjs-pino`, structured JSON, request IDs, PII redaction |
| Tests | Jest + Supertest + Testcontainers + fast-check |
| Tooling | Yarn 1, ESLint, Prettier, husky + commitlint (conventional commits) |

**Why PostgreSQL.** A wallet ledger is relational data with hard consistency requirements, and Postgres can enforce those requirements itself rather than leaving them all to application code:

- **ACID multi-row transactions.** A transfer touches up to four balance rows, a transaction row, the ledger entries and an idempotency record, and they commit or roll back together.
- **Row-level locks** (`SELECT … FOR UPDATE`) let concurrent requests on the same balance queue instead of racing.
- **`CHECK (allow_negative OR available >= 0)`** means even buggy code cannot overdraw a user wallet. The database refuses the commit.
- **Exact `NUMERIC`** arithmetic, so `available - 10.2` in SQL is exact.
- **Partial unique indexes and `citext`** make "one wallet per email or phone, case-insensitive" a database guarantee that also holds under concurrent sign-ups.

A document store could model wallets, but atomic multi-document updates, database-enforced invariants and row locking are exactly what this problem needs, and Postgres provides them natively.

**Where Redis earns its place:** a shared FX-rate cache, so N API replicas don't each call the rate provider, and a lock so only one replica runs the background rate refresh. It is never needed for correctness: if Redis is down, every Redis call degrades to a cache miss. That is also why rate limiting is in-memory, since a Redis-backed limiter would take the whole API down with Redis. **No queue** (BullMQ/RabbitMQ): every operation settles synchronously, so a queue would only add failure modes.

---

## Running the tests

```bash
yarn install
yarn test            # unit + e2e, the full suite (169 tests)
yarn test:cov        # same, with coverage (~93% lines)
```

**Requirement: Docker.** The e2e tests run against a **real PostgreSQL** that Testcontainers starts and throws away automatically. No setup is needed beyond a running Docker daemon. Testing against Postgres rather than mocks is deliberate, because the guarantees under test (row locks, `CHECK` constraints, unique indexes) live in the database.

Alternatives:

```bash
# Use an existing Postgres instead of Testcontainers (the database name must end in _test; it is reset)
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=postgres TEST_DB_PASSWORD=postgres TEST_DB_NAME=tonicrails_test yarn test

# No Node.js locally: run the suite inside the compose network
docker compose --profile test run --rm test
```

Other commands: `yarn test:unit` (fast, no Docker), `yarn test:e2e`, `yarn lint`, `yarn typecheck`. Suites run in band because they share one migrated database. The concurrency tests generate their parallelism *inside* each test.

**What is covered**

| Suite | Proves |
|---|---|
| `wallets` | Email/phone XOR, E.164 + case-insensitive uniqueness, 15 racing creates produce exactly one wallet |
| `money-movement` | Deposits, swaps, transfers (same and cross currency), exact 6-dp arithmetic, round-down, limits, every validation error |
| `idempotency` | Replay with `Idempotent-Replayed: true`, key reuse with a different body is rejected, failures replay, **10 concurrent identical requests execute once** |
| `concurrency` | **50 parallel swaps against a balance that covers 10 → exactly 10 succeed, balance ends at 0**; 60 opposing transfers produce no deadlocks; fan-in loses nothing |
| `history` | Newest first, sent and received, filters, cursor pagination without gaps or duplicates |
| `fx` | Live rates, failing provider falls back to last-known-good, then to static |
| `ledger-invariants` | **Property-based** (fast-check): random operation sequences never break double entry, balance = ledger, or non-negativity |
| `error-messages` | The client-facing error contract: exact code **and** message for every validation and business failure, 415 for non-JSON bodies, canonical balance order, `rate` on every transaction |
| `openapi-examples` | Replays the request examples in `docs/openapi.json` in order, so Swagger's "Try it out" works on the first click |
| unit | Money maths, posting templates, FX resolution chain (retry, circuit breaker, single-flight, corrupt-cache tolerance, minimum convertible amount), provider parsing, exception filter mappings (429, 503, hidden 500 details), cursors, hashing |

After every e2e test, a SQL check asserts that the ledger nets to zero per currency, that every balance equals the sum of its ledger entries, and that no user balance is negative.

---

## API walkthrough

All amounts are **decimal strings** (up to 6 decimal places). Successful responses use `{ "message", "data" }`, plus `meta` on lists. The examples below use the static rate table (`FX_PROVIDER=static`: 1 USD = 1500 NGN = 15 GHS = 0.92 EUR = 603.48044 XAF) so the numbers are reproducible. With the default live provider, the rates are real.

### 1. Create wallets

Exactly one of `email` or `phone`. Emails are case-insensitive. Phones are normalised to E.164: local format is read as Nigerian, so use `+233…`, `+237…` and so on for other countries.

```bash
curl -X POST http://127.0.0.1:9000/api/v1/wallets \
  -H 'content-type: application/json' -d '{"email":"ama@example.com"}'
```
```json
201 Created
{
  "message": "Wallet created",
  "data": {
    "id": "6b0f4c1e-2a8d-4f3e-9b71-0c5d2e8a4f10",
    "email": "ama@example.com",
    "phone": null,
    "createdAt": "2026-10-29T10:15:02.123Z",
    "balances": [
      { "currency": "cNGN", "available": "0" }, { "currency": "cGHS", "available": "0" },
      { "currency": "cXAF", "available": "0" }, { "currency": "USDx", "available": "0" },
      { "currency": "EURx", "available": "0" }
    ]
  }
}
```

A second wallet with `AMA@example.com` returns `409 WALLET_ALREADY_EXISTS`.

### 2. Deposit (simulated)

Every money-moving `POST` needs an **`Idempotency-Key`** header (8–128 chars, UUID recommended).

```bash
curl -X POST http://127.0.0.1:9000/api/v1/wallets/$WALLET/deposits \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"currency":"cNGN","amount":"150000"}'
```
```json
201 Created
{
  "message": "Deposit completed",
  "data": {
    "id": "0e9b…", "reference": "TR-20261029-7F3K9QAB",
    "type": "DEPOSIT", "status": "COMPLETED", "walletId": "6b0f…",
    "source":      { "currency": "cNGN", "amount": "150000" },
    "destination": { "currency": "cNGN", "amount": "150000" },
    "rate": "1", "fx": null, "sender": null, "receiver": null, "note": null,
    "createdAt": "2026-10-29T10:16:40.501Z"
  }
}
```

### 3. Swap

```bash
curl -X POST http://127.0.0.1:9000/api/v1/wallets/$WALLET/swaps \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"fromCurrency":"cNGN","toCurrency":"USDx","amount":"15300"}'
```
```json
201 Created
{
  "message": "Swap completed",
  "data": {
    "type": "SWAP",
    "source":      { "currency": "cNGN", "amount": "15300" },
    "destination": { "currency": "USDx", "amount": "10.2" },
    "rate": "0.000666666666666666",
    "fx": { "rate": "0.000666666666666666", "source": "STATIC",
            "snapshotId": "00000000-0000-4000-8000-0000000000f1" },
    "…": "…"
  }
}
```

Swapping more than you hold:

```json
422 Unprocessable Entity
{
  "statusCode": 422, "code": "INSUFFICIENT_FUNDS",
  "message": "Insufficient cNGN balance: available 134700, required 999999",
  "details": { "currency": "cNGN", "available": "134700", "required": "999999" },
  "path": "/api/v1/wallets/6b0f…/swaps", "requestId": "c3a1…", "timestamp": "…"
}
```

### 4. Transfer (auto-converts when currencies differ)

The recipient can be given by `walletId`, `email` or `phone`. `destinationCurrency` defaults to `sourceCurrency`.

```bash
curl -X POST http://127.0.0.1:9000/api/v1/wallets/$WALLET/transfers \
  -H 'content-type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"recipient":{"phone":"+233241234567"},"sourceCurrency":"cNGN",
       "destinationCurrency":"cGHS","amount":"50000","note":"School fees"}'
```
```json
201 Created
{
  "message": "Transfer completed",
  "data": {
    "type": "TRANSFER", "walletId": "6b0f…",
    "sender":   { "walletId": "6b0f…", "identifier": "a**@example.com" },
    "receiver": { "walletId": "91c2…", "identifier": "+233*****4567" },
    "source":      { "currency": "cNGN", "amount": "50000" },
    "destination": { "currency": "cGHS", "amount": "500" },
    "rate": "0.01",
    "fx": { "rate": "0.01", "source": "STATIC", "snapshotId": "00000000-…-0000000000f1" },
    "note": "School fees",
    "createdAt": "2026-10-29T10:18:05.214Z"
  }
}
```

This records every field the brief asks for: sender, receiver, source amount and currency, destination amount and currency, the rate applied, and a timestamp.

### 5. Balances with USD total

```bash
curl http://127.0.0.1:9000/api/v1/wallets/$WALLET/balances
```
```json
{
  "message": "Balances fetched",
  "data": {
    "walletId": "6b0f…",
    "balances": [
      { "currency": "cNGN", "available": "84700", "usdValue": "56.466666" },
      { "currency": "USDx", "available": "10.2",  "usdValue": "10.2" },
      { "currency": "cGHS", "available": "0", "usdValue": "0" }, "…"
    ],
    "totalUsd": "66.666666",
    "rates": { "source": "STATIC", "refreshedAt": "…", "isStale": true }
  }
}
```

All balances are valued against **one** rate snapshot, so the total is internally consistent.

### 6. History and single transaction

```bash
curl 'http://127.0.0.1:9000/api/v1/wallets/$WALLET/transactions?type=TRANSFER&currency=cNGN&limit=20'
curl 'http://127.0.0.1:9000/api/v1/wallets/$WALLET/transactions?cursor=<meta.nextCursor>'
curl  http://127.0.0.1:9000/api/v1/transactions/TR-20261029-7F3K9QAB   # by reference or UUID
```

- **Newest first**, keyset-paginated: `meta: { limit, hasMore, nextCursor }`. Pages stay stable while new transactions arrive.
- Includes transfers the wallet **received**. Each item has `direction`: `IN`, `OUT` or `SELF` (swap), relative to the wallet being listed.
- Filters: `type` (`DEPOSIT|SWAP|TRANSFER`), `currency` (matches the source **or** destination leg), `from`/`to` (a date such as `2026-10-29`, where a date-only `to` includes that whole day, or a full ISO date-time), `limit` (1–100, default 20).

### 7. Current FX rates

```bash
curl http://127.0.0.1:9000/api/v1/fx/rates
```
```json
{
  "message": "Rates fetched",
  "data": {
    "base": "USDx", "source": "LIVE", "provider": "open.er-api.com",
    "refreshedAt": "2026-10-29T17:48:56.819Z", "providerUpdatedAt": "2026-10-29T00:02:31.000Z",
    "isStale": false,
    "rates": [
      { "from": "cNGN", "to": "cGHS", "rate": "0.008646261370309442", "refreshedAt": "2026-10-29T17:48:56.819Z" },
      { "from": "cNGN", "to": "USDx", "rate": "0.00074281132014264",  "refreshedAt": "2026-10-29T17:48:56.819Z" },
      "… all 20 ordered pairs …"
    ]
  }
}
```

### Errors

Every error has one shape: `{ statusCode, code, message, details?, path, requestId, timestamp }`. Clients branch on `code`. `message` says exactly what went wrong and how to fix it, and `details` carries the machine-readable specifics.

```json
400 Bad Request
{
  "statusCode": 400, "code": "VALIDATION_FAILED",
  "message": "Validation failed: amount: must be a string such as \"1500.25\", not a number; send amounts as strings to avoid floating-point rounding",
  "details": { "issues": [ { "path": "amount", "message": "must be a string such as \"1500.25\", not a number; …" } ] },
  "path": "/api/v1/wallets/6b0f…/swaps", "requestId": "c3a1…", "timestamp": "…"
}
```

| Code | HTTP | When | Example message |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | Body or query fails validation; **every** issue is listed | `Validation failed: fromCurrency: is required; amount: must have at most 6 decimal places, got 7` |
| `INVALID_JSON` | 400 | Body is not parseable JSON | `Request body is not valid JSON` |
| `INVALID_ID` | 400 | Wallet id in the path is not a UUID | `Wallet id must be a valid UUID` |
| `INVALID_PHONE` | 400 | Phone cannot be parsed | `Phone number is not valid. Numbers without a country code are read as Nigerian; …` |
| `INVALID_CURSOR` | 400 | Tampered pagination cursor | `Pagination cursor is not valid; pass meta.nextCursor …` |
| `IDEMPOTENCY_KEY_REQUIRED` / `_INVALID` | 400 | Header missing / wrong format | `Idempotency-Key header is required for deposits, swaps and transfers` |
| `SAME_CURRENCY_SWAP` | 400 | Swap into the same coin | `fromCurrency and toCurrency must be different` |
| `SELF_TRANSFER_NOT_ALLOWED` | 400 | Recipient is the sender | `A wallet cannot transfer to itself; use a swap to change currency` |
| `BAD_REQUEST` | 400 | Other malformed requests (e.g. a broken `%` escape in the URL) | framework message |
| `WALLET_NOT_FOUND` / `RECIPIENT_NOT_FOUND` / `TRANSACTION_NOT_FOUND` | 404 | Unknown id (system ledger accounts are never exposed) | `Recipient wallet not found` |
| `ROUTE_NOT_FOUND` | 404 | No such route | `Cannot DELETE /api/v1/wallets/…` |
| `WALLET_ALREADY_EXISTS` | 409 | Email/phone already has a wallet | `A wallet already exists for this email or phone` |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 | Same key still processing after 5 s | `… is still being processed; retry shortly` |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 100 kb | `Request body is too large (limit 100kb)` |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Body sent without `Content-Type: application/json` | `Content-Type must be application/json` |
| `INSUFFICIENT_FUNDS` | 422 | Debit larger than the balance | `Insufficient cNGN balance: available 1000, required 5000` |
| `AMOUNT_TOO_SMALL` | 422 | Conversion would round to zero; `details.minimumAmount` gives the smallest that works | `0.000001 cNGN converts to less than 0.000001 USDx; the minimum is 0.0015 cNGN` |
| `AMOUNT_LIMIT_EXCEEDED` | 422 | Over the per-transaction USD cap | `Amount is worth 2000000 USD, above the 1000000 USD limit per transaction` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different body | `This Idempotency-Key was already used with a different request body; …` |
| `IDEMPOTENCY_KEY_EXPIRED` | 422 | Key already executed and its stored result was purged (it is **never** re-executed) | `… its stored result has expired; use a new key for a new request` |
| `RATE_LIMITED` | 429 | Over the per-IP request rate | `Too many requests; slow down and retry shortly` |
| `INTERNAL_ERROR` | 500 | Unexpected failure; stack and reason are logged, never returned | `Internal server error` |
| `SERVICE_UNAVAILABLE` | 503 | Database unreachable; safe to retry | `Service temporarily unavailable; please retry` |

---|---|
| `VALIDATION_FAILED` (with every issue in `details.issues`), `INVALID_ID`, `INVALID_PHONE`, `INVALID_CURSOR`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`, `SAME_CURRENCY_SWAP`, `SELF_TRANSFER_NOT_ALLOWED`, `BAD_REQUEST` | 400 |
| `WALLET_NOT_FOUND`, `RECIPIENT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `ROUTE_NOT_FOUND` | 404 |
| `WALLET_ALREADY_EXISTS`, `IDEMPOTENCY_REQUEST_IN_PROGRESS` | 409 |
| `PAYLOAD_TOO_LARGE` | 413 |
| `INSUFFICIENT_FUNDS`, `AMOUNT_TOO_SMALL`, `AMOUNT_LIMIT_EXCEEDED`, `IDEMPOTENCY_KEY_REUSED` | 422 |
| `RATE_LIMITED` | 429 |
| `INTERNAL_ERROR` (stack logged, never returned) | 500 |

---

## Data model

```
currencies ──< balances >── wallets ──< transactions >── fx_rate_snapshots
                   │                        │
                   └──────< ledger_entries >┘          idempotency_keys
```

| Table | Purpose | Key constraints |
|---|---|---|
| `currencies` | The 5 coins, ISO peg, decimals (6) | PK `code` |
| `wallets` | `USER` wallets (email **or** phone) and 2 `SYSTEM` accounts | `CHECK` exactly one identifier; partial unique indexes on `email` (citext) and `phone` |
| `balances` | One row per (wallet, coin), a projection of the ledger | PK (wallet, currency); `CHECK (allow_negative OR available >= 0)` |
| `transactions` | Business record of a deposit/swap/transfer: sender, receiver, both legs, rate, snapshot, note | `CHECK` positive amounts; transfer ⇔ counterparty; no self-transfer; unique (wallet, type, idempotency key) |
| `ledger_entries` | Append-only double-entry postings with `balance_after` | `CHECK amount > 0`; a **trigger rejects UPDATE/DELETE** |
| `fx_rate_snapshots` | Every rate set used (live fetches + the static table) | Referenced by transactions, so every conversion is auditable |
| `idempotency_keys` | Stored request hash + response per (scope, key) | PK (scope, key) |

**System accounts.** `DEPOSIT_FUNDING` is the other side of every simulated deposit: its balance goes negative by the total money that "entered" the sandbox. `FX_POOL` is the counterparty to every conversion. A swap of cNGN to USDx is four entries: wallet cNGN debit → pool cNGN credit, then pool USDx debit → wallet USDx credit. Each transaction's entries net to zero per currency, so money can't appear or vanish.

---

## How the hard parts are handled

### Money precision

- **6 decimal places for every coin**, the on-chain convention for stablecoins (USDC/USDT). The same scale is used in the database (`NUMERIC(30,6)`), in code and in responses, so the balance a client sees is exactly what the ledger holds.
- **No floating point anywhere on the money path.** Amounts are `decimal.js` values (precision 40, `ROUND_DOWN` by default). TypeORM column transformers convert `NUMERIC` strings straight to `Decimal`, and a lint rule bans `parseFloat`.
- **Amounts must be strings in requests.** A JSON number like `1500.1` is already inexact before it reaches the server, so it is rejected (`400`), as are more than 6 decimals, zero, negatives and exponent notation. Input is never rounded silently.
- **Conversions round down, once.** `destination = floor6(amount × usd(to) / usd(from))`, evaluated as a single expression. Rounding the rate first would turn 15300 cNGN at 1500/USD into 10.199999 instead of 10.2. The sub-micro-unit remainder stays in `FX_POOL`, so the platform never credits more than it debited. Anything that converts to `0` is rejected with `AMOUNT_TOO_SMALL`.
- The 18-dp `fx_rate` on each transaction is for display. The exact inputs are stored via `fx_snapshot_id`, so any conversion can be recomputed to the micro-unit.

### Idempotency

- `Idempotency-Key` is **required** on deposits, swaps and transfers, scoped per `(wallet, operation)`.
- The key is **claimed inside the same database transaction that moves the money** (`INSERT … ON CONFLICT DO NOTHING`). They commit together or roll back together, so there is no state where money moved but the key wasn't recorded, or the reverse.
- **Same key, same body:** returns the original status and body with `Idempotent-Replayed: true`. Field order doesn't matter (canonical JSON hash).
- **Same key, different body:** `422 IDEMPOTENCY_KEY_REUSED`.
- **Same key while the first is in flight:** the second request waits on the unique index, then replays the first one's response. It gets `409` only if that takes longer than 5 s. Tested with 10 identical concurrent transfers → 1 execution, 9 replays.
- **Deterministic failures replay too.** If a swap failed with `INSUFFICIENT_FUNDS`, retrying with the same key returns the same `422` even after a top-up (Stripe semantics). A new key means a new request.
- Stored responses are purged after 24 h, but a permanent unique index on `transactions (wallet_id, type, idempotency_key)` means **a key can never execute twice**, even after its stored response is purged.
- Wallet creation is idempotent by nature: the identifier is unique (`409` on repeat).

### Concurrency

Three independent layers, any one of which would prevent a double-spend:

1. **Row locks in one global order.** User balance rows are locked `FOR UPDATE` sorted by `(wallet_id, currency)`, and system rows are updated last in the same fixed order. Every transaction acquires locks in the same order, so deadlocks are impossible by construction. (A bounded retry on `40P01`/`40001` exists anyway.)
2. **Conditional atomic update:** `UPDATE balances SET available = available - $x WHERE … AND available >= $x`. The check and the write are one statement.
3. **Database `CHECK (allow_negative OR available >= 0)`.** If the code regressed, Postgres would still refuse the overdraft.

Proven by tests: 50 parallel swaps against funds for 10 → exactly 10 succeed and the balance ends at exactly `0`; 60 opposing A↔B transfers mixing same- and cross-currency legs → all succeed, no deadlocks, value conserved.

FX lookups and recipient resolution happen **before** the database transaction opens, so no network call is ever made while holding row locks.

### FX rate failures

Live rates come from **open.er-api.com** (free, no key, quotes NGN/GHS/XAF/EUR against USD). Cross rates are derived through USD. The resolution chain:

```
1. in-process memo → Redis (shared, 60 s TTL)
2. live provider: 3 s timeout, 1 retry with jitter, circuit breaker (opens for 60 s after 3 failed fetches),
                  response schema-validated (all 5 ISO codes, positive, USD-based); persisted as a snapshot
3. last-known-good live snapshot from Postgres, if younger than 24 h   → source: LAST_KNOWN_GOOD, isStale: true
4. static rate table (seeded by migration)                            → source: STATIC
```

- A background job refreshes rates every 5 minutes, so user requests normally hit the cache. A Redis lock ensures only one replica refreshes.
- Concurrent cache misses share **one** in-flight provider call (single-flight), so an outage doesn't cause a thundering herd.
- **Money keeps moving when the provider is down**, and every rate response and every transaction says which source priced it (`LIVE`, `LAST_KNOWN_GOOD`, `STATIC`) and when the rates were fetched.
- Each operation uses exactly one snapshot for its limit check, rate and amount, so they can never disagree.

---

## Assumptions

- Each stablecoin is pegged 1:1 to its fiat (cNGN↔NGN, cGHS↔GHS, cXAF↔XAF, USDx↔USD, EURx↔EUR), so fiat FX rates price the coins.
- Rates are mid-market with no spread or fees.
- Deposits are simulated and final immediately. There is no pending state.
- A wallet is identified by exactly one of email or phone, chosen at creation. Phone numbers without a country code are read as Nigerian.
- No authentication was required by the brief. Wallet ids are unguessable UUIDs, but that is **not** a security boundary.
- A single transaction is capped at the equivalent of 1,000,000 USD (`MAX_TRANSACTION_AMOUNT_USD`) as a fat-finger guard.

## Known limitations and what I left out

| Left out | Why |
|---|---|
| Authentication / authorization | Explicitly out of scope in the brief. With it in place, the per-wallet ownership checks would sit in a guard in front of the existing services. |
| Withdrawals, reversals, refunds | Not requested. The ledger supports them as compensating transactions. |
| Fees / FX spread | Not requested. Would be one extra posting to a `FEES` system account. |
| KYC tiers, velocity limits, AML hooks | Outside a sandbox's scope. |
| Webhooks / events | Nothing consumes them yet. Would come with a transactional outbox (where a queue earns its place). |
| Rate-locked quotes (`POST /fx/quotes`) | Designed (doc §11.3), cut for time. Today each request prices against the current snapshot. |

Other limitations:
- `FX_POOL` is a hot row: conversions in the same currency serialise on it. That's fine at sandbox scale. Sharding the pool would remove it (see below).
- Rate limiting is per instance (in-memory), so N replicas allow up to N× the limit.
- One fixed scale (6 dp) for all coins. 18-dp tokens would need per-currency scales.
- No `UPDATE`/`DELETE` privileges are revoked at the database-role level. Append-only is enforced by a trigger instead.

## With more time

1. **Auth:** API keys per wallet or OTP-verified sessions issuing short-lived JWTs, plus request signing on money endpoints.
2. **Quotes:** `POST /fx/quotes` returning a rate locked for 30 s, which a swap can redeem (`410 QUOTE_EXPIRED` after that). This is how real remittance apps price.
3. **Scale:** shard `FX_POOL` into N sub-accounts, partition `ledger_entries` by month, read replicas for history.
4. **Operations:** OpenTelemetry traces, Prometheus metrics (transactions by type, FX source mix, replay rate, lock waits), and a scheduled reconciliation job that alerts on any ledger/balance drift (the e2e checks already implement this query).
5. **Product:** withdrawals, transaction limits per KYC tier, a configurable FX spread booked to a revenue account, webhooks via an outbox.
6. **CI:** GitHub Actions running lint, typecheck and the full suite against a Postgres service container.

---

## Project layout and scripts

```
src/
  module/        wallet · transaction · ledger · idempotency · fx · health
  shared/
    config/      env (Joi + typed AppConfig) · db · cache (Redis) · fx (provider wiring)
    global/      constants · enums · errors (+ global filter) · model (entities, repositories) · schemas (Zod + DTOs)
    util/        money · db · pg-error · hash · cursor · identity · reference · circuit-breaker · FX providers
  migrations/    hand-written schema + reference data
test/            e2e suites + Testcontainers setup
docs/            TECHNICAL_DESIGN.md · openapi.json
```

| Script | Does |
|---|---|
| `yarn start:dev` | Run with watch mode |
| `yarn build` / `yarn start:prod` | Compile / run compiled |
| `yarn test` / `test:unit` / `test:e2e` / `test:cov` | Tests |
| `yarn lint` / `yarn typecheck` / `yarn format` | Static checks |
| `yarn migration:run` / `migration:revert` / `migration:show` | Migrations via the TypeORM CLI |
| `yarn openapi:generate` | Regenerate `docs/openapi.json` (no database needed) |

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint on `commit-msg`; lint-staged runs Prettier and ESLint on `pre-commit`).
