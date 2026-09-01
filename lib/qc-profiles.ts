export type ProfileCheckId =
  | "CURRENT_OWNER_ESTABLISHED"
  | "PRIOR_OWNER_ESTABLISHED"
  | "OWNERSHIP_CHAIN_COMPLETE"
  | "TARGET_LIEN_FOUND"
  | "TARGET_LIEN_POSITION_ESTABLISHED"
  | "HOA_STATUS_REVIEWED"
  | "CCRS_REVIEWED"
  | "HOA_NAME_AMOUNTS_REVIEWED"
  | "DEED_MORTGAGE_ACCURACY"
  | "RECORDED_DOCUMENTS_RECONCILE"
  | "RECORDING_ORDER_RECONCILES"
  | "ASSIGNMENT_CHAIN_COMPLETE"
  | "LEGAL_DESCRIPTION_RECONCILES"
  | "MERS_BENEFICIARY_REVIEWED"
  | "FEDERAL_TAX_LIEN_REVIEWED"
  | "RELEASES_RECONCILED"
  | "PROPERTY_IDENTITY_RECONCILES"
  | "LOAN_DOCUMENT_TYPE_REVIEWED"
  | "LOAN_RECORDING_DATE_REVIEWED"
  | "LOAN_STATUS_REVIEWED"
  | "RECOURSE_REVIEWED"
  | "MATERIAL_REPORT_ERRORS_REVIEWED"
  | "PLAT_REQUIREMENT_REVIEWED"
  | "MIN_RUN_SHEET_REVIEWED"
  | "RUN_SHEET_RECONCILES";

export interface QcProfileCheck {
  id: ProfileCheckId;
  label: string;
  critical: boolean;
  category: string;
  legacyQuestionNumber?: number;
}

export interface QcProfile {
  id: string;
  version: number;
  name: string;
  orderType: string;
  checks: QcProfileCheck[];
  unresolved?: boolean;
}

const CURRENT_OWNER: QcProfileCheck = { id: "CURRENT_OWNER_ESTABLISHED", label: "Current owner/vesting established", critical: true, category: "Ownership" };
const PRIOR_OWNER: QcProfileCheck = { id: "PRIOR_OWNER_ESTABLISHED", label: "Prior qualifying owner/deed established", critical: true, category: "Ownership" };
const OWNERSHIP_CHAIN: QcProfileCheck = { id: "OWNERSHIP_CHAIN_COMPLETE", label: "Required ownership/conveyance chain is complete", critical: true, category: "Ownership" };
const CURRENT_OWNER_FVD: QcProfileCheck = { id: "PRIOR_OWNER_ESTABLISHED", label: "Qualifying non-family full-value deed established with recording date, amount, and vesting", critical: true, category: "Current Owner Search" };
const CURRENT_OWNER_PMM: QcProfileCheck = { id: "OWNERSHIP_CHAIN_COMPLETE", label: "Qualifying full-value deed has a concurrently filed institutional purchase-money mortgage", critical: true, category: "Current Owner Search" };
const TARGET_LIEN: QcProfileCheck = { id: "TARGET_LIEN_FOUND", label: "Foreclosure target lien identified", critical: true, category: "Foreclosure Lien" };
const TARGET_POSITION: QcProfileCheck = { id: "TARGET_LIEN_POSITION_ESTABLISHED", label: "Foreclosure target lien position established", critical: true, category: "Foreclosure Lien" };

const HOA: QcProfileCheck = { id: "HOA_STATUS_REVIEWED", label: "Is there an HOA or is HOA not applicable?", critical: false, category: "Vera 20", legacyQuestionNumber: 1 };
const CCRS: QcProfileCheck = { id: "CCRS_REVIEWED", label: "Are Covenants, Conditions, and Restrictions attached or not applicable?", critical: false, category: "Vera 20", legacyQuestionNumber: 2 };
const HOA_DETAILS: QcProfileCheck = { id: "HOA_NAME_AMOUNTS_REVIEWED", label: "Is the HOA name and amount information listed or not applicable?", critical: false, category: "Vera 20", legacyQuestionNumber: 3 };
const DEED_MORTGAGE: QcProfileCheck = { id: "DEED_MORTGAGE_ACCURACY", label: "Are deed/mortgage amounts and party names accurate?", critical: true, category: "Vera 20", legacyQuestionNumber: 4 };
const DOCUMENTS: QcProfileCheck = { id: "RECORDED_DOCUMENTS_RECONCILE", label: "Are all required document recordings available and do they match the report?", critical: true, category: "Vera 20", legacyQuestionNumber: 5 };
const RECORDING_ORDER: QcProfileCheck = { id: "RECORDING_ORDER_RECONCILES", label: "Are recordings in the required chronological/chain order?", critical: true, category: "Vera 20", legacyQuestionNumber: 6 };
const ASSIGNMENTS: QcProfileCheck = { id: "ASSIGNMENT_CHAIN_COMPLETE", label: "Is assignment vesting accurate or not applicable?", critical: true, category: "Vera 20", legacyQuestionNumber: 7 };
const LEGAL: QcProfileCheck = { id: "LEGAL_DESCRIPTION_RECONCILES", label: "Is the legal description exact across applicable title, deed, and security documents?", critical: true, category: "Vera 20", legacyQuestionNumber: 8 };
const MERS: QcProfileCheck = { id: "MERS_BENEFICIARY_REVIEWED", label: "Is the original beneficiary MERS and correctly shown on the security instrument, or not applicable?", critical: false, category: "Vera 20", legacyQuestionNumber: 9 };
const FEDERAL_TAX: QcProfileCheck = { id: "FEDERAL_TAX_LIEN_REVIEWED", label: "Is there a Federal Tax Lien or is it not applicable?", critical: true, category: "Vera 20", legacyQuestionNumber: 10 };
const RELEASES: QcProfileCheck = { id: "RELEASES_RECONCILED", label: "Do applicable releases/satisfactions shown on the report reconcile to source documents?", critical: true, category: "Vera 20", legacyQuestionNumber: 11 };
const PROPERTY: QcProfileCheck = { id: "PROPERTY_IDENTITY_RECONCILES", label: "Is the property secured and does the property identity/address match the security instrument?", critical: true, category: "Vera 20", legacyQuestionNumber: 12 };
const LOAN_TYPE: QcProfileCheck = { id: "LOAN_DOCUMENT_TYPE_REVIEWED", label: "What is the controlling loan document type?", critical: false, category: "Vera 20", legacyQuestionNumber: 13 };
const LOAN_RECORDING: QcProfileCheck = { id: "LOAN_RECORDING_DATE_REVIEWED", label: "What is the controlling loan recording date?", critical: false, category: "Vera 20", legacyQuestionNumber: 14 };
const LOAN_STATUS: QcProfileCheck = { id: "LOAN_STATUS_REVIEWED", label: "What is the loan/lien status, including applicable default or satisfaction notes?", critical: true, category: "Vera 20", legacyQuestionNumber: 15 };
const RECOURSE: QcProfileCheck = { id: "RECOURSE_REVIEWED", label: "Is recourse status established or not provided?", critical: false, category: "Vera 20", legacyQuestionNumber: 16 };
const REPORT_ERRORS: QcProfileCheck = { id: "MATERIAL_REPORT_ERRORS_REVIEWED", label: "Are there any typos or material errors in the report?", critical: true, category: "Vera 20", legacyQuestionNumber: 17 };
const PLAT: QcProfileCheck = { id: "PLAT_REQUIREMENT_REVIEWED", label: "Is the referenced/required plat map supplied and correctly labeled?", critical: false, category: "Vera 20", legacyQuestionNumber: 18 };
const MIN: QcProfileCheck = { id: "MIN_RUN_SHEET_REVIEWED", label: "Is the MIN shown in the applicable report/run-sheet summary, or not applicable?", critical: false, category: "Vera 20", legacyQuestionNumber: 19 };
const RUN_SHEET: QcProfileCheck = { id: "RUN_SHEET_RECONCILES", label: "Is the applicable report run sheet / Exceptions summary or separate Abstractor Sheet accurate?", critical: true, category: "Vera 20", legacyQuestionNumber: 20 };

export const VERA_20_CHECKS: QcProfileCheck[] = [
  HOA, CCRS, HOA_DETAILS, DEED_MORTGAGE, DOCUMENTS, RECORDING_ORDER, ASSIGNMENTS, LEGAL, MERS, FEDERAL_TAX,
  RELEASES, PROPERTY, LOAN_TYPE, LOAN_RECORDING, LOAN_STATUS, RECOURSE, REPORT_ERRORS, PLAT, MIN, RUN_SHEET,
];

const GENERIC_TITLE_REVIEW_CHECKS: QcProfileCheck[] = [CURRENT_OWNER, ...VERA_20_CHECKS];
const CURRENT_OWNER_CHECKS: QcProfileCheck[] = [CURRENT_OWNER, CURRENT_OWNER_FVD, CURRENT_OWNER_PMM, ...VERA_20_CHECKS];
const TWO_OWNER_CHECKS: QcProfileCheck[] = [CURRENT_OWNER, PRIOR_OWNER, OWNERSHIP_CHAIN, ...VERA_20_CHECKS];
const SECOND_LIEN_CHECKS: QcProfileCheck[] = [CURRENT_OWNER, OWNERSHIP_CHAIN, ...VERA_20_CHECKS];
const FORECLOSURE_CHECKS: QcProfileCheck[] = [CURRENT_OWNER, OWNERSHIP_CHAIN, TARGET_LIEN, TARGET_POSITION, ...VERA_20_CHECKS];

function profile(id: string, name: string, orderType: string, checks: QcProfileCheck[]): QcProfile {
  return { id, version: 4, name, orderType, checks };
}

export const QC_PROFILES: QcProfile[] = [
  profile("vera-one-owner-generic-v4", "One Owner · Vera 20 (no loaded order-specific rule pack)", "One Owner Search", GENERIC_TITLE_REVIEW_CHECKS),
  profile("rcs-current-owner-v4", "RCS Current Owner", "Current Owner Search", CURRENT_OWNER_CHECKS),
  profile("ncala-two-owner-v4", "Ncala Two Owner", "Two Owner Search", TWO_OWNER_CHECKS),
  profile("rcs-second-lien-v4", "RCS 2nd Lien", "2nd Lien", SECOND_LIEN_CHECKS),
  profile("rcs-foreclosure-v4", "RCS Foreclosure", "Foreclosure", FORECLOSURE_CHECKS),
];

export const UNRESOLVED_QC_PROFILE: QcProfile = {
  id: "profile-unresolved-v4",
  version: 4,
  name: "Vera 20 Generic · Order-Specific Rule Pack Not Loaded",
  orderType: "Needs review",
  unresolved: true,
  checks: GENERIC_TITLE_REVIEW_CHECKS,
};

export function profileForOrderType(orderType: string): QcProfile {
  return QC_PROFILES.find((item) => item.orderType.toLowerCase() === orderType.trim().toLowerCase()) || UNRESOLVED_QC_PROFILE;
}
