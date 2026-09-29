# Graceful shutdown for HTTP servers

Stop accepting connections, let in-flight requests finish, then close the database pool. Give the whole thing a deadline.
