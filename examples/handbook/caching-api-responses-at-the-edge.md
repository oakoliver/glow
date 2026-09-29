# Caching API responses at the edge

Most of our API traffic is reads, and most of those reads ask for the same
few hundred resources. Serving them from the edge takes load off the origin
and cuts latency for everyone far from it.

This guide covers what we cache, for how long, and how we measured the
result. The [HTTP caching headers explained](http-caching-headers-explained.md)
page has the background on `Cache-Control`.

---

## I – What we cache

Only `GET` responses that are the same for every caller. Anything that
depends on the session stays private.

**First: a cache key per resource version.** The key includes the resource
id and its version, so an update produces a new key and old entries simply
age out.

```typescript
export function cacheKey(req: Request, version: number): string {
  const url = new URL(req.url);
  const params = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  return `v${version}:${url.pathname}?${query}`;
}

export function cacheHeaders(maxAge: number): Headers {
  return new Headers({
    "Cache-Control": `public, max-age=${maxAge}, stale-while-revalidate=60`,
    "Vary": "Accept-Encoding",
  });
}
```

**Second: stale while revalidate.** The edge may serve a response up to a
minute past its expiry while it fetches a fresh one in the background, so
no caller waits on the origin for a popular resource.

**Third: short TTLs for lists.** Lists change more often than single
resources, so they get a tenth of the TTL.

---

## II – The numbers

Measured over a week of production traffic, before and after.

**Latency at the 95th percentile:**

| Region        | Before  | After  | Change |
|---------------|---------|--------|--------|
| Europe        | 182 ms  | 41 ms  | -77%   |
| North America | 214 ms  | 38 ms  | -82%   |
| Asia Pacific  | 391 ms  | 52 ms  | -87%   |

**Load on the origin:**

| Endpoint        | Requests/day before | Requests/day after | Hit ratio |
|-----------------|---------------------|--------------------|-----------|
| `/products/:id` | 4.1 M               | 0.3 M              | 93%       |
| `/products`     | 1.2 M               | 0.4 M              | 67%       |
| `/categories`   | 0.6 M               | 0.02 M             | 97%       |

Lists hit the cache less often because of their shorter TTL, which is the
trade we wanted: fresher lists, still two thirds fewer requests.

---

## III – What we would do differently

Tag responses with the resources they contain from day one. Purging by tag
is far easier than working out which keys a change affects.
