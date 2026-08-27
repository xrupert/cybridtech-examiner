import { AUDIT_RULE_VERSION, CRITICAL_QUESTION_NUMBERS, REQUIRED_QUESTIONS } from "./audit-rules";
import { AuditFinding, EvidenceRef, PageEvidence, PacketDocument, VeraExam, emptyVera } from "./vera";

export type ExtractOptions = { state?: string; searchType?: string; sourceFile?: string };

function clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function normalize(value: string): string { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function mentioned(text: string, pattern: string): boolean { return new RegExp(pattern, "i").test(text); }

function classifyPage(text: string): string {
  const t = text.toLowerCase();
  if (/run\s*sheet|document\s+index|chain\s+of\s+title|search\s+results/.test(t)) return "Run Sheet / Title Report";
  if (/deed of trust|security instrument|mortgage deed/.test(t)) return "Deed of Trust / Mortgage";
  if (/assignment of (mortgage|deed of trust)|assignor|assignee/.test(t)) return "Assignment";
  if (/release of (mortgage|deed of trust|lien)|satisfaction|reconveyance/.test(t)) return "Release / Satisfaction";
  if (/warranty deed|special warranty deed|grant deed|quitclaim deed|vesting deed/.test(t)) return "Deed";
  if (/federal tax lien|judgment lien|mechanic.?s lien|claim of lien/.test(t)) return "Lien / Judgment";
  if (/plat|subdivision map|map book/.test(t)) return "Plat / Map";
  if (/homeowners.? association|\bhoa\b|condominium association/.test(t)) return "HOA / Association";
  if (/tax parcel|assessed value|property tax|tax status/.test(t)) return "Tax";
  if (/title report|preliminary report|property information/.test(t)) return "Title Report";
  return "Other";
}

function extractInstrument(text: string): string | undefined {
  const match = text.match(/(?:instrument|document|doc(?:ument)?\s*(?:no|number)|recording)\s*[#:.\-]*\s*([A-Z0-9-]{5,30})/i);
  return match?.[1] ? clean(match[1]) : undefined;
}

function extractDate(text: string): string | undefined {
  const match = text.match(/(?:recorded|recording date|filed)\s*(?:on|:)?\s*((?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}|[A-Z][a-z]+\s+\d{1,2},\s+(?:19|20)\d{2})/i);
  return match?.[1] ? clean(match[1]) : undefined;
}

function evidenceFor(page: PageEvidence, quote: string): EvidenceRef {
  return { quote: clean(quote), page: page.page, documentType: page.documentType, source: page.source, confidence: page.confidence, instrumentNumber: extractInstrument(page.text) };
}

function firstEvidence(pages: PageEvidence[], patterns: RegExp[]): EvidenceRef | undefined {
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/).filter(Boolean);
    for (const pattern of patterns) {
      for (const line of lines) {
        if (pattern.test(line)) return evidenceFor(page, line);
        pattern.lastIndex = 0;
      }
    }
  }
  return undefined;
}

function allEvidence(pages: PageEvidence[], pattern: RegExp): EvidenceRef[] {
  const hits: EvidenceRef[] = [];
  for (const page of pages) {
    for (const line of page.text.split(/\r?\n/).filter(Boolean)) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) hits.push(evidenceFor(page, line));
    }
  }
  return hits.slice(0, 12);
}

function valueAfterLabel(evidence: EvidenceRef | undefined, label: RegExp): string {
  if (!evidence) return "Not Provided";
  const value = evidence.quote.replace(label, "").replace(/^\s*[:#-]\s*/, "").trim();
  return value || evidence.quote;
}

function findLegalDescription(page: PageEvidence): EvidenceRef | undefined {
  const text = page.text;
  const marker = /legal description\s*[:\-]?/i.exec(text);
  if (!marker) return undefined;
  const start = marker.index + marker[0].length;
  const excerpt = clean(text.slice(start, start + 700));
  return excerpt ? evidenceFor(page, excerpt) : undefined;
}

function makeDocuments(pages: PageEvidence[]): PacketDocument[] {
  return pages.map((page) => ({ documentType: page.documentType, pageStart: page.page, pageEnd: page.page, instrumentNumber: extractInstrument(page.text), recordingDate: extractDate(page.text), excerpt: clean(page.text).slice(0, 240) }));
}

function finding(number: number, response: string, status: AuditFinding["status"], evidence: EvidenceRef[], proofReason: string, commentary?: string): AuditFinding {
  return { number, question: REQUIRED_QUESTIONS[number - 1], critical: CRITICAL_QUESTION_NUMBERS.has(number), response, status, evidence, proofReason, commentary };
}

function instrumentsFrom(pages: PageEvidence[]): Set<string> {
  const values = new Set<string>();
  for (const page of pages) {
    for (const match of page.text.matchAll(/(?:instrument|document|doc(?:ument)?\s*(?:no|number)|recording)\s*[#:.\-]*\s*([A-Z0-9-]{5,30})/gi)) {
      if (match[1]) values.add(match[1].toUpperCase());
    }
  }
  return values;
}

function runSheetAudit(pages: PageEvidence[]): { response: string; status: AuditFinding["status"]; evidence: EvidenceRef[]; reason: string } {
  const runPages = pages.filter((page) => /Run Sheet/.test(page.documentType));
  if (!runPages.length) return { response: "Cannot Confirm", status: "CANNOT_CONFIRM", evidence: [], reason: "No identifiable Run Sheet / document index was supplied for bidirectional verification." };
  const packetPages = pages.filter((page) => !/Run Sheet/.test(page.documentType));
  const run = instrumentsFrom(runPages);
  const docs = instrumentsFrom(packetPages);
  const missing = [...run].filter((value) => !docs.has(value));
  const extra = [...docs].filter((value) => !run.has(value));
  const ev = runPages.flatMap((page) => allEvidence([page], /instrument|document|recording/i)).slice(0, 8);
  if (missing.length || extra.length) {
    const parts = [missing.length ? `Run Sheet instruments not found in packet: ${missing.join(", ")}` : "", extra.length ? `Packet instruments not found on Run Sheet: ${extra.join(", ")}` : ""].filter(Boolean);
    return { response: "No", status: "FAIL", evidence: ev, reason: parts.join("; ") };
  }
  if (!run.size) return { response: "Cannot Confirm", status: "CANNOT_CONFIRM", evidence: ev, reason: "Run Sheet was identified, but no instrument numbers could be reliably parsed for bidirectional matching." };
  return { response: "Yes", status: "PASS", evidence: ev, reason: `${run.size} parsed Run Sheet instrument number(s) matched the supplied packet inventory in both directions.` };
}

export function extractVeraFromPages(inputPages: PageEvidence[], options: ExtractOptions = {}): VeraExam {
  const pages = inputPages.map((page) => ({ ...page, documentType: classifyPage(page.text) }));
  const sourceFile = options.sourceFile || "upload";
  const allText = pages.map((page) => page.text).join("\n");
  const clientOrderEv = firstEvidence(pages, [/client order/i, /title order/i, /order\s*#/i]);
  const addressEv = firstEvidence(pages, [/property address/i, /^address\s*[:#-]/i, /located at or near/i]);
  const effectiveEv = firstEvidence(pages, [/effective date/i, /search date/i]);
  const minEv = firstEvidence(pages, [/\bMIN\s*#?\s*[:#-]?\s*\d{8,20}/i]);
  const parcelEv = firstEvidence(pages, [/parcel(?: id| number)?/i, /\bAPN\b/i]);
  const landEv = firstEvidence(pages, [/land value/i]);
  const improveEv = firstEvidence(pages, [/improvements?/i]);
  const taxEv = firstEvidence(pages, [/tax status/i, /taxes .* due/i]);
  const fiscalEv = firstEvidence(pages, [/fiscal year/i, /tax year/i]);
  const countyEv = firstEvidence(pages, [/\bcounty\b/i]);

  const hoaEvidence = allEvidence(pages, /\bHOA\b|homeowners.? association|condominium association/i);
  const ccrEvidence = allEvidence(pages, /covenants?|conditions?|restrictions?|CC&?R/i);
  const deedPages = pages.filter((page) => page.documentType === "Deed");
  const dotPages = pages.filter((page) => page.documentType === "Deed of Trust / Mortgage");
  const releasePages = pages.filter((page) => page.documentType === "Release / Satisfaction");
  const assignmentPages = pages.filter((page) => page.documentType === "Assignment");
  const platPages = pages.filter((page) => page.documentType === "Plat / Map");
  const lienEvidence = allEvidence(pages, /federal tax lien|judgment lien|mechanic.?s lien|claim of lien/i);
  const mersEvidence = allEvidence(dotPages, /Mortgage Electronic Registration Systems|\bMERS\b/i);
  const legalByType = new Map<string, EvidenceRef>();
  for (const page of pages) { const legal = findLegalDescription(page); if (legal && !legalByType.has(page.documentType)) legalByType.set(page.documentType, legal); }

  const deedGrantor = firstEvidence(deedPages, [/grantor/i]);
  const deedGrantee = firstEvidence(deedPages, [/grantee/i]);
  const deedInstrument = deedPages.map((page) => extractInstrument(page.text)).find(Boolean) || "Not Provided";
  const deedDate = deedPages.map((page) => extractDate(page.text)).find(Boolean) || "Not Provided";

  const runAudit = runSheetAudit(pages);
  const findings: AuditFinding[] = [];
  findings.push(finding(1, hoaEvidence.length ? "Applicable" : "Not Applicable", hoaEvidence.length ? "PASS" : "NOT_APPLICABLE", hoaEvidence, hoaEvidence.length ? "HOA/association language is explicitly present in the packet." : "No HOA/association reference was found; per audit doctrine this is Not Applicable, not a missing-item failure."));
  findings.push(finding(2, ccrEvidence.length ? "Referenced" : "Not Applicable", ccrEvidence.length ? "PASS" : "NOT_APPLICABLE", ccrEvidence, ccrEvidence.length ? "Covenant/restriction language is explicitly present." : "No CC&R reference found; no document requirement is inferred."));
  const hoaAmounts = hoaEvidence.filter((ev) => /\$|dues|assessment|amount/i.test(ev.quote));
  findings.push(finding(3, hoaEvidence.length ? (hoaAmounts.length ? "HOA reference and amount language located" : "HOA referenced; amounts Not Stated") : "Not Applicable", hoaEvidence.length ? "PASS" : "NOT_APPLICABLE", [...hoaEvidence.slice(0,3), ...hoaAmounts.slice(0,2)], hoaEvidence.length ? "Only explicitly stated HOA names/amounts are reported; no dues amount is inferred." : "HOA not referenced."));

  const runRefDeed = pages.filter((page) => /Run Sheet/.test(page.documentType)).some((page) => /deed|mortgage|deed of trust/i.test(page.text));
  if (runRefDeed && (!deedPages.length || !dotPages.length)) findings.push(finding(4, "Cannot Confirm", "CANNOT_CONFIRM", [], "Run Sheet/title materials reference deed/mortgage information, but a full comparison document set was not identifiable."));
  else if (deedPages.length || dotPages.length) findings.push(finding(4, "Cannot Confirm", "CANNOT_CONFIRM", [...allEvidence(deedPages, /grantor|grantee|consideration|amount/i), ...allEvidence(dotPages, /borrower|lender|amount|principal/i)].slice(0,8), "Names/amounts were extracted, but exact Run Sheet-to-recording field comparison requires the authoritative search requirement/template rules and a fully parsed Run Sheet schema."));
  else findings.push(finding(4, "Not Applicable", "NOT_APPLICABLE", [], "No deed/mortgage comparison requirement was explicitly identified in the supplied text."));

  findings.push(finding(5, runAudit.response, runAudit.status, runAudit.evidence, runAudit.reason));
  const dateEvidence = allEvidence(pages.filter((page) => /Run Sheet/.test(page.documentType)), /\b(?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])[\/\-.](?:19|20)\d{2}\b|\b[A-Z][a-z]+\s+\d{1,2},\s+(?:19|20)\d{2}\b/);
  findings.push(finding(6, dateEvidence.length > 1 ? "Cannot Confirm" : "Not Stated", dateEvidence.length > 1 ? "CANNOT_CONFIRM" : "NOT_STATED", dateEvidence, dateEvidence.length > 1 ? "Recording dates were located, but chronological legal sequence cannot be safely inferred from page order alone." : "Insufficient explicit recording-date sequence to evaluate chronology."));

  if (mersEvidence.length && minEv) findings.push(finding(7, "Not Applicable per MERS/MIN rule", "NOT_APPLICABLE", [...mersEvidence, minEv].slice(0,5), "DOT evidence names MERS and a MIN is present; assignments are not required solely because MERS appears as beneficiary."));
  else if (assignmentPages.length) findings.push(finding(7, "Cannot Confirm", "CANNOT_CONFIRM", allEvidence(assignmentPages, /assignor|assignee|assignment/i), "Assignment documents are present, but vesting-chain comparison requires explicit assignor/assignee linkage across the referenced instruments."));
  else findings.push(finding(7, "Not Applicable", "NOT_APPLICABLE", [], "No assignment requirement was explicitly identified."));

  const legalReport = legalByType.get("Run Sheet / Title Report") || legalByType.get("Title Report");
  const legalDeed = legalByType.get("Deed");
  const legalDot = legalByType.get("Deed of Trust / Mortgage");
  const legalEvidence = [legalReport, legalDeed, legalDot].filter((value): value is EvidenceRef => Boolean(value));
  if (legalEvidence.length >= 2) {
    const norms = legalEvidence.map((ev) => normalize(ev.quote));
    const same = norms.every((value) => value === norms[0]);
    findings.push(finding(8, same ? "Yes" : "No", same ? "PASS" : "FAIL", legalEvidence, same ? "Supplied legal-description excerpts match after whitespace/punctuation normalization." : "Supplied legal-description excerpts are not identical after normalization; discrepancy requires examiner review."));
  } else if (legalEvidence.length === 1 && !runRefDeed) findings.push(finding(8, "Yes — single supplied description", "PASS", legalEvidence, "Only one applicable legal description was supplied and no conflicting referenced comparison document was identified."));
  else findings.push(finding(8, "Cannot Confirm", "CANNOT_CONFIRM", legalEvidence, "The evidence set is insufficient to complete the required legal-description comparison."));

  if (dotPages.length && mersEvidence.length) findings.push(finding(9, "Yes", "PASS", [...mersEvidence, ...(minEv ? [minEv] : [])].slice(0,6), minEv ? "MERS is expressly stated in DOT evidence and a MIN is present." : "MERS is expressly stated, but no MIN evidence was found; verify applicability."));
  else findings.push(finding(9, "Not Applicable", "NOT_APPLICABLE", mersEvidence, dotPages.length ? "DOT evidence does not expressly identify MERS; no MERS conclusion is inferred." : "No DOT/MERS evidence requiring this test was identified."));

  findings.push(finding(10, lienEvidence.some((ev) => /federal tax lien/i.test(ev.quote)) ? "Federal Tax Lien referenced" : "Not Applicable", lienEvidence.some((ev) => /federal tax lien/i.test(ev.quote)) ? "PASS" : "NOT_APPLICABLE", lienEvidence.filter((ev) => /federal tax lien/i.test(ev.quote)), lienEvidence.some((ev) => /federal tax lien/i.test(ev.quote)) ? "Federal Tax Lien language was explicitly located and reported." : "No Federal Tax Lien reference found; no lien is inferred from silence."));

  const runReleaseRef = pages.filter((page) => /Run Sheet/.test(page.documentType)).some((page) => /release|satisfaction|reconveyance/i.test(page.text));
  findings.push(finding(11, releasePages.length ? "Yes" : runReleaseRef ? "No" : "No release required", releasePages.length ? "PASS" : runReleaseRef ? "FAIL" : "PASS", allEvidence(releasePages, /release|satisfaction|reconveyance|instrument/i), releasePages.length ? "Release/satisfaction document evidence is present." : runReleaseRef ? "A release is referenced by the Run Sheet/title material but no release page was classified in the packet." : "No release reference was found; absence is not treated as an error."));

  const dotAddress = firstEvidence(dotPages, [/property address/i, /^address\s*[:#-]/i]);
  if (dotPages.length && addressEv && dotAddress) {
    const same = normalize(valueAfterLabel(addressEv, /property address|address/i)) === normalize(valueAfterLabel(dotAddress, /property address|address/i));
    findings.push(finding(12, same ? "Yes" : "No", same ? "PASS" : "FAIL", [addressEv, dotAddress], same ? "The expressly stated property-address strings match after normalization." : "The expressly stated property-address strings differ."));
  } else if (dotPages.length) findings.push(finding(12, "Cannot Confirm", "CANNOT_CONFIRM", [addressEv, dotAddress].filter((v): v is EvidenceRef => Boolean(v)), "A DOT/mortgage is present, but both report and security-instrument address evidence were not available for comparison."));
  else findings.push(finding(12, "Not Applicable", "NOT_APPLICABLE", addressEv ? [addressEv] : [], "No DOT/mortgage document was identified; no secured-address comparison is inferred."));

  const loanType = dotPages.some((page) => /deed of trust/i.test(page.text)) ? "Deed of Trust" : dotPages.some((page) => /mortgage/i.test(page.text)) ? "Mortgage" : "Not Provided";
  findings.push(finding(13, loanType, loanType === "Not Provided" ? "NOT_STATED" : "PASS", allEvidence(dotPages, /deed of trust|mortgage/i).slice(0,3), loanType === "Not Provided" ? "Loan document type not expressly stated in identified evidence." : "Loan document type is expressly stated."));
  const recordingEv = firstEvidence(dotPages.length ? dotPages : pages, [/recording date/i, /recorded\s+(?:on\s+)?/i]);
  findings.push(finding(14, recordingEv ? extractDate(recordingEv.quote) || recordingEv.quote : "Not Stated", recordingEv ? "PASS" : "NOT_STATED", recordingEv ? [recordingEv] : [], recordingEv ? "Recording-date evidence located." : "Recording date not expressly located."));
  const loanStatusEv = firstEvidence(pages, [/loan status/i, /satisfied|released|default|active loan/i]);
  findings.push(finding(15, loanStatusEv?.quote || "Not Stated", loanStatusEv ? "PASS" : "NOT_STATED", loanStatusEv ? [loanStatusEv] : [], loanStatusEv ? "Loan-status language is expressly present." : "Loan status is not stated."));
  const recourseEv = firstEvidence(pages, [/\brecourse\b/i]);
  findings.push(finding(16, recourseEv?.quote || "Not Stated", recourseEv ? "PASS" : "NOT_STATED", recourseEv ? [recourseEv] : [], recourseEv ? "Recourse language located." : "Recourse is not stated; no inference made."));

  const obviousMismatchEvidence = allEvidence(pages, /aka|a\.k\.a\.|fka|formerly known|corrective|scrivener|error|incorrect|typo/i);
  findings.push(finding(17, obviousMismatchEvidence.length ? "Potential legal-impact discrepancy language found" : "None Found in extracted evidence", "PASS", obviousMismatchEvidence, obviousMismatchEvidence.length ? "Potential discrepancy language is surfaced for human review; presence alone does not automatically fail without legal impact." : "No explicit typo/error/corrective language was found. State-law impact rules still require the authoritative state rule pack."));

  const platReferenced = mentioned(allText, "plat|map book|subdivision map");
  findings.push(finding(18, platPages.length ? "Yes" : platReferenced ? "No" : "Not Applicable", platPages.length ? "PASS" : platReferenced ? "FAIL" : "NOT_APPLICABLE", allEvidence(platPages, /plat|map book|subdivision/i), platPages.length ? "Plat/map evidence was identified in the packet." : platReferenced ? "A plat/map is referenced, but no plat/map page was identified in the supplied packet." : "No plat reference found; no plat requirement is inferred. State-specific mandate awaits authoritative rule pack."));

  const runPages = pages.filter((page) => /Run Sheet/.test(page.documentType));
  const runMinEv = firstEvidence(runPages, [/\bMIN\s*#?\s*[:#-]?\s*\d{8,20}/i]);
  if (minEv) findings.push(finding(19, runMinEv ? "Yes" : "No", runMinEv ? "PASS" : "FAIL", [minEv, runMinEv].filter((v): v is EvidenceRef => Boolean(v)), runMinEv ? "MIN evidence is present on the Run Sheet/title index." : "A MIN is present in the packet but was not located on the identified Run Sheet."));
  else findings.push(finding(19, "Not Applicable", "NOT_APPLICABLE", [], "No MIN requirement was established by supplied evidence."));
  findings.push(finding(20, runAudit.response, runAudit.status, runAudit.evidence, runAudit.reason));

  const manualReviewRequired = pages.some((page) => !page.text.trim() || (page.source === "azure-ocr" && typeof page.confidence === "number" && page.confidence < 0.95));
  const nativeCount = pages.filter((page) => page.source === "native").length;
  const ocrCount = pages.filter((page) => page.source === "azure-ocr").length;
  const blankCount = pages.filter((page) => !page.text.trim()).length;
  const legalDescription = legalReport?.quote || legalDeed?.quote || legalDot?.quote || "Not Provided";
  const documents = makeDocuments(pages);
  const deed = {
    grantor: valueAfterLabel(deedGrantor, /grantor/i), grantee: valueAfterLabel(deedGrantee, /grantee/i), date: deedDate,
    bookPage: valueAfterLabel(firstEvidence(deedPages, [/book\s*\/\s*page/i, /book\s+\d+/i]), /book\s*\/\s*page/i), instrument: deedInstrument,
    consideration: valueAfterLabel(firstEvidence(deedPages, [/consideration/i, /\$[\d,]+(?:\.\d{2})?/]), /consideration/i),
  };

  return emptyVera({
    state: options.state || "TX", county: countyEv?.quote || "Not Stated", searchType: options.searchType || "General Search",
    clientOrder: valueAfterLabel(clientOrderEv, /client order|title order|order\s*#/i), propertyAddress: valueAfterLabel(addressEv, /property address|address|located at or near/i),
    searchEffectiveDate: valueAfterLabel(effectiveEv, /effective date|search date/i), minNumber: minEv ? (minEv.quote.match(/\d{8,20}/)?.[0] || minEv.quote) : "Not Provided",
    parcelId: valueAfterLabel(parcelEv, /parcel(?: id| number)?|APN/i), landValue: valueAfterLabel(landEv, /land value/i), improvements: improveEv ? valueAfterLabel(improveEv, /improvements?/i) : "Not Stated",
    taxStatus: taxEv?.quote || "Not Stated", fiscalYear: fiscalEv?.quote || "Not Stated", mobileHome: mentioned(allText, "mobile home|manufactured home") ? "Yes" : "Not Provided",
    condoHoa: hoaEvidence.length ? "Applicable" : "Not Applicable", hoaPresent: findings[0].response, ccrs: findings[1].response, hoaNameAmounts: findings[2].response,
    deedMortgageAccurate: findings[3].response, deed, mortgages: [], recordingsAvailable: findings[4].response, recordingsChronological: findings[5].response,
    assignmentVesting: findings[6].response, legalDescriptionConfirmed: findings[7].response, legalDescription, originalBeneficiaryMers: findings[8].response,
    federalTaxLien: findings[9].response, documentReleases: findings[10].response, propertySecuredAddressMatch: findings[11].response,
    loanDocumentType: loanType as VeraExam["loanDocumentType"], recordingDate: findings[13].response, loanStatus: "Not Provided", recourse: findings[15].response,
    typosOrErrors: findings[16].response, platMapLabeled: findings[17].response, minInRunSheet: findings[18].response, runSheetAccurate: findings[19].response,
    audit: {
      vestingDeed: `${deed.grantor} → ${deed.grantee}; Date: ${deed.date}; Instrument#: ${deed.instrument}`,
      chainOfTitle: runAudit.reason,
      mortgageInformation: dotPages.length ? `${dotPages.length} DOT/mortgage page(s) identified; field-level evidence retained in findings.` : "Not Stated",
      taxInformation: [parcelEv?.quote, landEv?.quote, taxEv?.quote].filter(Boolean).join(" | ") || "Not Stated",
      judgmentsAndLiens: lienEvidence.length ? lienEvidence.map((ev) => `P${ev.page}: ${ev.quote}`).join(" | ") : "None expressly found",
      easementsAndRestrictions: ccrEvidence.length ? ccrEvidence.map((ev) => `P${ev.page}: ${ev.quote}`).join(" | ") : "None expressly found",
    },
    findings, pages, documents, manualReviewRequired,
    extractionSummary: `${pages.length} page(s): ${nativeCount} native-text, ${ocrCount} Azure OCR, ${blankCount} without usable text. Rule version ${AUDIT_RULE_VERSION}.`,
    sourceFile, rawExcerpt: clean(allText).slice(0, 2200), extractedAt: new Date().toISOString(),
  });
}

export function extractVera(raw: string, sourceFile = "pasted-text", options: Omit<ExtractOptions, "sourceFile"> = {}): VeraExam {
  return extractVeraFromPages([{ page: 1, text: raw, source: "pasted", documentType: "Unclassified" }], { ...options, sourceFile });
}
