-- Typo-tolerant search straight from Postgres (levenshtein), for environments without Typesense.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
