/**
 * Tests for the ticket duration rule: a ticket may sit in New or Assigned
 * without a duration, but every later status needs one greater than zero.
 * Pure function only; no database.
 *
 * Run with: node --test tests/ticketDuration.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { durationError, DURATION_REQUIRED_MESSAGE } from "../src/controllers/ticketController.js";

const LATER_STATUSES = ["in_progress", "customer_pending", "resolved", "tested", "closed", "reopened", "delivered", "not_related"];

describe("durationError", () => {
  it("allows New and Assigned without a duration", () => {
    for (const status of ["new", "assigned"]) {
      for (const duration of [undefined, null, "", 0, "0"]) {
        assert.equal(durationError(status, duration), null, `${status} / ${String(duration)}`);
      }
    }
  });

  it("refuses every later status with an empty or zero duration", () => {
    for (const status of LATER_STATUSES) {
      for (const duration of [undefined, null, "", 0, "0", -2]) {
        assert.equal(durationError(status, duration), DURATION_REQUIRED_MESSAGE, `${status} / ${String(duration)}`);
      }
    }
  });

  it("allows every later status once the duration is above zero", () => {
    for (const status of LATER_STATUSES) {
      for (const duration of [0.5, 1, 8, "3"]) {
        assert.equal(durationError(status, duration), null, `${status} / ${String(duration)}`);
      }
    }
  });

  it("does nothing when no status is given", () => {
    assert.equal(durationError(undefined, 0), null);
  });
});
