#!/usr/bin/env bash
# Runs the API tests against their own empty database (auction_test) in the local Postgres, so they do not share rows,
# locks or background sweeps with the dev database. Creates and migrates it when missing. Extra arguments go to vitest.
set -euo pipefail
cd "$(dirname "$0")/.."

TEST_DB=auction_test
BASE=postgresql://auction:auction@localhost:5432

if ! docker compose exec -T postgres psql -U auction -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" | grep -q 1; then
  docker compose exec -T postgres psql -U auction -d postgres -c "CREATE DATABASE ${TEST_DB}"
fi

export DATABASE_URL="${BASE}/${TEST_DB}"
# Redis database 1, so rate-limit keys do not mix with the dev ones.
export REDIS_URL=redis://localhost:6379/1

yarn workspace @auction/db migrate:deploy
yarn workspace @auction/api test "$@"
