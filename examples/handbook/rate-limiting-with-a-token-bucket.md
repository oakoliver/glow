# Rate limiting with a token bucket

Each client gets a bucket that refills at a steady rate; a request spends a token or gets a 429 with `Retry-After`.
