import { test } from "node:test";
import assert from "node:assert/strict";
import { newlyAssignedIds, taskAssignedVariables } from "../src/utils/taskAssignedEmail.js";

test("new task: assignee and responsible, once each", () => {
  assert.deepEqual(newlyAssignedIds(null, { assignedTo: "a", responsible: "b" }), ["a", "b"]);
  assert.deepEqual(newlyAssignedIds(null, { assignedTo: "a", responsible: "a" }), ["a"]);
});

test("edit: only people who were not on the task before", () => {
  const before = { assignedTo: "a", responsible: "b" };
  assert.deepEqual(newlyAssignedIds(before, { assignedTo: { _id: "a" }, responsible: { _id: "b" } }), []);
  assert.deepEqual(newlyAssignedIds(before, { assignedTo: { _id: "c" }, responsible: { _id: "b" } }), ["c"]);
  // swapping roles is not a new assignment
  assert.deepEqual(newlyAssignedIds(before, { assignedTo: "b", responsible: "a" }), []);
});

test("variables are escaped, including $ for String.replace", () => {
  const v = taskAssignedVariables(
    { _id: "t1", taskNumber: "TASK-2026-00001", name: "<b>x</b> $&", description: "a\nb", department: { name: "R&D" }, status: "pending", assignedTo: "p1", responsible: "p2", scheduledWeek: 3, endWeek: 4, duration: 5 },
    { _id: "p1", firstName: "Sara", lastName: "<i>" },
    "Boss",
    "https://app"
  );
  assert.equal(v.taskName, "TASK-2026-00001 · &lt;b&gt;x&lt;/b&gt; &#36;&amp;");
  assert.equal(v.assigneeName, "Sara &lt;i&gt;");
  assert.match(v.descriptionRow, /a<br>b/);
  assert.equal(v.departmentName, "R&amp;D");
  assert.match(v.status, /you are the assignee/);
  assert.match(v.weekRow, /W3 – W4/);
  assert.equal(v.taskUrl, "https://app/tasks/t1");
});

test("the person saving is never e-mailed about their own assignment", () => {
  assert.deepEqual(newlyAssignedIds(null, { assignedTo: "me", responsible: "b" }, "me"), ["b"]);
  assert.deepEqual(newlyAssignedIds({ assignedTo: "x", responsible: "y" }, { assignedTo: "me", responsible: "y" }, "me"), []);
});

test("scheduled week shows its calendar dates", () => {
  const v = taskAssignedVariables(
    { _id: "t", name: "n", startDate: "2026-01-03", endDate: "2026-01-16", scheduledWeek: 1, endWeek: 2, assignedTo: "p" },
    { _id: "p", email: "p@x.com" },
    "",
    "https://app"
  );
  // 2026-01-03 is the first Saturday → week 1 = Jan 3 – Jan 9, week 2 ends Jan 16
  assert.match(v.weekRow, /W1 – W2 \(Jan 3 – Jan 16\)/);
});
