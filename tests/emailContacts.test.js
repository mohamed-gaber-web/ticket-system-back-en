import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSuggestions, startsWord } from "../src/controllers/emailContactController.js";

test("dedupes across sources, keeps the first source's label, caps the list", () => {
  const out = mergeSuggestions(
    [
      [{ email: "A@x.com", source: "recent" }],
      [{ email: "a@x.com", name: "Ann", source: "employee" }, { email: "b@x.com", name: "Bob", source: "employee" }],
    ],
    10
  );
  assert.deepEqual(out, [
    { email: "a@x.com", name: "", source: "recent" },
    { email: "b@x.com", name: "Bob", source: "employee" },
  ]);
  assert.equal(mergeSuggestions([[1, 2, 3].map((i) => ({ email: `${i}@x.com` }))], 2).length, 2);
});

test("word-start matches rank first within a source", () => {
  assert.equal(startsWord({ email: "m.sara@x.com", name: "Mona Sara" }, "sa"), true);
  assert.equal(startsWord({ email: "hassan@x.com", name: "Hassan" }, "sa"), false);
  const out = mergeSuggestions([[{ email: "hassan@x.com" }, { email: "sales@x.com" }]], 10, "sa");
  assert.deepEqual(out.map((o) => o.email), ["sales@x.com", "hassan@x.com"]);
});
