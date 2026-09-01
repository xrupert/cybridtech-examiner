import assert from "node:assert/strict";
import { profileForOrderType, VERA_20_CHECKS } from "../lib/qc-profiles";

const oneOwner = profileForOrderType("One Owner Search");
assert.equal(oneOwner.id, "vera-one-owner-generic-v4");
assert.equal(oneOwner.unresolved, undefined);
assert.match(oneOwner.name, /One Owner.*Vera 20/i);
assert.equal(oneOwner.checks.filter((check) => check.legacyQuestionNumber).length, 20);
assert.deepEqual(
  oneOwner.checks.filter((check) => check.legacyQuestionNumber).map((check) => check.legacyQuestionNumber),
  Array.from({ length: 20 }, (_, index) => index + 1),
);
assert.equal(oneOwner.checks.some((check) => check.id === "CURRENT_OWNER_ESTABLISHED"), true);
assert.equal(oneOwner.checks.some((check) => check.id === "TARGET_LIEN_FOUND"), false);
assert.equal(oneOwner.checks.some((check) => check.id === "TARGET_LIEN_POSITION_ESTABLISHED"), false);
assert.equal(oneOwner.checks.some((check) => check.id === "PRIOR_OWNER_ESTABLISHED"), false);
assert.equal(oneOwner.checks.some((check) => check.id === "OWNERSHIP_CHAIN_COMPLETE"), false);

const unknown = profileForOrderType("Unloaded Client Search Type");
assert.equal(unknown.unresolved, true);
assert.equal(unknown.checks.filter((check) => check.legacyQuestionNumber).length, VERA_20_CHECKS.length);
assert.equal(unknown.checks.some((check) => check.id === "CURRENT_OWNER_ESTABLISHED"), true);
assert.equal(unknown.checks.some((check) => check.id === "TARGET_LIEN_FOUND"), false);
assert.equal(unknown.checks.some((check) => check.id === "TARGET_LIEN_POSITION_ESTABLISHED"), false);

console.log("ONE_OWNER_FALLBACK COMPLETE: explicit One Owner gets generic Vera 20 + owner review; unknown order types fail closed without foreclosure-only checks.");
