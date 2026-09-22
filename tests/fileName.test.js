/**
 * Non-ASCII upload / download file names.
 *
 * Covers the two halves of the round trip: recovering a UTF-8 name that
 * busboy handed us latin1-decoded, and emitting a Content-Disposition header
 * that Node will actually accept.
 *
 * Run with: node --test tests/fileName.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeUploadedFileName,
  contentDisposition,
  fixUploadedFileNames,
} from "../src/utils/fileName.js";

// Exactly what multer produced for "تاسك فايل تست.xlsx" in this project.
const MOJIBAKE = Buffer.from("تاسك فايل تست.xlsx", "utf8").toString("latin1");

describe("decodeUploadedFileName", () => {
  it("recovers an Arabic name mis-decoded as latin1", () => {
    assert.equal(decodeUploadedFileName(MOJIBAKE), "تاسك فايل تست.xlsx");
    assert.match(MOJIBAKE, /^ØªØ§Ø³/); // the string the user reported
  });

  it("leaves ASCII names alone", () => {
    for (const name of ["report.pdf", "task-export 2026.xlsx", "a_b-c.(1).png"]) {
      assert.equal(decodeUploadedFileName(name), name);
    }
  });

  it("leaves an already-decoded name alone", () => {
    // A client that sent RFC 5987 filename* — re-reading it as bytes would break it.
    assert.equal(decodeUploadedFileName("تاسك.xlsx"), "تاسك.xlsx");
  });

  it("leaves bytes that are not valid UTF-8 alone", () => {
    // Windows-1256 Arabic, not UTF-8: must not be turned into replacement chars.
    const cp1256 = Buffer.from([0xca, 0xc7, 0xd3, 0xe3, 0x2e, 0x78, 0x6c, 0x73]).toString("latin1");
    const out = decodeUploadedFileName(cp1256);
    assert.equal(out, cp1256);
    assert.ok(!out.includes("�"));
  });

  it("handles empty and non-string input", () => {
    assert.equal(decodeUploadedFileName(""), "");
    assert.equal(decodeUploadedFileName(undefined), undefined);
    assert.equal(decodeUploadedFileName(null), null);
  });

  it("fixes every file multer may have attached", () => {
    const req = { file: { originalname: MOJIBAKE }, files: [{ originalname: MOJIBAKE }] };
    let called = false;
    fixUploadedFileNames(req, {}, () => { called = true; });
    assert.ok(called);
    assert.equal(req.file.originalname, "تاسك فايل تست.xlsx");
    assert.equal(req.files[0].originalname, "تاسك فايل تست.xlsx");
  });

  it("does not throw when no file was uploaded", () => {
    const req = {};
    fixUploadedFileNames(req, {}, () => {});
    assert.deepEqual(req, {});
  });
});

describe("contentDisposition", () => {
  it("emits an ASCII fallback plus filename* for Arabic", () => {
    const value = contentDisposition("تاسك فايل تست.xlsx");
    assert.match(value, /^attachment; filename="[\x20-\x7E]*"; filename\*=UTF-8''/);
    assert.ok(value.includes(encodeURIComponent("تاسك فايل تست.xlsx")));
  });

  it("produces a header value Node accepts", () => {
    // ERR_INVALID_CHAR is what a raw Arabic name caused; latin1-only proves it is gone.
    const value = contentDisposition("تاسك فايل تست.xlsx");
    for (let i = 0; i < value.length; i++) {
      assert.ok(value.charCodeAt(i) <= 0xff, `non-latin1 char at ${i}`);
      assert.ok(value.charCodeAt(i) >= 0x20, `control char at ${i}`);
    }
  });

  it("stays simple for plain ASCII names", () => {
    assert.equal(contentDisposition("report.pdf"), 'attachment; filename="report.pdf"');
  });

  it("honours inline", () => {
    assert.match(contentDisposition("photo.png", { inline: true }), /^inline; filename="photo\.png"/);
  });

  it("neutralises quotes and control characters that would end the parameter", () => {
    const value = contentDisposition('ev"il\r\nname.txt');
    assert.ok(!value.includes('il"'), value);
    assert.ok(!/[\r\n]/.test(value));
  });

  it("falls back to a usable ASCII name, keeping the extension", () => {
    assert.match(contentDisposition("تاسك.xlsx"), /filename="download.xlsx"/);
    assert.match(contentDisposition("تست"), /filename="download"/);
    assert.equal(contentDisposition(""), 'attachment; filename="download"');
  });
});
