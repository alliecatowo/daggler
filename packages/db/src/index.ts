/**
 * @daggler/db — public entry point
 *
 * Re-exports every table and enum from the Drizzle schema, plus a `schema`
 * namespace object that drizzle-orm's `drizzle(client, { schema })` pattern
 * expects when you want typed relational queries.
 */

export * from "./schema.js";

import * as schemaExports from "./schema.js";

/**
 * Namespace object containing all Drizzle table and enum definitions.
 * Pass this to `drizzle(client, { schema })` to enable relational query helpers.
 */
export const schema = schemaExports;
