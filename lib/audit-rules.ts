export const AUDIT_RULE_VERSION = "CYBRID-VERA3-RCS-QRC-LDP-2026-08-28";

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

export const QUICK_REFERENCE_RULES = [
  "Reset context for every audit. Work only from the supplied packet, instructions, and loaded rule sources.",
  "No assumptions: only flag missing material when it is explicitly referenced or required by a loaded governing rule.",
  "Evidence is mandatory: retain exact quoted text and physical PDF page for supported factual findings.",
  "Start every question UNDETERMINED.",
  "PASS means a verbatim match, a summary match without discrepancy, or a valid not-required/not-applicable condition.",
  "FAIL means a contradiction, an explicitly referenced required item is absent, or a loaded authoritative rule makes the item mandatory.",
  "Minor issues do not fail the audit unless the relevant question/rule is critical.",
  "Self-check before failing: search for alternative quoted proof that resolves the apparent discrepancy.",
  "Run Sheet and packet must be checked bidirectionally. Every Run Sheet entry must be found in the packet and every recorded packet document must be represented on the Run Sheet when applicable.",
  "Run Sheet gaps or extra/unlisted recorded documents affect Q5, Q20, and Chain of Title.",
  "MERS: when a DOT names MERS and contains a MIN, do not require assignments solely because MERS is beneficiary.",
  "HOA: quote the HOA name if mentioned; report dues only when an included lien/document expressly states an amount.",
  "Documents are required only when referenced or made mandatory by the selected loaded order-type rule.",
  "Chain blanks are acceptable when vesting is complete and no documentary gap is shown; flag explicit gaps.",
  "Typos are material only when they can affect legal identity or legal effect, including party name, parcel ID, instrument number, or property address. Ignore trivial formatting unless a loaded rule says otherwise.",
  "Plat: require only when referenced and the applicable loaded rule/state mandate requires it.",
  "For each required question, return Response, Evidence, Status where applicable, and Proof/Reason; optional commentary is interpretive only and must remain concise.",
  "Q4-12 and Q17-20 are critical. Any critical FAIL yields overall FAIL.",
  "Evidence is king: if it is not quoted from the supplied packet, do not treat it as established fact.",
] as const;

export const LEGAL_DESCRIPTION_PROTOCOL = [
  "Apply this protocol whenever legal-description validation is required; do not bypass it based on assumed accuracy.",
  "For metes-and-bounds descriptions, include and parse every THENCE call.",
  "Each boundary call must preserve direction, degrees, minutes, seconds, and distance as shown; no directional or distance segment may be omitted.",
  "Degree notation must use the degree symbol (°), not semicolon, colon, masculine ordinal, or another substitute.",
  "Bearing punctuation/format must remain consistent, for example S 04°24'20\" E.",
  "Decimal precision must use a period rather than a colon, for example 72.7 feet rather than 72:7 feet.",
  "Do not accept substitute special characters in place of standard legal-description symbols.",
  "Verify geometric closure: the sequence must logically return to the Place of Beginning and boundary lines must connect in order.",
  "Compare every legal description against each referenced source instrument actually supplied, including deed and DOT/mortgage when applicable.",
  "If an instrument number is cited for the source legal, compare the legal word-for-word to that instrument.",
  "Omission of a THENCE call, landmark, bearing, direction, or measurement is a material discrepancy and fails legal-description confirmation.",
  "Cross-check every boundary call between the report and source document and identify any source segment missing or altered in the report.",
  "Run a call-sequence comparison to verify that no step is skipped, reordered, or altered.",
  "Classify discrepancies as Material Error, Formatting Error, or Typographical Error. Material errors include omitted calls and missing direction/measurement; formatting errors include wrong symbol/punctuation/numeric notation; typographical errors include misspelled or misrepresented terms/names.",
  "Before approving Q8: parse/log each THENCE call, compare referenced instruments line-by-line, validate symbols/punctuation, confirm logical closure, and flag any deviation or missing legal component.",
  "If a referenced source instrument required for comparison is not supplied or cannot be read, use CANNOT_CONFIRM rather than assuming a match.",
] as const;

export const AUDIT_DOCTRINE = {
  noAssumptions: "Never infer a fact merely because a term is absent. Missing information is a defect only when a governing rule or supplied document explicitly requires it.",
  evidence: "Every supported finding must retain exact source text and physical PDF page provenance. A supported PASS or FAIL without evidence is invalid.",
  initialState: "Every audit question starts UNDETERMINED.",
  cannotConfirm: "When a referenced full document is required for a comparison but is not supplied verbatim or cannot be inspected, use CANNOT_CONFIRM.",
  bidirectional: "Verify Run Sheet to packet and packet to Run Sheet. A referenced recording not found or a recorded packet document omitted from the Run Sheet is a discrepancy.",
  mers: "A DOT naming MERS with a MIN does not require assignments solely because MERS is beneficiary.",
  hoa: "If HOA is not referenced and the selected order type does not require HOA material, mark Not Applicable. Quote HOA name when referenced; report dues only when a lien/document expressly states an amount.",
  legalDescription: "Apply the loaded Legal Description Compliance Protocol to Q8: parse all THENCE calls, preserve bearings/distances/symbols, compare referenced source instruments line-by-line and word-for-word when an instrument number is cited, verify call sequence and logical closure, fail material omissions/alterations, and use CANNOT_CONFIRM when a required referenced source cannot be inspected.",
  plat: "A plat is not automatically required. Apply the selected RCS order-type rule and any authoritative state mandate that has actually been loaded; never invent a mandate.",
  stateLaw: "If a checklist item requires state-law confirmation and no authoritative state rule has been loaded for that issue, do not fabricate one. Mark the state-law dependency for manual verification rather than converting it to an unsupported PASS or FAIL.",
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
  "Title Report Forensic Audit – Quick Reference Checklist supplied by owner on 2026-08-28.",
  ...QUICK_REFERENCE_RULES.map((rule) => `Quick Reference: ${rule}`),
  "Title Report Legal Description Compliance Protocol supplied by owner on 2026-08-28.",
  ...LEGAL_DESCRIPTION_PROTOCOL.map((rule) => `Legal Description Protocol: ${rule}`),
] as const;

export function isSupportedSearchType(value: string): value is SupportedSearchType {
  return (SEARCH_TYPES as readonly string[]).includes(value);
}
