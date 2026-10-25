import pg from "pg";

/**
 * Short timeouts on purpose: a directory lookup is a handful of indexed rows,
 * so anything slow is a fault to report, not a wait to sit through while a
 * patient watches a spinner.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 3_000,
    application_name: "healtrip-api",
  });
}
