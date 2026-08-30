import type { EvidenceSource } from "./vera";

export interface RawEvidenceAnchor {
  quote: string;
  page: number;
  documentType: string;
  instrumentNumber: string;
  confidence: number;
}

export interface RawFact {
  value: string;
  evidence: RawEvidenceAnchor[];
}

export interface RawParty {
  name: string;
  role: string;
}

export interface RawInstrument {
  type: string;
  instrumentNumber: string;
  bookPage: string;
  documentDate: string;
  recordingDate: string;
  amount: string;
  status: string;
  parties: RawParty[];
  propertyAddress: string;
  legalDescription: string;
  referencedInstrumentNumbers: string[];
  evidence: RawEvidenceAnchor[];
}

export interface RawRunSheetEntry {
  category: string;
  instrumentType: string;
  instrumentNumber: string;
  bookPage: string;
  documentDate: string;
  recordingDate: string;
  amount: string;
  parties: string;
  legalDescription: string;
  evidence: RawEvidenceAnchor[];
}

export interface RawReference {
  description: string;
  documentType: string;
  instrumentNumber: string;
  bookPage: string;
  evidence: RawEvidenceAnchor[];
}

export interface RawTitlePacketExtraction {
  header: {
    orderNumber: RawFact;
    tsNumber: RawFact;
    searchType: RawFact;
    state: RawFact;
    county: RawFact;
    propertyAddress: RawFact;
    parcelId: RawFact;
    effectiveDate: RawFact;
    legalDescription: RawFact;
    borrower: RawFact;
    currentOwner: RawFact;
  };
  runSheet: {
    detected: boolean;
    pageStart: number;
    pageEnd: number;
    basis: string;
    evidence: RawEvidenceAnchor[];
    entries: RawRunSheetEntry[];
  };
  instruments: RawInstrument[];
  references: RawReference[];
  taxes: {
    status: RawFact;
    fiscalYear: RawFact;
    landValue: RawFact;
    improvements: RawFact;
  };
  flags: {
    hoa: RawFact;
    ccrs: RawFact;
    federalTaxLien: RawFact;
    bankruptcy: RawFact;
    plat: RawFact;
    mers: RawFact;
    min: RawFact;
  };
  targetLienHint: {
    instrumentNumber: RawFact;
    position: RawFact;
  };
  extractionSummary: string;
}

export interface EvidenceNode {
  id: string;
  packetHash: string;
  sourceFile: string;
  page: number;
  quote: string;
  documentType: string;
  instrumentNumber?: string;
  source: EvidenceSource;
  confidence: number;
  nativeVerified: boolean;
}

export interface TitleEvidenceLedger {
  version: 1;
  packetHash: string;
  sourceFile: string;
  pageCount: number;
  extractionMode: "native-text" | "openai-pdf-vision" | "pasted-text";
  evidence: EvidenceNode[];
  runSheetPages: number[];
  createdAt: string;
}

export interface ExtractedTitlePacket {
  extraction: RawTitlePacketExtraction;
  ledger: TitleEvidenceLedger;
  model: string;
  modelMs: number;
}
