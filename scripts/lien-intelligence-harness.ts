import assert from "node:assert/strict";
import { automaticTargetSecurityLienId, buildForeclosureAnalysis, buildLienStack, developedPositionForTarget } from "../lib/lien-stack";
import type { CanonicalInstrument } from "../lib/title-domain";

function instrument(overrides: Partial<CanonicalInstrument> & Pick<CanonicalInstrument, "id" | "type" | "instrumentNumber" | "recordingDate">): CanonicalInstrument {
  return {
    id: overrides.id,
    type: overrides.type,
    instrumentNumber: overrides.instrumentNumber,
    bookPage: overrides.bookPage || "Needs review",
    documentDate: overrides.documentDate || overrides.recordingDate,
    recordingDate: overrides.recordingDate,
    amount: overrides.amount || "Needs review",
    status: overrides.status || "Needs review",
    parties: overrides.parties || [],
    propertyAddress: overrides.propertyAddress || "Needs review",
    legalDescription: overrides.legalDescription || "Needs review",
    referencedInstrumentNumbers: overrides.referencedInstrumentNumbers || [],
    sourcePages: overrides.sourcePages || [],
    evidence: overrides.evidence || [],
    evidenceIds: overrides.evidenceIds || [],
  };
}

function testDerivativeDocumentsDoNotBecomeLiens() {
  const root = instrument({ id: "dot-1", type: "Deed of Trust", instrumentNumber: "2014-04040027", recordingDate: "2014-04-04", amount: "$78,551.00", status: "Recorded" });
  const modification = instrument({ id: "mod-1", type: "Loan Modification Agreement (Deed of Trust)", instrumentNumber: "2017-05180011", recordingDate: "2017-05-18", status: "Recorded", referencedInstrumentNumbers: ["2014-04040027"] });
  const assignment = instrument({ id: "aom-1", type: "Assignment of Deed of Trust", instrumentNumber: "2018-11160036", recordingDate: "2018-11-16", status: "Recorded", referencedInstrumentNumbers: ["2014-04040027"] });
  const trustee = instrument({ id: "trustee-1", type: "Appointment of Substitute Trustee", instrumentNumber: "2019-01110009", recordingDate: "2019-01-11", status: "Recorded", referencedInstrumentNumbers: ["2014-04040027"] });
  const stack = buildLienStack([root, modification, assignment, trustee], [], { titleSummaryOpenInstrumentNumbers: ["2014-04040027"] });
  assert.equal(stack.length, 1);
  assert.equal(stack[0].instrumentId, "dot-1");
  assert.equal(stack[0].status, "OPEN");
  assert.equal(stack[0].positionLabel, "1st Lien");
}

function testFirstPositionSecurityLienAutoDevelops() {
  const first = instrument({ id: "dot-1", type: "Deed of Trust", instrumentNumber: "100", recordingDate: "2020-01-01", amount: "$100,000", status: "Open" });
  const second = instrument({ id: "mort-2", type: "Subordinate Mortgage", instrumentNumber: "200", recordingDate: "2021-01-01", amount: "$20,000", status: "Open" });
  const stack = buildLienStack([first, second], []);
  assert.equal(automaticTargetSecurityLienId(stack, ["100", "200"]), "dot-1");
  assert.equal(automaticTargetSecurityLienId(stack, ["100"]), null, "Incomplete title-summary mortgage coverage must not force an automatic target.");
  const position = developedPositionForTarget(stack, "dot-1");
  assert.equal(position.value, "1st Lien");
  assert.equal(position.confidence, "high");
}

function testUnknownLienIsNotCountedOpenAndCanBlockPriority() {
  const first = instrument({ id: "dot-1", type: "Deed of Trust", instrumentNumber: "100", recordingDate: "2020-01-01", amount: "$100,000", status: "Open" });
  const unresolved = instrument({ id: "judgment-1", type: "Judgment Lien", instrumentNumber: "J-1", recordingDate: "2019-01-01", amount: "$5,000", status: "Recorded" });
  const stack = buildLienStack([first, unresolved], []);
  assert.equal(stack.filter((entry) => entry.status === "OPEN").length, 1);
  assert.equal(stack.find((entry) => entry.instrumentId === "judgment-1")?.status, "UNKNOWN");
  assert.equal(stack.find((entry) => entry.instrumentId === "dot-1")?.chronologicalPosition, null, "An unresolved potentially senior lien must block a false first-position conclusion.");
  const analysis = buildForeclosureAnalysis({ lienStack: stack, targetInstrumentId: "dot-1", targetAmount: "$100,000", targetPosition: "Needs review", targetPositionBasis: "UNRESOLVED", targetPositionConfidence: "low", selectionRequired: false });
  assert.equal(analysis.openLienCount, 1);
  assert.ok(analysis.requirements.some((item) => item.code.startsWith("LIEN_STATUS_")));
  assert.equal(analysis.status, "CURATIVE_REQUIRED");
}

function testReleasedJudgmentLienLeavesOpenStack() {
  const judgment = instrument({ id: "judgment-1", type: "Judgment Lien", instrumentNumber: "16-2-00578-7", recordingDate: "2016-08-15", amount: "$936.22", status: "Active" });
  const release = instrument({ id: "release-1", type: "Release of Judgment Lien", instrumentNumber: "REL-1", recordingDate: "2018-03-01", status: "Recorded", referencedInstrumentNumbers: ["16-2-00578-7"] });
  const mortgage = instrument({ id: "dot-1", type: "Deed of Trust", instrumentNumber: "2014-04040027", recordingDate: "2014-04-04", amount: "$78,551.00", status: "Open" });
  const stack = buildLienStack([mortgage, judgment, release], [release]);
  assert.equal(stack.find((entry) => entry.instrumentId === "judgment-1")?.status, "RELEASED");
  assert.equal(stack.filter((entry) => entry.status === "OPEN").length, 1);
  assert.equal(stack.find((entry) => entry.instrumentId === "dot-1")?.positionLabel, "1st Lien");
}

function testActiveJudgmentWithLienReleaseEvidenceIsReleased() {
  const judgment = instrument({
    id: "judgment-1",
    type: "Judgment Lien",
    instrumentNumber: "16-2-00578-7",
    recordingDate: "2016-08-15",
    amount: "$936.22",
    status: "Active",
    evidence: [{ quote: "03/01/2018 Release of Judgment Lien", page: 57, documentType: "Court Docket", source: "openai-file", instrumentNumber: "16-2-00578-7", confidence: 0.99 }],
  });
  const mortgage = instrument({ id: "dot-1", type: "Deed of Trust", instrumentNumber: "2014-04040027", recordingDate: "2014-04-04", amount: "$78,551.00", status: "Open" });
  const stack = buildLienStack([mortgage, judgment], [], { titleSummaryOpenInstrumentNumbers: ["2014-04040027", "16-2-00578-7"] });
  assert.equal(stack.find((entry) => entry.instrumentId === "judgment-1")?.status, "RELEASED", "A real-property judgment-lien release controls lien status even when the underlying judgment docket remains Active.");
  assert.equal(stack.filter((entry) => entry.status === "OPEN").length, 1);
  assert.equal(stack.find((entry) => entry.instrumentId === "dot-1")?.positionLabel, "1st Lien");
}

const tests: Array<[string, () => void]> = [
  ["derivative lien-chain documents are not lien identities", testDerivativeDocumentsDoNotBecomeLiens],
  ["first-position security lien auto-develops when title summary is complete", testFirstPositionSecurityLienAutoDevelops],
  ["unknown lien status is excluded from open count and can block priority", testUnknownLienIsNotCountedOpenAndCanBlockPriority],
  ["released judgment lien is excluded from open stack", testReleasedJudgmentLienLeavesOpenStack],
  ["active judgment with lien-release evidence is treated as released for real-property priority", testActiveJudgmentWithLienReleaseEvidenceIsReleased],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`Lien intelligence harness passed ${tests.length}/${tests.length}.`);
