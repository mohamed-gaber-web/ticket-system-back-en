import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { subjectKey } from "../src/utils/emailSubject.js";

describe("subjectKey — one conversation per subject", () => {
  it("drops reply / forward prefixes, repeated and in any case", () => {
    assert.equal(subjectKey("Quote for licenses"), "quote for licenses");
    assert.equal(subjectKey("Re: Quote for licenses"), "quote for licenses");
    assert.equal(subjectKey("RE: Fwd: re:  Quote   for licenses "), "quote for licenses");
    assert.equal(subjectKey("AW: Quote for licenses"), "quote for licenses");
    assert.equal(subjectKey("رد: Quote for licenses"), "quote for licenses");
  });

  it("drops the ticket / task tag we add, before or after the prefix", () => {
    assert.equal(subjectKey("[MIN-2026-00202] Login error"), "login error");
    assert.equal(subjectKey("Re: [MIN-2026-00202] Login error"), "login error");
    assert.equal(subjectKey("[GRO-SUB-0545] Login error"), "login error");
    assert.equal(subjectKey("RE: [TASK-2026-00012] Vendor status"), "vendor status");
  });

  it("keeps different subjects apart and names an empty one", () => {
    assert.notEqual(subjectKey("Quote"), subjectKey("Invoice"));
    assert.equal(subjectKey("Re: Release notes: v2"), "release notes: v2");
    assert.equal(subjectKey(""), "(no subject)");
    assert.equal(subjectKey(null), "(no subject)");
  });
});
