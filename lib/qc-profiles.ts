export type ProfileCheckId =
  | "CURRENT_OWNER_ESTABLISHED"
  | "PRIOR_OWNER_ESTABLISHED"
  | "OWNERSHIP_CHAIN_COMPLETE"
  | "TARGET_LIEN_FOUND"
  | "TARGET_LIEN_POSITION_ESTABLISHED"
  | "RECORDED_DOCUMENTS_RECONCILE"
  | "RECORDING_ORDER_RECONCILES"
  | "ASSIGNMENT_CHAIN_COMPLETE"
  | "LEGAL_DESCRIPTION_RECONCILES"
  | "FEDERAL_TAX_LIEN_REVIEWED"
  | "RELEASES_RECONCILED"
  | "PROPERTY_IDENTITY_RECONCILES"
  | "MATERIAL_REPORT_ERRORS_REVIEWED"
  | "PLAT_REQUIREMENT_REVIEWED"
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
const DOCUMENTS: QcProfileCheck = { id: "RECORDED_DOCUMENTS_RECONCILE", label: "Required recorded documents are present and reconcile to the title summary", critical: true, category: "Recorded Documents", legacyQuestionNumber: 5 };
const RECORDING_ORDER: QcProfileCheck = { id: "RECORDING_ORDER_RECONCILES", label: "Required recording/chain order reconciles", critical: true, category: "Chain", legacyQuestionNumber: 6 };
const ASSIGNMENTS: QcProfileCheck = { id: "ASSIGNMENT_CHAIN_COMPLETE", label: "Assignment/vesting chain is complete when applicable", critical: true, category: "Assignment", legacyQuestionNumber: 7 };
const LEGAL: QcProfileCheck = { id: "LEGAL_DESCRIPTION_RECONCILES", label: "Legal description reconciles across applicable source documents", critical: true, category: "Legal Description", legacyQuestionNumber: 8 };
const FEDERAL_TAX: QcProfileCheck = { id: "FEDERAL_TAX_LIEN_REVIEWED", label: "Federal tax lien status reviewed", critical: true, category: "Lien", legacyQuestionNumber: 10 };
const RELEASES: QcProfileCheck = { id: "RELEASES_RECONCILED", label: "Applicable releases/satisfactions reconcile", critical: true, category: "Release", legacyQuestionNumber: 11 };
const PROPERTY: QcProfileCheck = { id: "PROPERTY_IDENTITY_RECONCILES", label: "Property identity reconciles across applicable evidence", critical: true, category: "Property", legacyQuestionNumber: 12 };
const REPORT_ERRORS: QcProfileCheck = { id: "MATERIAL_REPORT_ERRORS_REVIEWED", label: "Material title-report errors reviewed against source documents", critical: true, category: "QC", legacyQuestionNumber: 17 };
const PLAT: QcProfileCheck = { id: "PLAT_REQUIREMENT_REVIEWED", label: "Referenced/required plat reviewed", critical: true, category: "Plat", legacyQuestionNumber: 18 };
const RUN_SHEET: QcProfileCheck = { id: "RUN_SHEET_RECONCILES", label: "Distinct Run Sheet/Abstractor Sheet reconciles to source documents when supplied", critical: true, category: "Run Sheet", legacyQuestionNumber: 20 };

const CURRENT_OWNER_CHECKS: QcProfileCheck[] = [
  CURRENT_OWNER,
  CURRENT_OWNER_FVD,
  CURRENT_OWNER_PMM,
  DOCUMENTS,
  RECORDING_ORDER,
  LEGAL,
  PROPERTY,
  REPORT_ERRORS,
  RUN_SHEET,
];

const TWO_OWNER_CHECKS: QcProfileCheck[] = [
  CURRENT_OWNER,
  PRIOR_OWNER,
  OWNERSHIP_CHAIN,
  DOCUMENTS,
  RECORDING_ORDER,
  LEGAL,
  PROPERTY,
  REPORT_ERRORS,
  RUN_SHEET,
];

const SECOND_LIEN_CHECKS: QcProfileCheck[] = [
  CURRENT_OWNER,
  OWNERSHIP_CHAIN,
  DOCUMENTS,
  RECORDING_ORDER,
  LEGAL,
  PROPERTY,
  REPORT_ERRORS,
  RUN_SHEET,
];

const FORECLOSURE_CHECKS: QcProfileCheck[] = [
  CURRENT_OWNER,
  OWNERSHIP_CHAIN,
  TARGET_LIEN,
  TARGET_POSITION,
  DOCUMENTS,
  RECORDING_ORDER,
  ASSIGNMENTS,
  LEGAL,
  FEDERAL_TAX,
  RELEASES,
  PROPERTY,
  REPORT_ERRORS,
  PLAT,
  RUN_SHEET,
];

function profile(id: string, name: string, orderType: string, checks: QcProfileCheck[]): QcProfile {
  return { id, version: 3, name, orderType, checks };
}

export const QC_PROFILES: QcProfile[] = [
  profile("rcs-current-owner-v3", "RCS Current Owner", "Current Owner Search", CURRENT_OWNER_CHECKS),
  profile("ncala-two-owner-v3", "Ncala Two Owner", "Two Owner Search", TWO_OWNER_CHECKS),
  profile("rcs-second-lien-v3", "RCS 2nd Lien", "2nd Lien", SECOND_LIEN_CHECKS),
  profile("rcs-foreclosure-v3", "RCS Foreclosure", "Foreclosure", FORECLOSURE_CHECKS),
];

export const UNRESOLVED_QC_PROFILE: QcProfile = {
  id: "profile-unresolved-v3",
  version: 3,
  name: "QC Profile Requires Examiner Selection",
  orderType: "Needs review",
  unresolved: true,
  checks: FORECLOSURE_CHECKS,
};

export function profileForOrderType(orderType: string): QcProfile {
  return QC_PROFILES.find((item) => item.orderType.toLowerCase() === orderType.trim().toLowerCase()) || UNRESOLVED_QC_PROFILE;
}
