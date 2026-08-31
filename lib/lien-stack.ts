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
  if (releasedIds.has(instrument.id)) return "RELEASED";
  if (/release|satisf|paid|closed|terminated|reconveyed|discharged|cancelled/i.test(instrument.status)) return "RELEASED";
  if (/open|active|unreleased|outstanding|unsatisfied|affect(?:s|ing)? title/i.test(instrument.status)) return "OPEN";
  const number = normalizeInstrumentNumber(instrument.instrumentNumber);
  if (number && titleSummaryOpenNumbers.has(number)) return "OPEN";
  return "UNKNOWN";
}

function holderFor(instrument: CanonicalInstrument): string {
  return instrument.parties.find((party) => /beneficiary|mortgagee|lender|holder|creditor|claimant|lienor/i.test(party.role))?.name
    || instrument.parties.find((party) => !/borrower|mortgagor|debtor|grantor|owner/i.test(party.role))?.name
    || "Needs review";
}

function dateKey(value: string): number | null {
  const text = clean(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sequenceKey(value: string): bigint | null {
  const normalized = normalizeInstrumentNumber(value);
  const digits = normalized.replace(/\D/g, "");
  if (!digits || digits.length > 30) return null;
  try { return BigInt(digits); } catch { return null; }
}

function ordinal(position: number): string {
  const mod100 = position % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : position % 10 === 1 ? "st" : position % 10 === 2 ? "nd" : position % 10 === 3 ? "rd" : "th";
  return `${position}${suffix} Lien`;
}

function exceptionWarning(type: string): string {
  if (/federal tax|irs|tax lien/i.test(type)) return "Tax-lien priority and foreclosure notice/redemption rules can override a simple recording-date ranking.";
  if (/mechanic|construction/i.test(type)) return "Mechanics/construction lien priority can relate back to work dates and requires jurisdiction-specific review.";
  if (/hoa|association|assessment/i.test(type)) return "HOA/association lien priority can be affected by statutory super-priority rules and requires jurisdiction-specific review.";
  if (/ucc/i.test(type)) return "UCC priority depends on collateral and perfection rules; chronological recording is only a screening baseline.";
  return "";
}

function uniqueEvidence(entries: CanonicalLienStackEntry[]): { refs: EvidenceRef[]; ids: string[] } {
  const refs: EvidenceRef[] = [];
  const ids: string[] = [];
  const refKeys = new Set<string>();
  for (const entry of entries) {
    for (const ref of entry.evidence) {
      const key = `${ref.page}|${ref.documentType}|${ref.quote}`;
      if (!refKeys.has(key)) { refKeys.add(key); refs.push(ref); }
    }
    for (const id of entry.evidenceIds || []) if (!ids.includes(id)) ids.push(id);
  }
  return { refs, ids };
}

export function buildLienStack(
  instruments: CanonicalInstrument[],
  releases: CanonicalInstrument[],
  options: LienStackBuildOptions = {},
): CanonicalLienStackEntry[] {
  const identities = instruments.filter(isEncumbranceIdentity);
  const relevantReleases = releases.filter(isReleaseInstrument);
  const releasedIds = releasedInstrumentIds(identities, relevantReleases);
  const titleSummaryOpenNumbers = new Set((options.titleSummaryOpenInstrumentNumbers || []).map(normalizeInstrumentNumber).filter(Boolean));
  const source = identities.map((instrument) => ({
    instrument,
    date: dateKey(instrument.recordingDate),
    sequence: sequenceKey(instrument.instrumentNumber),
    status: statusFromInstrument(instrument, releasedIds, titleSummaryOpenNumbers),
  }));

  const open = source.filter((item) => item.status === "OPEN");
  const unknown = source.filter((item) => item.status === "UNKNOWN");
  open.sort((a, b) => {
    if (a.date == null && b.date == null) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    if (a.date !== b.date) return a.date - b.date;
    if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1;
    return 0;
  });

  const activePositions = new Map<string, { position: number | null; confidence: LienPriorityConfidence; warning: string }>();
  for (let index = 0; index < open.length; index += 1) {
    const current = open[index];
    const sameDay = open.filter((candidate) => current.date != null && candidate.date === current.date);
    const ambiguousTie = sameDay.length > 1 && sameDay.some((candidate) => candidate.sequence == null) && !sameDay.every((candidate) => candidate.sequence != null);
    const statutoryWarning = exceptionWarning(current.instrument.type);
    const missingDate = current.date == null;
    const unresolvedCouldAffectPosition = unknown.some((candidate) => candidate.date == null || current.date == null || candidate.date <= current.date);
    const warning = missingDate
      ? "Recording date is unresolved, so first-in-time position cannot be calculated."
      : unresolvedCouldAffectPosition
        ? "One or more lien identities have unresolved open/released status and could affect this position; exact priority remains unresolved."
        : ambiguousTie
          ? "Multiple open encumbrances share the same recording date without a reliable recording sequence; exact priority needs examiner review."
          : statutoryWarning;
    const position = missingDate || unresolvedCouldAffectPosition || ambiguousTie ? null : index + 1;
    const confidence: LienPriorityConfidence = position == null ? "low" : statutoryWarning ? "medium" : "high";
    activePositions.set(current.instrument.id, { position, confidence, warning });
  }

  return source.map(({ instrument, status, date }) => {
    const position = status === "OPEN" ? activePositions.get(instrument.id)?.position ?? null : null;
    const confidence = status === "RELEASED" ? "high" : status === "OPEN" ? activePositions.get(instrument.id)?.confidence || "low" : "low";
    const warning = status === "RELEASED"
      ? "Released/satisfied instrument is excluded from the open-lien priority stack."
      : status === "UNKNOWN"
        ? "Lien status is unresolved; this identity is excluded from the open-lien count and final priority until open/unreleased status is supported."
        : activePositions.get(instrument.id)?.warning || "";
    return {
      instrumentId: instrument.id,
      instrumentType: instrument.type,
      instrumentNumber: instrument.instrumentNumber,
      amount: instrument.amount,
      recordingDate: instrument.recordingDate,
      holder: holderFor(instrument),
      status,
      chronologicalPosition: position,
      positionLabel: position ? ordinal(position) : status === "RELEASED" ? "Released" : "Needs review",
      priorityBasis: position ? "FIRST_IN_TIME" as const : "UNRESOLVED" as const,
      priorityConfidence: confidence,
      priorityWarning: warning,
      evidence: instrument.evidence,
      evidenceIds: instrument.evidenceIds,
      _sortDate: date,
    } as CanonicalLienStackEntry & { _sortDate: number | null };
  }).sort((a, b) => {
    const rank = (status: CanonicalLienStackEntry["status"]) => status === "OPEN" ? 0 : status === "UNKNOWN" ? 1 : 2;
    const statusDifference = rank(a.status) - rank(b.status);
    if (statusDifference) return statusDifference;
    if (a.chronologicalPosition != null && b.chronologicalPosition != null) return a.chronologicalPosition - b.chronologicalPosition;
    const ad = (a as CanonicalLienStackEntry & { _sortDate?: number | null })._sortDate;
    const bd = (b as CanonicalLienStackEntry & { _sortDate?: number | null })._sortDate;
    if (ad == null && bd == null) return 0;
    if (ad == null) return 1;
    if (bd == null) return -1;
    return ad - bd;
  }).map(({ _sortDate: _ignored, ...entry }) => entry);
}

export function automaticTargetSecurityLienId(stack: CanonicalLienStackEntry[], titleSummaryInstrumentNumbers: string[]): string | null {
  const openSecurity = stack.filter((entry) => entry.status === "OPEN" && isSecurityLienIdentityType(entry.instrumentType));
  if (!openSecurity.length) return null;
  if (openSecurity.length === 1) return openSecurity[0].instrumentId;

  const summaryNumbers = new Set(titleSummaryInstrumentNumbers.map(normalizeInstrumentNumber).filter(Boolean));
  const allOpenSecurityLiensSummarized = openSecurity.every((entry) => {
    const number = normalizeInstrumentNumber(entry.instrumentNumber);
    return Boolean(number && summaryNumbers.has(number));
  });
  if (!allOpenSecurityLiensSummarized) return null;

  const first = openSecurity.find((entry) => entry.chronologicalPosition === 1 && entry.priorityConfidence === "high");
  return first?.instrumentId || null;
}

export function developedPositionForTarget(
  stack: CanonicalLienStackEntry[],
  targetInstrumentId: string | null,
  explicitPosition?: { value: string; hasEvidence: boolean },
): { value: string; basis: LienPriorityBasis; confidence: LienPriorityConfidence; evidence: EvidenceRef[]; evidenceIds: string[]; warning: string } {
  const target = targetInstrumentId ? stack.find((entry) => entry.instrumentId === targetInstrumentId) : undefined;
  if (explicitPosition?.value && !/^needs review$/i.test(explicitPosition.value) && explicitPosition.hasEvidence) {
    return {
      value: explicitPosition.value,
      basis: "EXPLICIT",
      confidence: "high",
      evidence: target?.evidence || [],
      evidenceIds: target?.evidenceIds || [],
      warning: target?.positionLabel && target.positionLabel !== "Needs review" && target.positionLabel.toLowerCase() !== explicitPosition.value.toLowerCase()
        ? `Expressly stated position (${explicitPosition.value}) differs from first-in-time screening position (${target.positionLabel}); examiner priority review required.`
        : target?.priorityWarning || "",
    };
  }
  if (!target || target.status !== "OPEN" || !target.chronologicalPosition) return { value: "Needs review", basis: "UNRESOLVED", confidence: "low", evidence: target?.evidence || [], evidenceIds: target?.evidenceIds || [], warning: target?.priorityWarning || "Target lien is not resolved in the open-lien stack." };
  const targetPosition = target.chronologicalPosition;
  const throughTarget = stack.filter((entry) => entry.status === "OPEN" && entry.chronologicalPosition != null && entry.chronologicalPosition <= targetPosition);
  const evidence = uniqueEvidence(throughTarget);
  return {
    value: target.positionLabel,
    basis: "FIRST_IN_TIME",
    confidence: target.priorityConfidence,
    evidence: evidence.refs,
    evidenceIds: evidence.ids,
    warning: target.priorityWarning,
  };
}

function requirement(code: string, type: ForeclosureRequirement["type"], severity: ForeclosureRequirement["severity"], title: string, action: string, entries: CanonicalLienStackEntry[] = []): ForeclosureRequirement {
  const evidence = uniqueEvidence(entries);
  return { code, type, severity, title, action, evidence: evidence.refs, evidenceIds: evidence.ids };
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
  const open = args.lienStack.filter((entry) => entry.status === "OPEN");
  const unknown = args.lienStack.filter((entry) => entry.status === "UNKNOWN");
  const target = args.targetInstrumentId ? open.find((entry) => entry.instrumentId === args.targetInstrumentId) : undefined;
  const targetPosition = target?.chronologicalPosition ?? null;
  const senior = targetPosition ? open.filter((entry) => entry.chronologicalPosition != null && entry.chronologicalPosition < targetPosition) : [];
  const junior = targetPosition ? open.filter((entry) => entry.chronologicalPosition != null && entry.chronologicalPosition > targetPosition) : [];
  const requirements: ForeclosureRequirement[] = [];

  if (args.selectionRequired || !target) requirements.push(requirement("TARGET_LIEN_SELECTION", "EVIDENCE", "BLOCKING", "Foreclosure target lien is unresolved.", "Develop the controlling security lien from packet evidence before relying on amount, position, payoff, notice, or cure analysis. Examiner selection should be used only when the packet cannot support an automatic target.", open.concat(unknown)));
  if (target && (!clean(args.targetAmount) || /^needs review$/i.test(args.targetAmount))) requirements.push(requirement("TARGET_LIEN_AMOUNT", "EVIDENCE", "BLOCKING", "Target lien amount is unresolved.", "Confirm the original/recorded lien amount from the controlling security instrument or title-report source evidence.", [target]));
  if (target && (!clean(args.targetPosition) || /^needs review$/i.test(args.targetPosition))) requirements.push(requirement("TARGET_LIEN_POSITION", "PRIORITY_REVIEW", "BLOCKING", "Target lien position cannot be developed from the available recording evidence.", "Resolve lien-status, recording-date, sequence, or priority evidence before foreclosure treatment is finalized.", [target]));
  if (target?.priorityWarning) requirements.push(requirement("PRIORITY_EXCEPTION_REVIEW", "PRIORITY_REVIEW", "REVIEW", target.priorityWarning, "Apply the governing state/jurisdiction priority rule before treating the chronological stack as legal priority.", [target]));
  if (args.targetPositionBasis === "FIRST_IN_TIME" && args.targetPositionConfidence !== "high") requirements.push(requirement("FIRST_IN_TIME_CONFIDENCE", "PRIORITY_REVIEW", "REVIEW", "Lien position is developed from first-in-time chronology but carries a priority exception or sequencing uncertainty.", "Examiner should confirm the applicable priority exception before foreclosure referral/export is finalized.", target ? [target] : []));

  for (const entry of unknown) {
    requirements.push(requirement(`LIEN_STATUS_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "EVIDENCE", "REVIEW", `Lien status unresolved: ${entry.instrumentType} ${entry.instrumentNumber} · ${entry.amount}.`, "Determine whether this lien identity is open, released, satisfied, or otherwise no longer affecting title before relying on the final lien count or priority stack.", [entry]));
  }
  for (const entry of senior) {
    requirements.push(requirement(`SENIOR_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "PAYOFF_REVIEW", "REVIEW", `Senior open encumbrance: ${entry.positionLabel} · ${entry.instrumentType} ${entry.instrumentNumber} · ${entry.amount}.`, "Confirm whether the foreclosure will remain subject to this senior interest or whether payoff, subordination, release, or other treatment is required for the intended foreclosure outcome.", [entry]));
  }
  for (const entry of junior) {
    requirements.push(requirement(`JUNIOR_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "NOTICE_REVIEW", "REVIEW", `Junior open encumbrance: ${entry.positionLabel} · ${entry.instrumentType} ${entry.instrumentNumber} · ${entry.amount}.`, "Confirm required notice, joinder, service, and foreclosure treatment for this junior interest under the governing jurisdiction and process.", [entry]));
  }
  for (const entry of open.filter((candidate) => candidate.priorityWarning && candidate.instrumentId !== target?.instrumentId)) {
    requirements.push(requirement(`STACK_EXCEPTION_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "PRIORITY_REVIEW", "REVIEW", `${entry.instrumentType} ${entry.instrumentNumber}: ${entry.priorityWarning}`, "Resolve the priority exception before relying on the lien-stack order for foreclosure treatment.", [entry]));
  }

  const deduped = [...new Map(requirements.map((item) => [item.code, item])).values()];
  return {
    method: "FIRST_IN_TIME_WITH_EXCEPTION_GATES",
    status: deduped.some((item) => item.severity === "BLOCKING") ? "CURATIVE_REQUIRED" : deduped.length ? "REVIEW" : "READY",
    targetInstrumentId: target?.instrumentId || null,
    targetAmount: args.targetAmount,
    targetPosition: args.targetPosition,
    targetPositionBasis: args.targetPositionBasis,
    targetPositionConfidence: args.targetPositionConfidence,
    seniorLienIds: senior.map((entry) => entry.instrumentId),
    juniorLienIds: junior.map((entry) => entry.instrumentId),
    openLienCount: open.length,
    lienStack: args.lienStack,
    requirements: deduped,
  };
}
