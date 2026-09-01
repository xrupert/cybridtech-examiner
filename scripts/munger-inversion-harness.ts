import assert from "node:assert/strict";
import { buildCanonicalTitleRecordFromExtraction } from "../lib/canonical-title-builder";
import { buildEvidenceLedger } from "../lib/title-evidence-ledger";
import { isLienIdentityType } from "../lib/lien-stack";
import { profileForOrderType } from "../lib/qc-profiles";
import { reconcileTitleSummary } from "../lib/run-sheet-reconciler";
import { createExportProfile, MCCALLA_EXPORT_PROFILE, validateExportProfile } from "../lib/export-profiles";

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`MUNGER PASS: ${name}`);
  } catch (error) {
    console.error(`MUNGER FAIL: ${name}`);
    throw error;
  }
}

function ev(quote: string, page = 1, documentType = "Title Search Report", instrumentNumber = "") {
  return { quote, page, documentType, instrumentNumber, confidence: 0.99 };
}

function fact(value = "Not Stated", evidence: any[] = []) {
  return { value, evidence };
}

check("One Owner Search gets generic owner + Vera 20 without foreclosure-only checks", () => {
  const profile = profileForOrderType("One Owner Search");
  assert.equal(profile.orderType, "One Owner Search");
  assert.equal(profile.unresolved, true);
  assert.equal(profile.checks.filter((item) => item.legacyQuestionNumber).length, 20);
  assert.ok(profile.checks.some((item) => item.id === "CURRENT_OWNER_ESTABLISHED"));
  assert.ok(!profile.checks.some((item) => item.id === "TARGET_LIEN_FOUND"));
  assert.ok(!profile.checks.some((item) => item.id === "TARGET_LIEN_POSITION_ESTABLISHED"));
});

check("Abstractor Notes inside a title report is NOT a distinct Abstractor Sheet", () => {
  const raw: any = {
    header: {
      orderNumber: fact("2025-26982", [ev("Order No. 2025-26982")]),
      tsNumber: fact("2025-26982", [ev("Order No. 2025-26982")]),
      searchType: fact("One Owner Search", [ev("Search Type: One Owner Search")]),
      state: fact("Texas", [ev("State of Texas")]),
      county: fact("Waller", [ev("County: Waller")]),
      propertyAddress: fact("2801 Cordova Hill Dr, Katy, TX 77493", [ev("2801 Cordova Hill Dr, Katy, TX 77493")]),
      parcelId: fact("800028-004-004-000", [ev("800028-004-004-000")]),
      effectiveDate: fact("10/16/2025", [ev("To: 10/16/2025")]),
      legalDescription: fact("Lot 4, Block 4, Sunterra Section 28", [ev("Lot 4, Block 4, Sunterra Section 28")]),
      borrower: fact(),
      currentOwner: fact("Joshua L. Vasquez and Veronica L. Vasquez", [ev("Joshua L. Vasquez and Veronica L. Vasquez")]),
    },
    runSheet: {
      detected: true,
      pageStart: 1,
      pageEnd: 5,
      basis: "Opening title report",
      evidence: [ev("Abstractor Notes", 5, "Title Search Report")],
      entries: [],
    },
    instruments: [], references: [],
    taxes: { status: fact(), fiscalYear: fact(), landValue: fact(), improvements: fact() },
    flags: { hoa: fact(), ccrs: fact(), federalTaxLien: fact(), bankruptcy: fact(), plat: fact(), mers: fact(), min: fact() },
    targetLienHint: { instrumentNumber: fact(), position: fact() }, extractionSummary: "test",
  };
  const nativeLedger: any = {
    version: 3, packetHash: "abc", sourceFile: "packet.pdf", pageCount: 5, totalCharacters: 1000,
    textCoverage: 1, usableTextPages: 5, lowTextPages: [], nativeTextReady: true,
    pages: [1,2,3,4,5].map((page) => ({ page, text: page === 5 ? "Abstractor Notes" : "Title Search Report", charCount: 100, documentHint: "Title Report", needsVisualReview: false })), extractedAt: new Date().toISOString(),
  };
  const ledger = buildEvidenceLedger({ packetHash: "abc", sourceFile: "packet.pdf", pageCount: 5, extractionMode: "native-text", extraction: raw, nativeLedger });
  const record = buildCanonicalTitleRecordFromExtraction({ extraction: raw, ledger });
  assert.equal(record.titleSummary.detected, true);
  assert.equal(record.runSheet.detected, false);
});

check("ordinary vesting deed with vendor's lien is not counted as a standalone lien identity", () => {
  assert.equal(isLienIdentityType("Special Warranty Deed with Vendor's Lien"), false);
  assert.equal(isLienIdentityType("Deed of Trust"), true);
});

check("one source instrument cannot satisfy duplicate title-summary entries", () => {
  const source: any = {
    id: "inst-1", type: "Deed of Trust", instrumentNumber: "2410811", bookPage: "Needs review",
    documentDate: "08/27/2024", recordingDate: "09/03/2024", amount: "$336,531.00",
    status: "Open", parties: [{ name: "Joshua L. Vasquez", role: "Borrower" }], propertyAddress: "2801 Cordova Hill Dr",
    legalDescription: "Lot 4 Block 4", referencedInstrumentNumbers: [], sourcePages: [17],
    evidence: [{ quote: "Instrument Number 2410811", page: 17, documentType: "Deed of Trust", source: "native", sourceFile: "packet.pdf", confidence: 1 }], evidenceIds: ["src"],
  };
  const entry = (id: string): any => ({
    id, category: "Mortgage", instrumentType: "Deed of Trust", instrumentNumber: "2410811", bookPage: "Needs review",
    documentDate: "08/27/2024", recordingDate: "09/03/2024", amount: "$336,531.00", parties: "Joshua L. Vasquez",
    legalDescription: "Lot 4 Block 4", evidence: [{ quote: "Instrument#: 2410811", page: 2, documentType: "Title Search Report", source: "native", sourceFile: "packet.pdf", confidence: 1 }], evidenceIds: [`sum-${id}`],
  });
  const record: any = { instruments: [source], references: [], titleSummary: { detected: true, entries: [entry("a"), entry("b")] } };
  const reconciliation = reconcileTitleSummary(record);
  assert.equal(reconciliation.matched, 1);
  assert.ok(reconciliation.sourceMissing + reconciliation.mismatched >= 1);
});

function exportRow(state: "CONFIRMED" | "UNCONFIRMED") {
  const v = (value: string) => ({ value, state, evidence: [], evidenceIds: [], basis: "test" });
  return {
    record: {
      orderNumber: v("2025-1"), tsNumber: v("2025-1"), borrower: v("Borrower"), currentOwner: v("Owner"),
      propertyAddress: v("1 Main St"), state: v("TX"), county: v("Waller"), parcelId: v("123"), orderType: v("One Owner Search"), effectiveDate: v("2025-01-01"),
      targetLien: { instrumentNumber: v("456"), amount: v("$100,000"), beneficiary: v("Lender"), position: v("1st Lien"), positionBasis: "FIRST_IN_TIME", positionConfidence: "high" },
      foreclosureAnalysis: { openLienCount: 1, seniorLienIds: [], juniorLienIds: [], requirements: [], status: "READY", lienStack: [], jurisdictionCoverage: undefined },
      packetHash: "hash", reviewId: "review", sourceFile: "packet.pdf",
    },
    qc: { checks: [], qcStatus: "PASS", foreclosureReadiness: "CLEAR", curativeIssues: [] },
  } as any;
}

check("required McCalla export fields must be source-confirmed, not merely nonblank", () => {
  const warnings = validateExportProfile(MCCALLA_EXPORT_PROFILE, [exportRow("UNCONFIRMED")]);
  assert.ok(warnings.some((warning) => /unconfirmed|not source-confirmed/i.test(warning)));
});

check("McCalla required columns cannot be removed by customization", () => {
  const custom = createExportProfile("McCalla", [], "csv");
  const requiredKeys = MCCALLA_EXPORT_PROFILE.columns.filter((column) => column.required).map((column) => column.key);
  for (const key of requiredKeys) assert.ok(custom.columns.some((column) => column.key === key));
});

console.log("MUNGER INVERSION HARNESS COMPLETE");
