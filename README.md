# User Leaderboard System

A leaderboard system built with **NestJS**, **TypeScript**, **PostgreSQL**, and **Redis Sorted Sets**. Designed to handle 10M+ users with O(log N) rank lookups.

PostgreSQL is the source of truth. Redis ZSET is the serving index for all ranking operations. See [Design.md](Design.md) for architecture details and complexity analysis.

## Quick Start

### Docker Compose (recommended)

```bash
docker compose up --build -d
```

API runs at **http://localhost:3000**.

### Local Development

```bash
npm install
docker compose up postgres redis -d
npm run migration:run
npm run seed
npm run start:dev
```

### Rebuild Redis from Postgres

```bash
npm run redis:rebuild
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/users` | Create a user (optional `score`) |
| `PATCH` | `/users/:id/score` | Set a user's score |
| `GET` | `/leaderboard/top?limit=N` | Top N users (default 100, max 1000) |
| `GET` | `/leaderboard/user/:id` | User rank + 5 above / 5 below |
| `GET` | `/health` | Health check (DB + Redis) |

### Examples

```bash
# Create user
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"name": "Alice", "imageUrl": "https://example.com/alice.png", "score": 1500}'

# Update score
curl -X PATCH http://localhost:3000/users/1/score \
  -H 'Content-Type: application/json' \
  -d '{"score": 2500}'

# Top 10
curl http://localhost:3000/leaderboard/top?limit=10

# User rank + neighbors
curl http://localhost:3000/leaderboard/user/1

# Health
curl http://localhost:3000/health
```

## Testing

### Prerequisites

Both unit and E2E tests use **Jest**. E2E tests also use **Supertest** and require running PostgreSQL and Redis instances.

### Unit Tests

Unit tests mock all external dependencies (database, Redis) and run in isolation. No infrastructure needed.

```bash
npm test
```

To run with coverage:

```bash
npm run test:cov
```

### E2E Tests

E2E tests hit the real API against real PostgreSQL and Redis instances. Start the infrastructure first:

```bash
# 1. Start Postgres and Redis
docker compose up postgres redis -d

# 2. Run database migrations
npm run migration:run

# 3. Run E2E tests
npm run test:e2e
```

### What's Covered

| Category | Scope | Examples |
|----------|-------|---------|
| User creation | Unit + E2E | Valid user, with score, score 0, missing fields, extra fields, large IDs |
| Score update | Unit + E2E | Valid update, score 0, large scores, negative/non-integer rejection, 404, concurrent updates |
| Redis resilience | Unit | ZADD failure, cache invalidation failure — DB operations still succeed |
| Top N | Unit + E2E | Correct ordering, tie-breaking (score DESC id ASC), limit clamping, default limit, empty leaderboard, DB out-of-order merge, 10M total simulation |
| User rank + neighbors | Unit + E2E | Full neighbors, rank 1 (no above), last rank (no below), single user, tied scores, missing DB entries, self-heal from ZSET, 10M-position simulation |
| Cache | Unit | Cache hit, cache miss + store, TTL, invalidation on writes |
| Utilities | Unit | Pad-id roundtrip, inversion ordering, 1000-id sort, clamp boundaries |
| Health | E2E | DB + Redis connectivity |

## Kubernetes

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/migration-job.yaml
kubectl apply -f k8s/api-deployment.yaml
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `leaderboard` | PostgreSQL user |
| `DB_PASSWORD` | `leaderboard_secret` | PostgreSQL password |
| `DB_DATABASE` | `leaderboard` | PostgreSQL database |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `LEADERBOARD_ZSET_KEY` | `leaderboard:zset` | Redis ZSET key |
| `DEFAULT_TOP_LIMIT` | `100` | Default top-N limit |
| `MAX_TOP_LIMIT` | `1000` | Maximum top-N limit |
| `TOP_CACHE_TTL_SECONDS` | `10` | Top-N payload cache TTL |
| `LEADERBOARD_NEIGHBOR_COUNT` | `5` | Neighbors above/below |
| `SEED_COUNT` | `100` | Users created by seed script |
