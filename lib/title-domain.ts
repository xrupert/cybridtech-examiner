import type { EvidenceRef, FindingStatus } from "./vera";

export type EvidenceState = "CONFIRMED" | "UNCONFIRMED" | "NOT_STATED";
export type QcStatus = "PASS" | "FAIL" | "CANNOT_CONFIRM" | "NOT_APPLICABLE";
export type ForeclosureReadiness = "CLEAR" | "QC_DEFICIENCY" | "CURATIVE_REQUIRED" | "CANNOT_CONFIRM";
export type CurativeSeverity = "BLOCKING" | "REVIEW" | "QC" | "INFO";
export type LienPriorityBasis = "EXPLICIT" | "FIRST_IN_TIME" | "UNRESOLVED";
export type LienPriorityConfidence = "high" | "medium" | "low";
export type ForeclosureRequirementType = "CURE" | "PRIORITY_REVIEW" | "PAYOFF_REVIEW" | "NOTICE_REVIEW" | "EVIDENCE";

export interface EvidenceValue<T = string> {
  value: T;
  state: EvidenceState;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
  basis: string;
}

export interface CanonicalParty {
  name: string;
  role: string;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
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
  propertyAddress: string;
  legalDescription: string;
  referencedInstrumentNumbers: string[];
  sourcePages: number[];
  evidence: EvidenceRef[];
  evidenceIds?: string[];
}

export interface CanonicalRunSheetEntry {
  id: string;
  category: string;
  instrumentType: string;
  instrumentNumber: string;
  bookPage: string;
  documentDate: string;
  recordingDate: string;
  amount: string;
  parties: string;
  legalDescription: string;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
}

export interface CanonicalReference {
  description: string;
  documentType: string;
  instrumentNumber: string;
  bookPage: string;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
}

export interface RunSheetSummary {
  detected: boolean;
  confidence: "high" | "medium" | "low";
  pageStart: number | null;
  pageEnd: number | null;
  basis: string;
  entries: CanonicalRunSheetEntry[];
  evidence: EvidenceRef[];
  evidenceIds?: string[];
}

export interface CanonicalLienStackEntry {
  instrumentId: string;
  instrumentType: string;
  instrumentNumber: string;
  amount: string;
  recordingDate: string;
  holder: string;
  status: "OPEN" | "RELEASED" | "UNKNOWN";
  chronologicalPosition: number | null;
  positionLabel: string;
  priorityBasis: LienPriorityBasis;
  priorityConfidence: LienPriorityConfidence;
  priorityWarning: string;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
}

export interface ForeclosureRequirement {
  code: string;
  type: ForeclosureRequirementType;
  severity: CurativeSeverity;
  title: string;
  action: string;
  evidence: EvidenceRef[];
  evidenceIds?: string[];
  scope?: "TITLE_PACKAGE" | "FORECLOSURE_PROCESS";
  jurisdiction?: string;
  authority?: string;
  authorityUrl?: string;
  ruleVersion?: string;
}

export interface JurisdictionCoverage {
  state: string;
  county: string;
  status: "CURATED" | "GENERAL_ONLY" | "UNAVAILABLE";
  ruleSetVersion: string;
  note: string;
}

export interface ForeclosureAnalysis {
  method: "FIRST_IN_TIME_WITH_EXCEPTION_GATES";
  status: "READY" | "REVIEW" | "CURATIVE_REQUIRED";
  targetInstrumentId: string | null;
  targetAmount: string;
  targetPosition: string;
  targetPositionBasis: LienPriorityBasis;
  targetPositionConfidence: LienPriorityConfidence;
  seniorLienIds: string[];
  juniorLienIds: string[];
  openLienCount: number;
  lienStack: CanonicalLienStackEntry[];
  requirements: ForeclosureRequirement[];
  jurisdictionCoverage?: JurisdictionCoverage;
}

export interface CanonicalTitleRecord {
  schemaVersion: 2;
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
  /** Opening title-report/title-search summary used for report-to-source reconciliation and, for RCS Exceptions-style reports, the applicable report run sheet. */
  titleSummary: RunSheetSummary;
  /** A distinct supplied Run Sheet or Abstractor Sheet only; it remains separate from the RCS title-report Exceptions summary. */
  runSheet: RunSheetSummary;
  instruments: CanonicalInstrument[];
  mortgages: CanonicalInstrument[];
  deeds: CanonicalInstrument[];
  assignments: CanonicalInstrument[];
  releases: CanonicalInstrument[];
  liens: CanonicalInstrument[];
  references: CanonicalReference[];
  flags: {
    hoa: EvidenceValue;
    ccrs: EvidenceValue;
    federalTaxLien: EvidenceValue;
    bankruptcy: EvidenceValue;
    plat: EvidenceValue;
    mers: EvidenceValue;
    min: EvidenceValue;
  };
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
    positionBasis: LienPriorityBasis;
    positionConfidence: LienPriorityConfidence;
    selectionRequired: boolean;
  };
  foreclosureAnalysis: ForeclosureAnalysis;
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
  evidenceIds?: string[];
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
  evidenceIds?: string[];
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
