import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEmailHtml as clean, cleanStyle } from "../src/utils/htmlSanitizer.js";

test("composer formatting survives: alignment, colours, fonts, sizes, indent, rtl", () => {
  assert.equal(
    clean(`<p style="text-align: center; color: rgb(255, 0, 0)">hi</p>`),
    `<p style="text-align: center; color: rgb(255, 0, 0)">hi</p>`
  );
  assert.equal(
    clean(`<span style="font-family: &quot;Times New Roman&quot;, serif; font-size: x-large">a</span>`),
    `<span style="font-family: &quot;Times New Roman&quot;, serif; font-size: x-large">a</span>`
  );
  assert.equal(clean(`<font face="Arial" size="5" color="#ff0000">b</font>`), `<font face="Arial" size="5" color="#ff0000">b</font>`);
  assert.equal(clean(`<div dir="rtl" style="margin-left: 40px">x</div>`), `<div dir="rtl" style="margin-left: 40px">x</div>`);
});

test("dangerous or layout CSS is dropped", () => {
  assert.equal(cleanStyle("position: fixed; top: 0; width: 100%; background-image: url(x)"), "");
  assert.equal(cleanStyle("color: expression(alert(1)); background-color: #ff0"), "background-color: #ff0");
  assert.equal(cleanStyle("font-family: javascript"), "");
  assert.equal(cleanStyle("color: red \\9"), "");
  assert.equal(clean(`<p dir="javascript:x" onclick="y">e</p>`), `<p>e</p>`);
  assert.equal(clean(`<font face="x" size="9" color="url(x)" onload="z">f</font>`), `<font face="x">f</font>`);
});

test("received mail can't escape or blow up its box", () => {
  assert.equal(cleanStyle("margin-left: -2000px; color: red"), "color: red");
  assert.equal(cleanStyle("text-indent: -.5em"), "");
  assert.equal(cleanStyle("font-size: 400px"), "");
  assert.equal(cleanStyle("font-size: 60pt"), "");
  assert.equal(cleanStyle("font-size: 18px; line-height: 1.5"), "font-size: 18px; line-height: 1.5");
  assert.equal(cleanStyle("line-height: 40"), "");
  assert.equal(cleanStyle("margin-left: 40px; color: #00ff00"), "margin-left: 40px; color: #00ff00");
  assert.equal(cleanStyle("font-size: x-large"), "font-size: x-large");
});
