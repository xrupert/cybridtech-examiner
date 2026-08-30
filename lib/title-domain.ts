import type { EvidenceRef, FindingStatus } from "./vera";

export type EvidenceState = "CONFIRMED" | "UNCONFIRMED" | "NOT_STATED";
export type QcStatus = "PASS" | "FAIL" | "CANNOT_CONFIRM" | "NOT_APPLICABLE";
export type ForeclosureReadiness = "CLEAR" | "QC_DEFICIENCY" | "CURATIVE_REQUIRED" | "CANNOT_CONFIRM";
export type CurativeSeverity = "BLOCKING" | "REVIEW" | "QC" | "INFO";

export interface EvidenceValue<T = string> {
  value: T;
  state: EvidenceState;
  evidence: EvidenceRef[];
  basis: string;
}

export interface CanonicalParty {
  name: string;
  role: string;
  evidence: EvidenceRef[];
}

export interface CanonicalInstrument {
  id: string;
  type: string;
  instrumentNumber: string;
  bookPage: string;
  documentDate: string;
  recordingDate: string;
  amount: string;
  status: string;
  parties: CanonicalParty[];
  legalDescription: string;
  sourcePages: number[];
  evidence: EvidenceRef[];
}

export interface RunSheetSummary {
  detected: boolean;
  confidence: "high" | "medium" | "low";
  pageStart: number | null;
  pageEnd: number | null;
  basis: string;
}

export interface CanonicalTitleRecord {
  schemaVersion: 1;
  recordId: string;
  reviewId: string;
  packetHash: string;
  sourceFile: string;
  clientName: string;
  orderNumber: EvidenceValue;
  tsNumber: EvidenceValue;
  orderType: EvidenceValue;
  effectiveDate: EvidenceValue;
  state: EvidenceValue;
  county: EvidenceValue;
  propertyAddress: EvidenceValue;
  parcelId: EvidenceValue;
  legalDescription: EvidenceValue;
  borrower: EvidenceValue;
  currentOwner: EvidenceValue;
  runSheet: RunSheetSummary;
  instruments: CanonicalInstrument[];
  mortgages: CanonicalInstrument[];
  deeds: CanonicalInstrument[];
  assignments: CanonicalInstrument[];
  releases: CanonicalInstrument[];
  liens: CanonicalInstrument[];
  taxes: {
    status: EvidenceValue;
    fiscalYear: EvidenceValue;
    landValue: EvidenceValue;
    improvements: EvidenceValue;
  };
  targetLien: {
    instrumentId: string | null;
    instrumentNumber: EvidenceValue;
    amount: EvidenceValue;
    beneficiary: EvidenceValue;
    position: EvidenceValue;
    selectionRequired: boolean;
  };
  dataQualityWarnings: string[];
  matterRevision: number;
}

export interface QcCheckResult {
  id: string;
  label: string;
  category: string;
  status: QcStatus;
  severity: CurativeSeverity;
  critical: boolean;
  summary: string;
  recommendedAction: string;
  evidence: EvidenceRef[];
  legacyQuestionNumber?: number;
  sourceStatus?: FindingStatus;
}

export interface CurativeIssue {
  code: string;
  category: string;
  severity: CurativeSeverity;
  title: string;
  recommendedAction: string;
  checkId: string;
  evidence: EvidenceRef[];
}

export interface QcProfileResult {
  profileId: string;
  profileVersion: number;
  profileName: string;
  checks: QcCheckResult[];
  qcStatus: "PASS" | "FAIL" | "REVIEW";
  foreclosureReadiness: ForeclosureReadiness;
  curativeIssues: CurativeIssue[];
  unresolvedCount: number;
}

export interface TitleReviewResult {
  engineVersion: string;
  record: CanonicalTitleRecord;
  qc: QcProfileResult;
  pipeline: {
    stages: readonly ["INGEST", "EXTRACT", "CLASSIFY", "NORMALIZE", "CHECK", "GROUND", "RENDER", "RECORD"];
    completedThrough: "RECORD";
  };
}
