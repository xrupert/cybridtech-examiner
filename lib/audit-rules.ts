export const AUDIT_RULE_VERSION = "CYBRID-VERA3-RCS-QRC-LDP-MCCALLA-FIRST-IN-TIME-2026-08-31";

export const SEARCH_TYPES = [
  "Foreclosure",
  "2nd Lien",
  "Current Owner Search",
  "Two Owner Search",
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
  firstInTime: "Develop lien position from the open encumbrance stack using reliable recording chronology as the baseline. Do not silently treat chronology as final legal priority when federal tax, mechanics/construction, HOA/association, UCC, same-day sequence ambiguity, or another governing priority exception may alter the result.",
  foreclosureProjection: "Order-type QC requirements and foreclosure analysis are separate. Do not create false order defects, but develop lien amount, lien stack, position, senior/junior interests, and cure/action requirements needed for the McCalla export whenever packet evidence permits.",
};
