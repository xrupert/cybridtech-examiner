export type LoanDocumentType = "Deed of Trust" | "Mortgage" | "Other" | "Not Provided";
export type LoanStatus = "Active" | "Default" | "Satisfied" | "Not Provided";
export type PassFail = "Pass" | "Fail";
export type FindingStatus = "UNDETERMINED" | "PASS" | "FAIL" | "CANNOT_CONFIRM" | "NOT_APPLICABLE" | "NOT_STATED";
export type EvidenceSource = "native" | "openai-file" | "pasted";

export interface EvidenceRef {
  quote: string;
  page: number;
  documentType: string;
  source: EvidenceSource;
  sourceFile?: string;
  confidence?: number;
  instrumentNumber?: string;
}

export interface FieldEvidence {
  field: string;
  value: string;
  status: FindingStatus;
  evidence: EvidenceRef[];
  proofReason: string;
}

export interface AuditFinding {
  number: number;
  question: string;
  critical: boolean;
  response: string;
  status: FindingStatus;
  evidence: EvidenceRef[];
  proofReason: string;
  commentary?: string;
}

export interface PageEvidence {
  page: number;
  text: string;
  source: EvidenceSource;
  confidence?: number;
  documentType: string;
}

export interface PacketDocument {
  documentType: string;
  pageStart: number;
  pageEnd: number;
  instrumentNumber?: string;
  recordingDate?: string;
  excerpt: string;
}

export interface MortgageRecord {
  index: number;
  amount: string;
  holder: string;
  date: string;
  bookPage: string;
  instrument: string;
  maturityDate: string;
}

export interface DeedRecord {
  grantor: string;
  grantee: string;
  date: string;
  bookPage: string;
  instrument: string;
  consideration: string;
}

export interface VeraExam {
  state: string;
  county: string;
  searchType: string;
  clientOrder: string;
  propertyAddress: string;
  searchEffectiveDate: string;
  minNumber: string;
  parcelId: string;
  landValue: string;
  improvements: string;
  taxStatus: string;
  fiscalYear: string;
  mobileHome: "Yes" | "No" | "Not Provided";
  condoHoa: "Applicable" | "Not Applicable" | "Not Provided";
  hoaPresent: string;
  ccrs: string;
  hoaNameAmounts: string;
  deedMortgageAccurate: string;
  deed: DeedRecord;
  mortgages: MortgageRecord[];
  recordingsAvailable: string;
  recordingsChronological: string;
  assignmentVesting: string;
  legalDescriptionConfirmed: string;
  legalDescription: string;
  originalBeneficiaryMers: string;
  federalTaxLien: string;
  documentReleases: string;
  propertySecuredAddressMatch: string;
  loanDocumentType: LoanDocumentType;
  recordingDate: string;
  loanStatus: LoanStatus;
  recourse: string;
  typosOrErrors: string;
  platMapLabeled: string;
  minInRunSheet: string;
  runSheetAccurate: string;
  audit: {
    vestingDeed: string;
    chainOfTitle: string;
    mortgageInformation: string;
    taxInformation: string;
    judgmentsAndLiens: string;
    easementsAndRestrictions: string;
  };
  summaryEvidence: FieldEvidence[];
  findings: AuditFinding[];
  pages: PageEvidence[];
  documents: PacketDocument[];
  criticalPassRate: number;
  manualReviewRequired: boolean;
  extractionSummary: string;
  rulePackStatus: string;
  status: PassFail;
  reason: string;
  confirmation: string;
  notes: string;
  sourceFile: string;
  extractedAt: string;
  rawExcerpt: string;
}

export function emptyVera(partial: Partial<VeraExam> = {}): VeraExam {
  return {
    state: "TX",
    county: "Not Stated",
    searchType: "Foreclosure",
    clientOrder: "Not Provided",
    propertyAddress: "Not Provided",
    searchEffectiveDate: "Not Provided",
    minNumber: "Not Provided",
    parcelId: "Not Provided",
    landValue: "Not Provided",
    improvements: "Not Provided",
    taxStatus: "Not Provided",
    fiscalYear: "Not Provided",
    mobileHome: "Not Provided",
    condoHoa: "Not Provided",
    hoaPresent: "Not Provided",
    ccrs: "Not Provided",
    hoaNameAmounts: "Not Provided",
    deedMortgageAccurate: "Not Provided",
    deed: { grantor: "Not Provided", grantee: "Not Provided", date: "Not Provided", bookPage: "Not Provided", instrument: "Not Provided", consideration: "Not Provided" },
    mortgages: [],
    recordingsAvailable: "Not Provided",
    recordingsChronological: "Not Provided",
    assignmentVesting: "Not Provided",
    legalDescriptionConfirmed: "Not Provided",
    legalDescription: "Not Provided",
    originalBeneficiaryMers: "Not Provided",
    federalTaxLien: "Not Provided",
    documentReleases: "Not Provided",
    propertySecuredAddressMatch: "Not Provided",
    loanDocumentType: "Not Provided",
    recordingDate: "Not Provided",
    loanStatus: "Not Provided",
    recourse: "Not Provided",
    typosOrErrors: "Not Provided",
    platMapLabeled: "Not Provided",
    minInRunSheet: "Not Provided",
    runSheetAccurate: "Not Provided",
    audit: { vestingDeed: "Incomplete", chainOfTitle: "Incomplete", mortgageInformation: "Incomplete", taxInformation: "Incomplete", judgmentsAndLiens: "Not Stated", easementsAndRestrictions: "Not Stated" },
    summaryEvidence: [],
    findings: [],
    pages: [],
    documents: [],
    criticalPassRate: 0,
    manualReviewRequired: false,
    extractionSummary: "Not yet examined",
    rulePackStatus: "VERA v3 + RCS Foreclosure/2nd Lien/Current Owner MVP rules loaded. Quick Reference Checklist and Legal Description Compliance Protocol still pending.",
    status: "Fail",
    reason: "Not yet examined",
    confirmation: "The review is not complete.",
    notes: "",
    sourceFile: "upload",
    extractedAt: new Date().toISOString(),
    rawExcerpt: "",
    ...partial,
  };
}

export function formatDeed(d: DeedRecord): string {
  return `${d.grantor} → ${d.grantee}; Date: ${d.date}; Book/Page: ${d.bookPage}; Instrument#: ${d.instrument}; Consideration: ${d.consideration}`;
}

export function formatMortgage(m: MortgageRecord): string {
  return `Mortgage ${m.index}: Amount ${m.amount}; Holder ${m.holder}; Date ${m.date}; Book/Page ${m.bookPage}; Instrument# ${m.instrument}; Maturity ${m.maturityDate}`;
}
