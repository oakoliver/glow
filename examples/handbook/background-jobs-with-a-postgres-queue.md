# Background jobs with a Postgres queue

A `jobs` table, `SELECT ... FOR UPDATE SKIP LOCKED` and a worker loop cover most needs before you reach for a broker.
