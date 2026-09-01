import type { CanonicalTitleRecord, ForeclosureRequirement, JurisdictionCoverage } from "./title-domain";

const WA_RULE_VERSION = "WA-DTA-2026-08-31";
const RCW_030 = "https://app.leg.wa.gov/rcw/default.aspx?cite=61.24.030";
const RCW_040 = "https://app.leg.wa.gov/rcw/default.aspx?cite=61.24.040";
const IRS_NJS = "https://www.irs.gov/irm/part5/irm_05-012-004";

export interface JurisdictionAnalysis {
  coverage: JurisdictionCoverage;
  requirements: ForeclosureRequirement[];
}

function stateCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized === "WASHINGTON") return "WA";
  return normalized;
}

function evidenceForIds(record: CanonicalTitleRecord, ids: string[]) {
  const selected = record.foreclosureAnalysis.lienStack.filter((entry) => ids.includes(entry.instrumentId));
  return {
    refs: selected.flatMap((entry) => entry.evidence),
    ids: [...new Set(selected.flatMap((entry) => entry.evidenceIds || []))],
  };
}

function requirement(input: Omit<ForeclosureRequirement, "evidence" | "evidenceIds"> & { record: CanonicalTitleRecord; lienIds?: string[] }): ForeclosureRequirement {
  const evidence = evidenceForIds(input.record, input.lienIds || []);
  const { record: _record, lienIds: _lienIds, ...rest } = input;
  return { ...rest, evidence: evidence.refs, evidenceIds: evidence.ids };
}

function federalTaxLienPresent(record: CanonicalTitleRecord): boolean {
  const stated = record.flags.federalTaxLien.value.toLowerCase();
  if (/federal tax lien|irs/.test(stated) && !/no federal|none|not found|not applicable|n\/a/.test(stated)) return true;
  return record.foreclosureAnalysis.lienStack.some((entry) => entry.status === "OPEN" && /federal tax|irs/.test(entry.instrumentType));
}

function washington(record: CanonicalTitleRecord): JurisdictionAnalysis {
  const county = record.county.value === "Needs review" ? "County unresolved" : record.county.value;
  const requirements: ForeclosureRequirement[] = [];

  requirements.push(requirement({
    record,
    code: "WA_RC61_24_030_DEFAULT_NOTICE",
    type: "NOTICE_REVIEW",
    severity: "INFO",
    scope: "FORECLOSURE_PROCESS",
    jurisdiction: `Washington${county !== "County unresolved" ? ` · ${county} County` : ""}`,
    authority: "RCW 61.24.030(8)",
    authorityUrl: RCW_030,
    ruleVersion: WA_RULE_VERSION,
    title: "Washington pre-sale notice-of-default prerequisite.",
    action: "Before a nonjudicial trustee sale, confirm the written notice of default and applicable residential beneficiary declaration/service requirements are completed at least 30 days before the Notice of Trustee's Sale is recorded, transmitted, or served. This is a foreclosure-process requirement, not a defect in a title package merely because the sale process has not begun.",
  }));

  requirements.push(requirement({
    record,
    code: "WA_RC61_24_040_NOTICE_OF_SALE",
    type: "NOTICE_REVIEW",
    severity: "INFO",
    scope: "FORECLOSURE_PROCESS",
    jurisdiction: `Washington${county !== "County unresolved" ? ` · ${county} County` : ""}`,
    authority: "RCW 61.24.040",
    authorityUrl: RCW_040,
    ruleVersion: WA_RULE_VERSION,
    title: "Washington Notice of Trustee's Sale timing, recording, mailing, posting, and publication.",
    action: "For a Washington nonjudicial deed-of-trust foreclosure, track the statutory Notice of Trustee's Sale requirements, including county recording, required mailing/service, posting, publication, and sale-timing requirements. Treat this as a future process checklist unless the packet/order represents that the sale-notice stage has already been completed.",
  }));

  const targetResolved = Boolean(record.foreclosureAnalysis.targetInstrumentId);
  const noticeLienIds = record.foreclosureAnalysis.juniorLienIds.length
    ? record.foreclosureAnalysis.juniorLienIds
    : targetResolved
      ? []
      : record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "OPEN").map((entry) => entry.instrumentId);

  if (noticeLienIds.length) {
    requirements.push(requirement({
      record,
      lienIds: noticeLienIds,
      code: "WA_RC61_24_040_JUNIOR_NOTICE",
      type: "NOTICE_REVIEW",
      severity: "REVIEW",
      scope: "FORECLOSURE_PROCESS",
      jurisdiction: `Washington${county !== "County unresolved" ? ` · ${county} County` : ""}`,
      authority: "RCW 61.24.040(1)(b)",
      authorityUrl: RCW_040,
      ruleVersion: WA_RULE_VERSION,
      title: targetResolved
        ? `${noticeLienIds.length} junior interest${noticeLienIds.length === 1 ? "" : "s"} require Washington foreclosure-notice review.`
        : `${noticeLienIds.length} open recorded interest${noticeLienIds.length === 1 ? "" : "s"} require notice-recipient review after the foreclosure target is resolved.`,
      action: targetResolved
        ? "Use the developed junior-lien stack to identify holders entitled to Notice of Trustee's Sale under Washington law. Confirm current record-holder identity/address and required mailing/service treatment before sale processing is finalized."
        : "The foreclosure target is not yet resolved, so these open interests cannot safely be labeled senior or junior. Preserve them as potential statutory notice recipients and recompute the senior/junior set once the target lien is established; do not silently omit them from the Washington notice analysis.",
    }));
  }

  if (federalTaxLienPresent(record)) {
    const federalIds = record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "OPEN" && /federal tax|irs/.test(entry.instrumentType)).map((entry) => entry.instrumentId);
    requirements.push(requirement({
      record,
      lienIds: federalIds,
      code: "FED_IRC7425_NONJUDICIAL_NOTICE",
      type: "NOTICE_REVIEW",
      severity: "REVIEW",
      scope: "FORECLOSURE_PROCESS",
      jurisdiction: "Federal · United States",
      authority: "IRC 7425(c)(1); IRS IRM 5.12.4.5.1",
      authorityUrl: IRS_NJS,
      ruleVersion: "IRS-IRM-5.12.4-2024-06-25",
      title: "Federal tax lien nonjudicial-sale notice must be evaluated.",
      action: "If an NFTL was filed more than 30 days before the nonjudicial sale, determine whether effective IRS notice is required. IRS guidance states timely notice is written and delivered by the prescribed method to the designated ACR office no less than 25 calendar days before sale; without effective notice the federal lien may remain undisturbed.",
    }));
  }

  return {
    coverage: {
      state: "WA",
      county,
      status: "CURATED",
      ruleSetVersion: WA_RULE_VERSION,
      note: "Washington Deed of Trust Act and applicable federal nonjudicial-sale rules are curated. No county-specific foreclosure-law override is asserted unless separately loaded; county is used for recording/service context.",
    },
    requirements,
  };
}

export function jurisdictionAnalysisForRecord(record: CanonicalTitleRecord): JurisdictionAnalysis {
  const state = stateCode(record.state.value);
  const foreclosureOrder = record.orderType.state === "CONFIRMED" && /^foreclosure$/i.test(record.orderType.value);
  if (!foreclosureOrder) {
    return {
      coverage: {
        state: state || "UNRESOLVED",
        county: record.county.value,
        status: state === "WA" ? "CURATED" : state && state !== "NEEDS REVIEW" ? "GENERAL_ONLY" : "UNAVAILABLE",
        ruleSetVersion: state === "WA" ? WA_RULE_VERSION : "GENERAL-2026-08-31",
        note: `Foreclosure-process rules are not invoked for ${record.orderType.value}. Cybrid is performing title/QC review only; a confirmed or examiner-selected Foreclosure profile is required before sale-process requirements are projected.`,
      },
      requirements: [],
    };
  }
  if (state === "WA") return washington(record);

  return {
    coverage: {
      state: state || "UNRESOLVED",
      county: record.county.value,
      status: state && state !== "NEEDS REVIEW" ? "GENERAL_ONLY" : "UNAVAILABLE",
      ruleSetVersion: "GENERAL-2026-08-31",
      note: state && state !== "NEEDS REVIEW"
        ? "No curated state foreclosure-process rule set is loaded for this jurisdiction yet. Cybrid may still perform title QC and lien-stack analysis, but it must not present generic workflow guidance as state-specific legal requirements."
        : "State/county jurisdiction is unresolved, so no jurisdiction-specific foreclosure-process requirements can be asserted.",
    },
    requirements: [],
  };
}

export function mergeJurisdictionRequirements(record: CanonicalTitleRecord, analysis: JurisdictionAnalysis): CanonicalTitleRecord["foreclosureAnalysis"] {
  const requirements = [...new Map([...record.foreclosureAnalysis.requirements, ...analysis.requirements].map((item) => [item.code, item])).values()];
  const operational = requirements.filter((item) => item.severity !== "INFO");
  const status = operational.some((item) => item.severity === "BLOCKING")
    ? "CURATIVE_REQUIRED" as const
    : operational.length
      ? "REVIEW" as const
      : record.foreclosureAnalysis.status;
  return { ...record.foreclosureAnalysis, status, requirements, jurisdictionCoverage: analysis.coverage };
}
