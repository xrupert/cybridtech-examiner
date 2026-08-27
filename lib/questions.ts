import { VeraExam } from "./vera";

export type Q = {
  id: string;
  section: string;
  prompt: string;
  get: (e: VeraExam) => string;
  set: (e: VeraExam, v: string) => VeraExam;
};

function setTop(key: keyof VeraExam) {
  return (e: VeraExam, v: string): VeraExam => ({ ...e, [key]: v });
}

export const QUESTIONS: Q[] = [
  { id: "searchType", section: "Header", prompt: "Search Type", get: (e) => e.searchType, set: setTop("searchType") },
  { id: "clientOrder", section: "Header", prompt: "Client Order#", get: (e) => e.clientOrder, set: setTop("clientOrder") },
  { id: "propertyAddress", section: "Header", prompt: "Property Address", get: (e) => e.propertyAddress, set: setTop("propertyAddress") },
  { id: "searchEffectiveDate", section: "Header", prompt: "Search Effective Date", get: (e) => e.searchEffectiveDate, set: setTop("searchEffectiveDate") },
  { id: "minNumber", section: "Header", prompt: "MIN# (if applicable)", get: (e) => e.minNumber, set: setTop("minNumber") },
  { id: "parcelId", section: "Property & Tax Information", prompt: "Parcel ID", get: (e) => e.parcelId, set: setTop("parcelId") },
  { id: "landValue", section: "Property & Tax Information", prompt: "Land Value", get: (e) => e.landValue, set: setTop("landValue") },
  { id: "improvements", section: "Property & Tax Information", prompt: "Improvements", get: (e) => e.improvements, set: setTop("improvements") },
  { id: "taxStatus", section: "Property & Tax Information", prompt: "Tax Status", get: (e) => e.taxStatus, set: setTop("taxStatus") },
  { id: "fiscalYear", section: "Property & Tax Information", prompt: "Fiscal Year", get: (e) => e.fiscalYear, set: setTop("fiscalYear") },
  { id: "mobileHome", section: "Property & Tax Information", prompt: "Mobile Home", get: (e) => e.mobileHome, set: setTop("mobileHome") },
  { id: "condoHoa", section: "Property & Tax Information", prompt: "Condo/HOA", get: (e) => e.condoHoa, set: setTop("condoHoa") },
  { id: "hoaPresent", section: "Required Question Responses", prompt: "Is there an HOA or not applicable?", get: (e) => e.hoaPresent, set: setTop("hoaPresent") },
  { id: "ccrs", section: "Required Question Responses", prompt: "Are there Covenants, Conditions, and Restrictions attached or Not Applicable?", get: (e) => e.ccrs, set: setTop("ccrs") },
  { id: "hoaNameAmounts", section: "Required Question Responses", prompt: "Is the HOA name and amounts listed or Not Applicable?", get: (e) => e.hoaNameAmounts, set: setTop("hoaNameAmounts") },
  { id: "deedMortgageAccurate", section: "Required Question Responses", prompt: "Are the Deed/Mortgage amounts and names accurate?", get: (e) => e.deedMortgageAccurate, set: setTop("deedMortgageAccurate") },
  { id: "deedGrantor", section: "Deed", prompt: "Deed — Grantor", get: (e) => e.deed.grantor, set: (e, v) => ({ ...e, deed: { ...e.deed, grantor: v } }) },
  { id: "deedGrantee", section: "Deed", prompt: "Deed — Grantee", get: (e) => e.deed.grantee, set: (e, v) => ({ ...e, deed: { ...e.deed, grantee: v } }) },
  { id: "deedDate", section: "Deed", prompt: "Deed — Date", get: (e) => e.deed.date, set: (e, v) => ({ ...e, deed: { ...e.deed, date: v } }) },
  { id: "deedBook", section: "Deed", prompt: "Deed — Book/Page", get: (e) => e.deed.bookPage, set: (e, v) => ({ ...e, deed: { ...e.deed, bookPage: v } }) },
  { id: "deedInst", section: "Deed", prompt: "Deed — Instrument#", get: (e) => e.deed.instrument, set: (e, v) => ({ ...e, deed: { ...e.deed, instrument: v } }) },
  { id: "deedCons", section: "Deed", prompt: "Deed — Consideration", get: (e) => e.deed.consideration, set: (e, v) => ({ ...e, deed: { ...e.deed, consideration: v } }) },
  { id: "m1amount", section: "Mortgage 1", prompt: "Mortgage 1 — Amount", get: (e) => e.mortgages[0]?.amount || "Not Provided", set: setMort(0, "amount") },
  { id: "m1holder", section: "Mortgage 1", prompt: "Mortgage 1 — Holder", get: (e) => e.mortgages[0]?.holder || "Not Provided", set: setMort(0, "holder") },
  { id: "m1date", section: "Mortgage 1", prompt: "Mortgage 1 — Date", get: (e) => e.mortgages[0]?.date || "Not Provided", set: setMort(0, "date") },
  { id: "m1book", section: "Mortgage 1", prompt: "Mortgage 1 — Book/Page", get: (e) => e.mortgages[0]?.bookPage || "Not Provided", set: setMort(0, "bookPage") },
  { id: "m1inst", section: "Mortgage 1", prompt: "Mortgage 1 — Instrument#", get: (e) => e.mortgages[0]?.instrument || "Not Provided", set: setMort(0, "instrument") },
  { id: "m1mat", section: "Mortgage 1", prompt: "Mortgage 1 — Maturity Date", get: (e) => e.mortgages[0]?.maturityDate || "Not Provided", set: setMort(0, "maturityDate") },
  { id: "recordingsAvailable", section: "Required Question Responses", prompt: "Are all document recordings available and match the report?", get: (e) => e.recordingsAvailable, set: setTop("recordingsAvailable") },
  { id: "recordingsChronological", section: "Required Question Responses", prompt: "Are recordings in chronological order?", get: (e) => e.recordingsChronological, set: setTop("recordingsChronological") },
  { id: "assignmentVesting", section: "Required Question Responses", prompt: "Is assignment vesting accurate or Not Applicable?", get: (e) => e.assignmentVesting, set: setTop("assignmentVesting") },
  { id: "legalDescriptionConfirmed", section: "Required Question Responses", prompt: "Is the legal description confirmed and exact across vesting deed, DOT, and Title Report?", get: (e) => e.legalDescriptionConfirmed, set: setTop("legalDescriptionConfirmed") },
  { id: "legalDescription", section: "Required Question Responses", prompt: "Legal Description", get: (e) => e.legalDescription, set: setTop("legalDescription") },
  { id: "originalBeneficiaryMers", section: "Required Question Responses", prompt: "Is the original beneficiary MERS and is it on beneficiary's line of Deed of Trust or Not Applicable?", get: (e) => e.originalBeneficiaryMers, set: setTop("originalBeneficiaryMers") },
  { id: "federalTaxLien", section: "Required Question Responses", prompt: "Is there a Federal Tax Lien or Not Applicable?", get: (e) => e.federalTaxLien, set: setTop("federalTaxLien") },
  { id: "documentReleases", section: "Required Question Responses", prompt: "Are there any document releases that are showing on the report?", get: (e) => e.documentReleases, set: setTop("documentReleases") },
  { id: "propertySecuredAddressMatch", section: "Required Question Responses", prompt: "Is the property secured and does the Property Address match the Deed of Trust?", get: (e) => e.propertySecuredAddressMatch, set: setTop("propertySecuredAddressMatch") },
  { id: "loanDocumentType", section: "Required Question Responses", prompt: "What is the Loan Document type?", get: (e) => e.loanDocumentType, set: setTop("loanDocumentType") },
  { id: "recordingDate", section: "Required Question Responses", prompt: "What is the Recording Date?", get: (e) => e.recordingDate, set: setTop("recordingDate") },
  { id: "loanStatus", section: "Required Question Responses", prompt: "What is the Loan status, including the notes?", get: (e) => e.loanStatus, set: setTop("loanStatus") },
  { id: "recourse", section: "Required Question Responses", prompt: "Recourse?", get: (e) => e.recourse, set: setTop("recourse") },
  { id: "typosOrErrors", section: "Required Question Responses", prompt: "Are there any typos or errors in the report?", get: (e) => e.typosOrErrors, set: setTop("typosOrErrors") },
  { id: "platMapLabeled", section: "Required Question Responses", prompt: "Is the plat map labeled?", get: (e) => e.platMapLabeled, set: setTop("platMapLabeled") },
  { id: "minInRunSheet", section: "Required Question Responses", prompt: "Is the MIN# in the run sheet?", get: (e) => e.minInRunSheet, set: setTop("minInRunSheet") },
  { id: "runSheetAccurate", section: "Required Question Responses", prompt: "Is the Run Sheet accurate?", get: (e) => e.runSheetAccurate, set: setTop("runSheetAccurate") },
  { id: "auditVesting", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Vesting Deed Information", get: (e) => e.audit.vestingDeed, set: setAudit("vestingDeed") },
  { id: "auditChain", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Chain of Title", get: (e) => e.audit.chainOfTitle, set: setAudit("chainOfTitle") },
  { id: "auditMort", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Mortgage Information", get: (e) => e.audit.mortgageInformation, set: setAudit("mortgageInformation") },
  { id: "auditTax", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Tax Information", get: (e) => e.audit.taxInformation, set: setAudit("taxInformation") },
  { id: "auditLiens", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Judgments and Liens", get: (e) => e.audit.judgmentsAndLiens, set: setAudit("judgmentsAndLiens") },
  { id: "auditEase", section: "Title Report / Run Sheet Accuracy Audit", prompt: "Easements and Restrictions", get: (e) => e.audit.easementsAndRestrictions, set: setAudit("easementsAndRestrictions") },
  { id: "status", section: "Pass/Fail Determination", prompt: "Status (Pass or Fail)", get: (e) => e.status, set: setTop("status") },
  { id: "reason", section: "Pass/Fail Determination", prompt: "Reason", get: (e) => e.reason, set: setTop("reason") },
  { id: "confirmation", section: "Pass/Fail Determination", prompt: "Confirmation", get: (e) => e.confirmation, set: setTop("confirmation") },
  { id: "notes", section: "Notes / Comments", prompt: "Notes / Comments (Optional)", get: (e) => e.notes, set: setTop("notes") },
];

function setAudit(key: keyof VeraExam["audit"]) {
  return (e: VeraExam, v: string): VeraExam => ({ ...e, audit: { ...e.audit, [key]: v } });
}

function setMort(index: number, key: "amount" | "holder" | "date" | "bookPage" | "instrument" | "maturityDate") {
  return (e: VeraExam, v: string): VeraExam => {
    const mortgages = [...e.mortgages];
    if (!mortgages[index]) {
      mortgages[index] = { index: index + 1, amount: "Not Provided", holder: "Not Provided", date: "Not Provided", bookPage: "Not Provided", instrument: "Not Provided", maturityDate: "Not Provided" };
    }
    mortgages[index] = { ...mortgages[index], [key]: v, index: index + 1 };
    return { ...e, mortgages };
  };
}
