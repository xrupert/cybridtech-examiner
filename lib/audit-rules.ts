export const AUDIT_RULE_VERSION = "CYBRID-AUDIT-CONSTITUTION-2026-08-27";

export const SEARCH_TYPES = [
  "Foreclosure",
  "2nd Lien",
  "2nd Lien Limited",
  "Current Owner Search",
  "Elite Search",
  "General Search",
] as const;

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
  evidence: "Every supported finding must retain exact source text and page provenance. No evidence means Not Stated, Cannot Confirm, or Fail according to applicability; never invent support.",
  initialState: "Every audit question starts UNDETERMINED.",
  cannotConfirm: "When a referenced full document is required for a comparison but is not supplied verbatim, use Cannot Confirm.",
  bidirectional: "Verify Run Sheet to packet and packet to Run Sheet. A referenced recording not found or a recorded document omitted from the Run Sheet is a discrepancy.",
  mers: "A DOT naming MERS with a MIN does not require assignments solely because MERS is beneficiary.",
  hoa: "If HOA is not referenced, mark Not Applicable. Quote HOA name when referenced; report dues only when a lien/document expressly states an amount.",
  legalDescription: "Compare only descriptions actually supplied. Conflicting descriptions fail. If a referenced comparison document is unavailable, Cannot Confirm.",
  plat: "A plat is not automatically required. If referenced, verify inclusion; any state-specific mandate must come from an authoritative rule pack.",
  overall: "Overall Pass requires every applicable critical question to pass. Any critical Fail or Cannot Confirm yields overall Fail.",
} as const;

export const AUTHORITATIVE_RULE_PACKS = [
  "Recovered Title Report Auditor instructions supplied by owner on 2026-08-27",
  "Title Report Forensic Audit – Quick Reference Checklist.docx (awaiting source file)",
  "VERA_Template_v3.3.docx (awaiting source file)",
  "Title Report Legal Description Compliance Protocol.docx (awaiting source file)",
  "RCS Title General Search Requirements by order type.pdf (awaiting source file)",
] as const;
