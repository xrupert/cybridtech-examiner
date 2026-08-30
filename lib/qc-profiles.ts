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

const COMMON: QcProfileCheck[] = [
  { id: "CURRENT_OWNER_ESTABLISHED", label: "Current owner/vesting established", critical: true, category: "Ownership" },
  { id: "TARGET_LIEN_FOUND", label: "Target lien identified", critical: true, category: "Foreclosure Lien" },
  { id: "TARGET_LIEN_POSITION_ESTABLISHED", label: "Target lien position established", critical: true, category: "Foreclosure Lien" },
  { id: "RECORDED_DOCUMENTS_RECONCILE", label: "Recorded documents are present and reconcile to the title summary", critical: true, category: "Recorded Documents", legacyQuestionNumber: 5 },
  { id: "RECORDING_ORDER_RECONCILES", label: "Required recording/chain order reconciles", critical: true, category: "Chain", legacyQuestionNumber: 6 },
  { id: "ASSIGNMENT_CHAIN_COMPLETE", label: "Assignment/vesting chain is complete when applicable", critical: true, category: "Assignment", legacyQuestionNumber: 7 },
  { id: "LEGAL_DESCRIPTION_RECONCILES", label: "Legal description reconciles across applicable source documents", critical: true, category: "Legal Description", legacyQuestionNumber: 8 },
  { id: "FEDERAL_TAX_LIEN_REVIEWED", label: "Federal tax lien status reviewed", critical: true, category: "Lien", legacyQuestionNumber: 10 },
  { id: "RELEASES_RECONCILED", label: "Applicable releases/satisfactions reconcile", critical: true, category: "Release", legacyQuestionNumber: 11 },
  { id: "PROPERTY_IDENTITY_RECONCILES", label: "Property/security identity reconciles", critical: true, category: "Property", legacyQuestionNumber: 12 },
  { id: "MATERIAL_REPORT_ERRORS_REVIEWED", label: "Material report errors reviewed", critical: true, category: "QC", legacyQuestionNumber: 17 },
  { id: "PLAT_REQUIREMENT_REVIEWED", label: "Referenced/required plat reviewed", critical: true, category: "Plat", legacyQuestionNumber: 18 },
  { id: "RUN_SHEET_RECONCILES", label: "Functional Run Sheet/title summary reconciles bidirectionally to source documents", critical: true, category: "Run Sheet", legacyQuestionNumber: 20 },
];

function profile(id: string, name: string, orderType: string, extras: QcProfileCheck[] = []): QcProfile {
  return { id, version: 1, name, orderType, checks: [...extras, ...COMMON] };
}

export const QC_PROFILES: QcProfile[] = [
  profile("rcs-current-owner-v1", "RCS Current Owner", "Current Owner Search"),
  profile("ncala-two-owner-v1", "Ncala Two Owner", "Two Owner Search", [
    { id: "PRIOR_OWNER_ESTABLISHED", label: "Prior qualifying owner established", critical: true, category: "Ownership" },
    { id: "OWNERSHIP_CHAIN_COMPLETE", label: "Two-owner conveyance chain is complete", critical: true, category: "Ownership" },
  ]),
  profile("rcs-second-lien-v1", "RCS 2nd Lien", "2nd Lien"),
  profile("rcs-foreclosure-v1", "RCS Foreclosure", "Foreclosure", [
    { id: "OWNERSHIP_CHAIN_COMPLETE", label: "Marketable ownership chain is complete for foreclosure review", critical: true, category: "Ownership" },
  ]),
];

export const UNRESOLVED_QC_PROFILE: QcProfile = {
  id: "profile-unresolved-v1",
  version: 1,
  name: "QC Profile Requires Examiner Selection",
  orderType: "Needs review",
  unresolved: true,
  checks: COMMON,
};

export function profileForOrderType(orderType: string): QcProfile {
  return QC_PROFILES.find((item) => item.orderType.toLowerCase() === orderType.trim().toLowerCase()) || UNRESOLVED_QC_PROFILE;
}
