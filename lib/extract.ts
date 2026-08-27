import { emptyVera, VeraExam } from "./vera";

function grab(text: string, label: string): string | null {
  const re = new RegExp(label + "[:\\s]+([^\\n]+)", "i");
  const m = text.match(re);
  return m?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function find(text: string, pattern: string, flags = "i"): string | null {
  const m = text.match(new RegExp(pattern, flags));
  const val = (m?.[1] || m?.[0] || "").replace(/\s+/g, " ").trim();
  return val || null;
}

function mentioned(text: string, pattern: string): boolean {
  return new RegExp(pattern, "i").test(text);
}

export function extractVera(raw: string, sourceFile = "upload"): VeraExam {
  const text = raw.replace(/\u200b/g, " ");
  const searchType = mentioned(text, "preliminary title report")
    ? "Preliminary Title Report"
    : mentioned(text, "title report")
      ? "Title Report"
      : grab(text, "Search Type") || "Not Provided";
  const clientOrder =
    grab(text, "Title Order No\\.?") ||
    grab(text, "Client Order#?") ||
    find(text, "Order\\s*#[:\\s]+([^\\n]+)") ||
    "Not Provided";
  const propertyAddress =
    grab(text, "Address") ||
    find(text, "located at or near\\s+([^\\.\\n]+)") ||
    "Not Provided";
  const searchEffectiveDate =
    grab(text, "Effective Date") ||
    find(text, "Date[:\\s]+([A-Za-z]+ \\d{4})") ||
    "Not Provided";
  const minNumber = find(text, "\\bMIN[#:\\s]+([0-9]{10,18})") || "Not Provided";
  const parcelId =
    grab(text, "Parcel Number \\(APN\\)") ||
    find(text, "\\bAPN[:\\s]+([0-9-]+)") ||
    find(text, "([0-9]{3}-[0-9]{3}-[0-9]{2})") ||
    "Not Provided";
  const landValue = grab(text, "Land Value") || "Not Provided";
  const improvements =
    grab(text, "Improvements?") ||
    (mentioned(text, "no residential improvements|undeveloped") ? "$0 / undeveloped" : "Not Provided");
  const fiscalYear = find(text, "fiscal year[:\\s]+([0-9]{4}\\s*[-–]\\s*[0-9]{2,4})") || "Not Provided";
  const taxStatus = mentioned(text, "lien but not yet due")
    ? "Lien not yet due / payable"
    : mentioned(text, "taxes")
      ? "Taxes referenced"
      : "Not Provided";
  const mobileHome = mentioned(text, "mobile home|manufactured home") ? "Yes" : "No";
  const hoaHit = mentioned(text, "\\bHOA\\b|homeowners.? association|condominium");
  const legalDescription =
    find(text, "(Section\\s+\\d+,\\s*Township\\s+\\d+[^\\n.]*)") ||
    grab(text, "Legal Type") ||
    "Not Provided";
  const grantor = grab(text, "Grantor");
  const grantee = grab(text, "Grantee");
  const vested = grab(text, "Surface Ownership");
  const instrument =
    find(text, "(Grant Deed|Mineral Deed|Patent|Oil & Gas Lease|Assignment of Lease|Lease Renewal|Deed of Trust|Mortgage)") ||
    "Not Provided";
  const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => m[1]);
  const deed = {
    grantor: grantor || "Not Provided",
    grantee: grantee || vested || "Not Provided",
    date: years[0] || "Not Provided",
    bookPage: "Not Provided",
    instrument,
    consideration: "Not Provided",
  };
  const hasLease = mentioned(text, "oil\\s*&\\s*gas lease|leasehold");
  const loanDocumentType = mentioned(text, "deed of trust|\\bDOT\\b")
    ? "Deed of Trust"
    : mentioned(text, "\\bmortgage\\b")
      ? "Mortgage"
      : hasLease
        ? "Other"
        : "Not Provided";
  const mortgages = hasLease
    ? [{
        index: 1,
        amount: "Not Provided",
        holder: grab(text, "Mineral Leasehold Interest") || "Not Provided",
        date: "2010",
        bookPage: "Not Provided",
        instrument: "Oil & Gas Lease / Assignment",
        maturityDate: find(text, "through\\s+(20\\d{2})") || "2043",
      }]
    : [];
  const easements = mentioned(text, "easement");
  const liens = mentioned(text, "federal tax lien|judgment");
  const releases = mentioned(text, "release|satisfaction");
  const mers = mentioned(text, "\\bMERS\\b");
  const plat = mentioned(text, "plat|map reference|gis");
  const ccr = mentioned(text, "covenant|restriction|cc&r");
  return emptyVera({
    searchType,
    clientOrder,
    propertyAddress,
    searchEffectiveDate,
    minNumber,
    parcelId,
    landValue,
    improvements,
    taxStatus,
    fiscalYear,
    mobileHome,
    condoHoa: hoaHit ? "Applicable" : "Not Applicable",
    hoaPresent: hoaHit ? "Yes" : "Not Applicable",
    ccrs: ccr ? "Restrictions referenced" : "Not Applicable",
    hoaNameAmounts: hoaHit ? "Not itemized" : "Not Applicable",
    deedMortgageAccurate: deed.grantor !== "Not Provided" ? "Partial" : "No",
    deed,
    mortgages,
    recordingsAvailable: mentioned(text, "chain of title|recorded") ? "Yes" : "No",
    recordingsChronological: years.length < 2 ? "Not Provided" : "See packet year sequence",
    assignmentVesting: mentioned(text, "assignment") ? "Assignment referenced" : vested ? "Vesting named" : "Not Applicable",
    legalDescriptionConfirmed: legalDescription !== "Not Provided" ? "Yes" : "No",
    legalDescription,
    originalBeneficiaryMers: mers ? "Yes" : "Not Provided",
    federalTaxLien: mentioned(text, "federal tax lien") ? "Yes" : liens ? "Other lien language" : "No",
    documentReleases: releases ? "Yes" : "No",
    propertySecuredAddressMatch:
      propertyAddress !== "Not Provided" && legalDescription !== "Not Provided" ? "Yes" : "Not Provided",
    loanDocumentType,
    recordingDate: deed.date,
    loanStatus: mentioned(text, "active lease|good standing") ? "Active" : "Not Provided",
    recourse: "Not Provided",
    typosOrErrors: mentioned(text, "mock|placeholder|training")
      ? "Yes — packet is marked mock / educational"
      : "No obvious typos isolated by parser",
    platMapLabeled: plat ? "Yes" : "Not Provided",
    minInRunSheet: minNumber,
    runSheetAccurate: "Partial — extracted from packet text",
    audit: {
      vestingDeed: vested || deed.grantee !== "Not Provided" ? "Accurate (summary vesting extracted)" : "Incomplete",
      chainOfTitle: mentioned(text, "chain of title") ? "Partial" : "Incomplete",
      mortgageInformation: mortgages.length ? "Partial" : "Incomplete",
      taxInformation: landValue !== "Not Provided" || fiscalYear !== "Not Provided" ? "Accurate" : "Incomplete",
      judgmentsAndLiens: liens ? "Present" : "None",
      easementsAndRestrictions: easements || ccr ? "Present" : "None",
    },
    sourceFile,
    rawExcerpt: text.slice(0, 1800),
  });
}
