/**
 * Content types for GridFS files.
 *
 * The driver no longer persists `contentType`, so the resolver has to fall
 * back to `metadata.contentType` and then to the file extension — otherwise
 * everything is served as application/octet-stream and, with helmet's
 * `nosniff`, a PDF attachment downloads instead of opening.
 *
 * Run with: node --test tests/fileType.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mimeFromName, resolveContentType, isInlineType } from "../src/utils/fileType.js";

describe("mimeFromName", () => {
  it("maps the extensions this system accepts", () => {
    assert.equal(mimeFromName("a.pdf"), "application/pdf");
    assert.equal(mimeFromName("a.PNG"), "image/png");
    assert.equal(mimeFromName("report.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(mimeFromName("تاسك فايل تست.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(mimeFromName("Screenshot 2026-09-07 at 10.11.01 AM.png"), "image/png");
  });

  it("returns empty for anything it cannot place", () => {
    assert.equal(mimeFromName("noextension"), "");
    assert.equal(mimeFromName("a.weird"), "");
    assert.equal(mimeFromName(""), "");
    assert.equal(mimeFromName(undefined), "");
  });
});

describe("resolveContentType", () => {
  it("prefers the stored type when the driver kept one", () => {
    assert.equal(resolveContentType({ contentType: "image/gif", filename: "x.pdf" }), "image/gif");
  });

  it("falls back to metadata, where new uploads keep it", () => {
    assert.equal(resolveContentType({ metadata: { contentType: "application/pdf" } }), "application/pdf");
  });

  it("types the 369 legacy records from their name", () => {
    // Exactly the shape found in this database: no contentType anywhere.
    const legacy = { filename: "1788359810033-1.png", metadata: { originalName: "1.png" } };
    assert.equal(resolveContentType(legacy), "image/png");
  });

  it("uses the caller's name when the record has none", () => {
    assert.equal(resolveContentType({ filename: "x" }, "quote.pdf"), "application/pdf");
  });

  it("ends at octet-stream rather than throwing", () => {
    assert.equal(resolveContentType({}), "application/octet-stream");
    assert.equal(resolveContentType(null), "application/octet-stream");
  });
});

describe("isInlineType", () => {
  it("previews images and PDFs", () => {
    assert.equal(isInlineType("application/pdf"), true);
    assert.equal(isInlineType("image/png"), true);
    assert.equal(isInlineType("image/jpeg"), true);
  });

  it("never previews SVG — an inline SVG can carry script", () => {
    assert.equal(isInlineType("image/svg+xml"), false);
  });

  it("downloads everything else", () => {
    for (const type of [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "text/html",
      "",
      undefined,
    ]) {
      assert.equal(isInlineType(type), false, `${type} should not be inline`);
    }
  });
});
