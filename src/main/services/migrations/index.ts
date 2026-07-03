import type { Migration } from "./runner.js";
import { migrate1 } from "./migrate-1.js";

export { runMigrations, type Migration } from "./runner.js";

/**
 * Migrations for the dictionary database (userData/dictionary.db), in ascending
 * version order. Append the next `migrate-N.ts` here as the schema evolves.
 */
export const dictionaryMigrations: Migration[] = [migrate1];
