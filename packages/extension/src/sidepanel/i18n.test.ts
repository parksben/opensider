import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localeFromLanguageTag } from "./i18n.ts";

describe("localeFromLanguageTag", () => {
  it("maps Chinese tags to zh", () => {
    assert.equal(localeFromLanguageTag("zh"), "zh");
    assert.equal(localeFromLanguageTag("zh-CN"), "zh");
    assert.equal(localeFromLanguageTag("zh-TW"), "zh");
    assert.equal(localeFromLanguageTag("zh_HK"), "zh");
    assert.equal(localeFromLanguageTag(" zh-Hans-CN "), "zh");
  });

  it("maps everything else to en", () => {
    assert.equal(localeFromLanguageTag("en"), "en");
    assert.equal(localeFromLanguageTag("en-US"), "en");
    assert.equal(localeFromLanguageTag("ja"), "en");
    assert.equal(localeFromLanguageTag(""), "en");
  });
});
