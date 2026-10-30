# Auction App

A multi-seller timed-auction web app. See [docs/DESIGN.md](docs/DESIGN.md) for the design and build order.

## Requirements

- Node 24 and Docker Desktop
- Yarn 4 via Corepack: `corepack enable` (if that needs root, use `corepack enable --install-directory ~/.local/bin`)

## Setup

```sh
yarn install
cp .env.example .env          # then set AUTH_SECRET to a random string of 32+ characters
yarn db:up                    # Postgres and Redis
yarn workspace @auction/db migrate:dev
yarn build                    # builds the shared packages the apps import; rerun after changing packages/shared or packages/db
```

## Run

```sh
yarn workspace @auction/api dev     # http://localhost:4000
yarn workspace @auction/web dev     # http://localhost:3000
yarn workspace @auction/admin dev   # http://localhost:3001
```

In development the API prints verification emails to its log instead of sending them.

## Checks

```sh
yarn lint
yarn typecheck
yarn test    # API tests need Postgres running (yarn db:up)
yarn build
```

## Layout

- `apps/web`: storefront (Next.js)
- `apps/admin`: admin app (Next.js)
- `apps/api`: NestJS API
- `packages/db`: Prisma schema and client
- `packages/shared`: types, Zod schemas
- `packages/ui`: shared UI primitives
- `packages/config`: shared tsconfig and eslint
