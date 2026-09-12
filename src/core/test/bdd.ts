/**
 * Single seam for the test runner. Tests import BDD functions from here, so moving from bun test to
 * another runner is one file, not five hundred call sites.
 */
export { afterEach, beforeEach, describe, expect, it } from 'bun:test';
