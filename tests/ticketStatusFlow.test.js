import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFlow,
  allowedNext,
  transitionError,
  validateStatusForm,
  hasRequiredForm,
  TICKET_STATUSES,
} from "../src/utils/ticketStatusFlow.js";

const { flow } = normalizeFlow({
  new: { next: ["assigned", "cancelled", "new", "bogus", "assigned"] },
  assigned: { next: ["in_progress"] },
  in_progress: { next: ["resolved"], fields: [] },
  resolved: {
    next: ["closed"],
    fields: [{ key: "comment", required: true }, { key: "hours", required: false }, { key: "nope", required: true }, "reason"],
  },
  closed: { next: [] },
});

test("normalizeFlow cleans next lists and fields", () => {
  assert.deepEqual(flow.new.next, ["assigned", "cancelled"]);
  assert.deepEqual(flow.resolved.fields, [
    { key: "comment", required: true },
    { key: "hours", required: false },
    { key: "reason", required: false },
  ]);
  // A status not sent keeps every move
  assert.equal(flow.tested.next.length, TICKET_STATUSES.length - 1);
  assert.deepEqual(normalizeFlow(null), { flow: null });
  assert.ok(normalizeFlow([]).error);
});

test("order: employees follow it, admins and unconfigured flows don't", () => {
  assert.equal(transitionError(flow, "new", "assigned"), null);
  assert.match(transitionError(flow, "new", "resolved"), /can only move to: Assigned, Cancelled/);
  assert.equal(transitionError(flow, "new", "resolved", { admin: true }), null);
  assert.match(transitionError(flow, "closed", "reopened"), /cannot change status/);
  assert.equal(transitionError(null, "new", "closed"), null);
  assert.equal(transitionError(flow, "new", "new"), null);
  assert.equal(allowedNext(flow, "closed", { admin: true }).length, TICKET_STATUSES.length - 1);
});

test("status form: required fields, hours and attachments", () => {
  assert.match(validateStatusForm(flow, "resolved", {}).error, /needs: Comment/);
  assert.deepEqual(validateStatusForm(flow, "resolved", { comment: " done ", hours: "1.5", junk: 1 }).form, {
    comment: "done",
    hours: 1.5,
  });
  assert.match(validateStatusForm(flow, "resolved", { comment: "x", hours: 30 }).error, /at most 24/);
  assert.match(validateStatusForm(flow, "resolved", { comment: "x", hours: 0.3 }).error, /0.25/);
  // A status without a form ignores whatever is sent
  assert.deepEqual(validateStatusForm(flow, "assigned", { comment: "x" }).form, {});
  assert.equal(hasRequiredForm(flow, "resolved"), true);
  assert.equal(hasRequiredForm(flow, "assigned"), false);

  const { flow: withFile } = normalizeFlow({ closed: { next: [], fields: [{ key: "attachment", required: true }] } });
  assert.ok(validateStatusForm(withFile, "closed", { attachments: [{ fileName: "a" }] }).error);
  assert.equal(
    validateStatusForm(withFile, "closed", { attachments: [{ fileName: "a.pdf", filePath: "/api/files/1", fileSize: 3 }] }).form.attachments.length,
    1
  );
});
