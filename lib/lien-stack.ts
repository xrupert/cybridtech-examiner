import type {
  CanonicalInstrument,
  CanonicalLienStackEntry,
  ForeclosureAnalysis,
  ForeclosureRequirement,
  LienPriorityBasis,
  LienPriorityConfidence,
} from "./title-domain";
import type { EvidenceRef } from "./vera";

export interface LienStackBuildOptions {
  titleSummaryOpenInstrumentNumbers?: string[];
}

function clean(value: string): string {
  const text = String(value || "").trim();
  return text && !/^needs review$/i.test(text) ? text : "";
}

function normalizeInstrumentNumber(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const RELEASE_PATTERN = /release|satisfaction|reconveyance|discharge|termination|cancel(?:led|lation)?/i;
const DERIVATIVE_LIEN_EVENT_PATTERN = /assignment|modification|amendment|extension|renewal|subordination agreement|appointment|substitute trustee|substitution of trustee|trustee appointment|notice of default|notice of trustee(?:'s)? sale|notice of sale|foreclosure notice|corrective|correction|forbearance/i;
const CONVEYANCE_DEED_PATTERN = /\b(?:special warranty|general warranty|warranty|grant|quitclaim|quit claim|bargain(?: and| &) sale|trustee'?s?|sheriff'?s?|tax|executor'?s?|administrator'?s?)?\s*deed\b/i;

export function isSecurityLienIdentityType(type: string): boolean {
  const text = clean(type);
  return Boolean(text)
    && /mortgage|deed of trust|security deed/i.test(text)
    && !RELEASE_PATTERN.test(text)
    && !DERIVATIVE_LIEN_EVENT_PATTERN.test(text);
}

export function isLienIdentityType(type: string): boolean {
  const text = clean(type);
  if (!text || RELEASE_PATTERN.test(text) || DERIVATIVE_LIEN_EVENT_PATTERN.test(text)) return false;
  if (isSecurityLienIdentityType(text)) return true;
  // A conveyance instrument remains a deed even when its caption says "with vendor's lien".
  // The embedded vendor-lien language may matter to title review, but it is not promoted into
  // a second lien-stack identity unless extraction supplies a distinct lien/security instrument.
  if (CONVEYANCE_DEED_PATTERN.test(text) && !/deed of trust|security deed/i.test(text)) return false;
  return /judgment|notice and statement of lien|mechanic(?:'s)? lien|construction lien|hoa lien|association lien|assessment lien|ucc(?: financing statement)?|federal tax lien|tax lien|\blien\b/i.test(text);
}

function isEncumbranceIdentity(instrument: CanonicalInstrument): boolean {
  return isLienIdentityType(instrument.type);
}

function isReleaseInstrument(instrument: CanonicalInstrument): boolean {
  return RELEASE_PATTERN.test(clean(instrument.type));
}

function evidenceText(instrument: CanonicalInstrument): string {
  return (instrument.evidence || []).map((ref) => normalizeInstrumentNumber(ref.quote)).join(" ");
}

function rawEvidenceText(instrument: CanonicalInstrument): string {
  return (instrument.evidence || []).map((ref) => ref.quote).join(" \n");
}

function hasJudgmentLienReleaseEvidence(instrument: CanonicalInstrument): boolean {
  if (!/judgment/i.test(instrument.type)) return false;
  return /\brelease of judgment lien\b|\bjudgment lien (?:was )?(?:released|satisfied|discharged)\b/i.test(rawEvidenceText(instrument));
}

function releaseMatchesInstrument(release: CanonicalInstrument, instrument: CanonicalInstrument): boolean {
  const target = normalizeInstrumentNumber(instrument.instrumentNumber);
  if (!target) return false;
  if ((release.referencedInstrumentNumbers || []).some((value) => normalizeInstrumentNumber(value) === target)) return true;
  if (normalizeInstrumentNumber(release.instrumentNumber) === target) return true;
  return evidenceText(release).includes(target);
}

function releasedInstrumentIds(instruments: CanonicalInstrument[], releases: CanonicalInstrument[]): Set<string> {
  const ids = new Set<string>();
  for (const instrument of instruments) {
    if (releases.some((release) => releaseMatchesInstrument(release, instrument))) ids.add(instrument.id);
  }
  return ids;
}

function statusFromInstrument(
  instrument: CanonicalInstrument,
  releasedIds: Set<string>,
  titleSummaryOpenNumbers: Set<string>,
): "OPEN" | "RELEASED" | "UNKNOWN" {
  if (releasedIds.has(instrument.id) || hasJudgmentLienReleaseEvidence(instrument)) return "RELEASED";
  if (/release|satisf|paid|closed|terminated|reconveyed|discharged|cancelled/i.test(instrument.status)) return "RELEASED";
  if (/open|active|unreleased|outstanding|unsatisfied|affect(?:s|ing)? title/i.test(instrument.status)) return "OPEN";
  const number = normalizeInstrumentNumber(instrument.instrumentNumber);
  if (number && titleSummaryOpenNumbers.has(number)) return "OPEN";
  return "UNKNOWN";
}

function dateKey(value: string): number | null {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function priorityFlag(type: string): string | null {
  if (/federal tax lien|tax lien/i.test(type)) return "Tax lien priority may depend on statute, assessment/filing timing, notice, and foreclosure procedure.";
  if (/mechanic|construction/i.test(type)) return "Mechanics/construction lien priority may relate back under governing state law.";
  if (/hoa|association|assessment/i.test(type)) return "HOA/association assessment priority may include statutory or super-priority rules.";
  if (/ucc/i.test(type)) return "UCC/fixture filing priority requires collateral and fixture-filing review.";
  return null;
}

function sameDayAmbiguity(entries: CanonicalLienStackEntry[]): boolean {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const date = clean(entry.recordingDate).slice(0, 10);
    if (!date) continue;
    counts.set(date, (counts.get(date) || 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function chronological(entries: CanonicalLienStackEntry[]): CanonicalLienStackEntry[] {
  return [...entries].sort((a, b) => {
    const ad = dateKey(a.recordingDate);
    const bd = dateKey(b.recordingDate);
    if (ad == null && bd == null) return 0;
    if (ad == null) return 1;
    if (bd == null) return -1;
    return ad - bd;
  });
}

function developedPositionLabel(index: number): string {
  const n = index + 1;
  if (n === 1) return "1st Lien";
  if (n === 2) return "2nd Lien";
  if (n === 3) return "3rd Lien";
  return `${n}th Lien`;
}

function positionBasis(active: CanonicalLienStackEntry[]): { basis: LienPriorityBasis; confidence: LienPriorityConfidence; warning: string | null } {
  if (!active.length) return { basis: "UNRESOLVED", confidence: "low", warning: "No confirmed open liens were available for priority development." };
  if (active.some((entry) => dateKey(entry.recordingDate) == null)) return { basis: "FIRST_IN_TIME", confidence: "low", warning: "One or more open lien identities lack a usable recording date." };
  const exceptions = active.map((entry) => priorityFlag(entry.instrumentType)).filter((value): value is string => Boolean(value));
  if (exceptions.length) return { basis: "FIRST_IN_TIME", confidence: "medium", warning: [...new Set(exceptions)].join(" ") };
  if (sameDayAmbiguity(active)) return { basis: "FIRST_IN_TIME", confidence: "medium", warning: "Multiple open lien identities share a recording date; instrument-time/sequence review may be required." };
  return { basis: "FIRST_IN_TIME", confidence: "high", warning: null };
}

export function buildLienStack(
  instruments: CanonicalInstrument[],
  releases: CanonicalInstrument[],
  options: LienStackBuildOptions = {},
): CanonicalLienStackEntry[] {
  const identities = instruments.filter(isEncumbranceIdentity);
  const allReleases = [...releases, ...instruments.filter(isReleaseInstrument)];
  const releasedIds = releasedInstrumentIds(identities, allReleases);
  const titleSummaryOpenNumbers = new Set((options.titleSummaryOpenInstrumentNumbers || []).map(normalizeInstrumentNumber).filter(Boolean));

  const raw = identities.map((instrument): CanonicalLienStackEntry => ({
    instrumentId: instrument.id,
    instrumentType: instrument.type,
    instrumentNumber: instrument.instrumentNumber,
    amount: instrument.amount,
    recordingDate: instrument.recordingDate,
    status: statusFromInstrument(instrument, releasedIds, titleSummaryOpenNumbers),
    positionLabel: "Needs review",
    priorityBasis: "UNRESOLVED",
    priorityConfidence: "low",
    priorityWarning: null,
    evidence: instrument.evidence,
    evidenceIds: instrument.evidenceIds,
  }));

  const active = chronological(raw.filter((entry) => entry.status === "OPEN"));
  const priority = positionBasis(active);
  active.forEach((entry, index) => {
    entry.positionLabel = developedPositionLabel(index);
    entry.priorityBasis = priority.basis;
    entry.priorityConfidence = priority.confidence;
    entry.priorityWarning = priority.warning;
  });
  for (const entry of raw.filter((item) => item.status !== "OPEN")) {
    entry.positionLabel = entry.status === "RELEASED" ? "Released/Historical" : "Unresolved";
    entry.priorityBasis = "UNRESOLVED";
    entry.priorityConfidence = "low";
    entry.priorityWarning = entry.status === "UNKNOWN" ? "Lien identity exists but current open/released status is not established." : null;
  }

  return raw;
}

function isSecurityEntry(entry: CanonicalLienStackEntry): boolean {
  return isSecurityLienIdentityType(entry.instrumentType);
}

function openSecurityEntries(lienStack: CanonicalLienStackEntry[]): CanonicalLienStackEntry[] {
  return lienStack.filter((entry) => entry.status === "OPEN" && isSecurityEntry(entry));
}

export function automaticTargetSecurityLienId(lienStack: CanonicalLienStackEntry[], titleSummaryMortgageNumbers: string[] = []): string | null {
  const open = openSecurityEntries(lienStack);
  if (open.length === 1) return open[0].instrumentId;
  if (!open.length) return null;
  const summaryNumbers = new Set(titleSummaryMortgageNumbers.map(normalizeInstrumentNumber).filter(Boolean));
  if (!summaryNumbers.size) return null;
  const summaryOpen = open.filter((entry) => summaryNumbers.has(normalizeInstrumentNumber(entry.instrumentNumber)));
  if (summaryOpen.length !== open.length) return null;
  const ordered = chronological(open);
  const priority = positionBasis(ordered);
  if (priority.confidence !== "high") return null;
  return ordered[0]?.instrumentId || null;
}

export function developedPositionForTarget(
  lienStack: CanonicalLienStackEntry[],
  targetInstrumentId: string | null,
): { value: string; basis: LienPriorityBasis; confidence: LienPriorityConfidence; warning: string | null; evidence: EvidenceRef[]; evidenceIds: string[] } {
  if (!targetInstrumentId) return { value: "Needs review", basis: "UNRESOLVED", confidence: "low", warning: "Target lien is unresolved.", evidence: [], evidenceIds: [] };
  const target = lienStack.find((entry) => entry.instrumentId === targetInstrumentId);
  if (!target || target.status !== "OPEN") return { value: "Needs review", basis: "UNRESOLVED", confidence: "low", warning: "Target lien is not a confirmed open lien identity.", evidence: target?.evidence || [], evidenceIds: target?.evidenceIds || [] };
  const active = chronological(lienStack.filter((entry) => entry.status === "OPEN"));
  const index = active.findIndex((entry) => entry.instrumentId === targetInstrumentId);
  if (index < 0) return { value: "Needs review", basis: "UNRESOLVED", confidence: "low", warning: "Target lien was not found in the confirmed open lien stack.", evidence: target.evidence, evidenceIds: target.evidenceIds };
  const priority = positionBasis(active);
  return {
    value: developedPositionLabel(index),
    basis: priority.basis,
    confidence: priority.confidence,
    warning: priority.warning,
    evidence: target.evidence,
    evidenceIds: target.evidenceIds,
  };
}

function req(
  type: ForeclosureRequirement["type"],
  title: string,
  action: string,
  blocking: boolean,
  evidence: EvidenceRef[] = [],
  evidenceIds: string[] = [],
): ForeclosureRequirement {
  return { type, title, action, blocking, evidence, evidenceIds, scope: "TITLE_PACKET" };
}

export function buildForeclosureAnalysis(args: {
  lienStack: CanonicalLienStackEntry[];
  targetInstrumentId: string | null;
  targetAmount: string;
  targetPosition: string;
  targetPositionBasis: LienPriorityBasis;
  targetPositionConfidence: LienPriorityConfidence;
  selectionRequired: boolean;
}): ForeclosureAnalysis {
  const active = chronological(args.lienStack.filter((entry) => entry.status === "OPEN"));
  const unknown = args.lienStack.filter((entry) => entry.status === "UNKNOWN");
  const targetIndex = args.targetInstrumentId ? active.findIndex((entry) => entry.instrumentId === args.targetInstrumentId) : -1;
  const seniorLienIds = targetIndex >= 0 ? active.slice(0, targetIndex).map((entry) => entry.instrumentId) : [];
  const juniorLienIds = targetIndex >= 0 ? active.slice(targetIndex + 1).map((entry) => entry.instrumentId) : [];
  const requirements: ForeclosureRequirement[] = [];

  if (args.selectionRequired || !args.targetInstrumentId) {
    requirements.push(req("TARGET_SELECTION", "Target lien requires examiner selection", "Select the exact mortgage/deed-of-trust being foreclosed before senior/junior and cure analysis is finalized.", true));
  }
  if (!args.targetAmount || /^needs review$/i.test(args.targetAmount)) {
    requirements.push(req("PAYOFF_OR_AMOUNT", "Target lien amount is unresolved", "Confirm the recorded/original secured amount from the target security instrument or controlling title summary before export.", true));
  }
  if (!args.targetPosition || /^needs review$/i.test(args.targetPosition)) {
    requirements.push(req("PRIORITY_REVIEW", "Target lien position is unresolved", "Develop target lien priority from reliable recording chronology and review any statutory priority exceptions.", true));
  } else if (args.targetPositionBasis === "FIRST_IN_TIME" && args.targetPositionConfidence !== "high") {
    requirements.push(req("PRIORITY_REVIEW", "First-in-time position requires examiner priority confirmation", "Review the flagged priority exception or same-day/recording-sequence issue before treating the developed position as final legal priority.", true));
  }
  for (const id of seniorLienIds) {
    const entry = args.lienStack.find((item) => item.instrumentId === id);
    if (!entry) continue;
    requirements.push(req("SENIOR_LIEN", `Senior ${entry.instrumentType} ${entry.instrumentNumber}`, "Confirm payoff/survival treatment and any required foreclosure notice or cure for this senior interest.", false, entry.evidence, entry.evidenceIds));
  }
  for (const id of juniorLienIds) {
    const entry = args.lienStack.find((item) => item.instrumentId === id);
    if (!entry) continue;
    requirements.push(req("JUNIOR_LIEN", `Junior ${entry.instrumentType} ${entry.instrumentNumber}`, "Confirm jurisdiction-specific notice, extinguishment/survival, and release/curative requirements for this junior interest.", false, entry.evidence, entry.evidenceIds));
  }
  for (const entry of unknown) {
    requirements.push(req("LIEN_STATUS", `${entry.instrumentType} ${entry.instrumentNumber} has unresolved lien status`, "Determine whether this true lien identity is open, released, satisfied, expired, or otherwise non-enforceable before final priority/cure analysis.", true, entry.evidence, entry.evidenceIds));
  }

  return {
    lienStack: args.lienStack,
    openLienCount: active.length,
    unresolvedLienCount: unknown.length,
    releasedLienCount: args.lienStack.filter((entry) => entry.status === "RELEASED").length,
    seniorLienIds,
    juniorLienIds,
    requirements,
    status: requirements.some((item) => item.blocking) ? "CURATIVE_REQUIRED" : "READY",
  };
}
