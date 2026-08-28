export const AUDIT_RULE_VERSION = "CYBRID-VERA3-RCS-MVP-2026-08-28";

export const SEARCH_TYPES = [
  "Foreclosure",
  "2nd Lien",
  "Current Owner Search",
] as const;

export type SupportedSearchType = (typeof SEARCH_TYPES)[number];

export const CRITICAL_QUESTION_NUMBERS = new Set([4,5,6,7,8,9,10,11,12,17,18,19,20]);

export const REQUIRED_QUESTIONS = [
  "HOA or not applicable?",
  "Covenants, Conditions, Restrictions?",
  "HOA name/amounts listed?",
  "Deed/Mortgage amounts/names accurate?",
  "All doc recordings available/match report?",
  "Recordings in chronological order?",
  "Assignment vesting accurate?",
  "Legal description confirmed across deed, DOT, report?",
  "Original beneficiary MERS on DOT?",
  "Federal Tax Lien?",
  "Doc releases on report?",
  "Property secured, address matches DOT?",
  "Loan Document type?",
  "Recording Date?",
  "Loan status, including notes?",
  "Recourse?",
  "Typos/errors in report?",
  "Plat map labeled?",
  "MIN# in run sheet?",
  "Run Sheet accurate?",
] as const;

export const AUDIT_DOCTRINE = {
  noAssumptions: "Never infer a fact merely because a term is absent. Missing information is a defect only when a governing rule or supplied document explicitly requires it.",
  evidence: "Every supported finding must retain exact source text and physical PDF page provenance. A supported PASS or FAIL without evidence is invalid.",
  initialState: "Every audit question starts UNDETERMINED.",
  cannotConfirm: "When a referenced full document is required for a comparison but is not supplied verbatim or cannot be inspected, use CANNOT_CONFIRM.",
  bidirectional: "Verify Run Sheet to packet and packet to Run Sheet. A referenced recording not found or a recorded packet document omitted from the Run Sheet is a discrepancy.",
  mers: "A DOT naming MERS with a MIN does not require assignments solely because MERS is beneficiary.",
  hoa: "If HOA is not referenced and the selected order type does not require HOA material, mark Not Applicable. Quote HOA name when referenced; report dues only when a lien/document expressly states an amount.",
  legalDescription: "Compare only descriptions actually supplied. Conflicting descriptions fail. If a referenced comparison document is unavailable, Cannot Confirm. The dedicated Legal Description Compliance Protocol is still pending and no additional geometry/state-law rule may be invented.",
  plat: "A plat is not automatically required. Apply the selected RCS order-type rule. Do not invent an external state mandate that is not loaded.",
  overall: "Overall Pass requires every applicable critical question to pass. Any critical Fail or Cannot Confirm yields overall Fail.",
} as const;

export const RCS_ORDER_REQUIREMENTS: Record<SupportedSearchType, readonly string[]> = {
  "Foreclosure": [
    "Deed chain must satisfy Marketable Record Title/customary state search period and show 100% ownership or run back to the developer.",
    "If the owner has a foreclosure, include the foreclosed mortgage and trailing documents.",
    "Required document copies are full copies; pertinent-pages-only is insufficient.",
    "Include copies of all referenced plats.",
    "Include copies of all dockets and filed judgments.",
    "For HOA/condominium property, include declarations, restrictions, and covenants.",
    "Include county tax information.",
    "For deceased owners, include recorded death certificates and applicable probate documents; identified heirs require name searches.",
    "Provide voluntary liens on the ordered owner and related releases, assignments, subordinations, and modifications within scope.",
    "Identify open involuntary liens on the property and open involuntary liens/judgments on vested owners within scope/statute.",
    "Packet ordering baseline: RCS Abstractor Sheet; Assessor/Taxes; Conveyance newest-to-oldest; Mortgages oldest-to-newest; Judgments/Liens newest-to-oldest; Misc documents oldest-to-newest.",
    "Where a prior Full Value Deed has been released, omit that released prior FVD from the report.",
  ],
  "2nd Lien": [
    "Deed chain must satisfy Marketable Record Title/customary state search period and show 100% ownership or run back to the developer.",
    "Document copies require the first three pages of each open Full Value Deed and all pages of foreclosure documents.",
    "Do not require other document copies for this search; specifically do not require HOA, CC&R, judgments/liens, or transfer-document copies solely because they are absent.",
    "Package baseline: Assessor/Taxes; Conveyance newest-to-oldest; Mortgages oldest-to-newest; Legal Description.",
  ],
  "Current Owner Search": [
    "Identify the last Full Value Deed recording date, amount, and vesting.",
    "Identify the last Full Value Deed originator and new loan amount.",
    "Search back to a non-family Full Value Transfer Deed with a concurrently filed purchase-money mortgage from an institutional lender unless the order instructions say otherwise.",
    "Required document copies include all pages.",
  ],
} as const;

export const AUTHORITATIVE_RULE_PACKS = [
  "VERA Template v3 supplied by owner on 2026-08-28: authoritative output structure for Review Summary, Property & Tax, Required Questions, Accuracy Audit, Pass/Fail, Confirmation, and Notes.",
  "RCS Title Search Requirements by order type supplied by owner on 2026-08-28.",
  ...RCS_ORDER_REQUIREMENTS.Foreclosure.map((rule) => `RCS Foreclosure: ${rule}`),
  ...RCS_ORDER_REQUIREMENTS["2nd Lien"].map((rule) => `RCS 2nd Lien: ${rule}`),
  ...RCS_ORDER_REQUIREMENTS["Current Owner Search"].map((rule) => `RCS Current Owner Search: ${rule}`),
  "Recovered Title Report Auditor no-assumption/evidence instructions supplied by owner.",
  "Title Report Forensic Audit – Quick Reference Checklist.docx (source file still pending)",
  "Title Report Legal Description Compliance Protocol.docx (source file still pending)",
] as const;

export function isSupportedSearchType(value: string): value is SupportedSearchType {
  return (SEARCH_TYPES as readonly string[]).includes(value);
}
