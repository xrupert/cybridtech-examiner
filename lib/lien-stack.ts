import type {
  CanonicalInstrument,
  CanonicalLienStackEntry,
  ForeclosureAnalysis,
  ForeclosureRequirement,
  LienPriorityBasis,
  LienPriorityConfidence,
} from "./title-domain";
import type { EvidenceRef } from "./vera";

function clean(value: string): string {
  const text = String(value || "").trim();
  return text && !/^needs review$/i.test(text) ? text : "";
}

function normalizeInstrumentNumber(value: string): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isEncumbrance(instrument: CanonicalInstrument): boolean {
  return /mortgage|deed of trust|security deed|judgment|lien|mechanic|hoa|assessment|ucc|tax lien/i.test(instrument.type)
    && !/release|satisfaction|reconveyance|discharge|termination/i.test(instrument.type);
}

function statusFromInstrument(instrument: CanonicalInstrument, releasedNumbers: Set<string>): "OPEN" | "RELEASED" | "UNKNOWN" {
  const instrumentNumber = normalizeInstrumentNumber(instrument.instrumentNumber);
  if (instrumentNumber && releasedNumbers.has(instrumentNumber)) return "RELEASED";
  if (/release|satisf|paid|closed|terminated|reconveyed|discharged|cancelled/i.test(instrument.status)) return "RELEASED";
  if (/open|active|unreleased|outstanding/i.test(instrument.status)) return "OPEN";
  return "UNKNOWN";
}

function releaseNumbers(releases: CanonicalInstrument[]): Set<string> {
  const numbers = new Set<string>();
  for (const release of releases) {
    for (const value of release.referencedInstrumentNumbers || []) {
      const normalized = normalizeInstrumentNumber(value);
      if (normalized) numbers.add(normalized);
    }
  }
  return numbers;
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

export function buildLienStack(instruments: CanonicalInstrument[], releases: CanonicalInstrument[]): CanonicalLienStackEntry[] {
  const releasedNumbers = releaseNumbers(releases);
  const source = instruments.filter(isEncumbrance).map((instrument) => ({
    instrument,
    date: dateKey(instrument.recordingDate),
    sequence: sequenceKey(instrument.instrumentNumber),
    status: statusFromInstrument(instrument, releasedNumbers),
  }));

  const active = source.filter((item) => item.status !== "RELEASED");
  active.sort((a, b) => {
    if (a.date == null && b.date == null) return 0;
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    if (a.date !== b.date) return a.date - b.date;
    if (a.sequence != null && b.sequence != null && a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1;
    return 0;
  });

  const activePositions = new Map<string, { position: number | null; confidence: LienPriorityConfidence; warning: string }>();
  for (let index = 0; index < active.length; index += 1) {
    const current = active[index];
    const sameDay = active.filter((candidate) => current.date != null && candidate.date === current.date);
    const ambiguousTie = sameDay.length > 1 && sameDay.some((candidate) => candidate.sequence == null) && !sameDay.every((candidate) => candidate.sequence != null);
    const statutoryWarning = exceptionWarning(current.instrument.type);
    const missingDate = current.date == null;
    const warning = missingDate
      ? "Recording date is unresolved, so first-in-time position cannot be calculated."
      : ambiguousTie
        ? "Multiple open encumbrances share the same recording date without a reliable recording sequence; exact priority needs examiner review."
        : statutoryWarning;
    const confidence: LienPriorityConfidence = missingDate || ambiguousTie ? "low" : statutoryWarning ? "medium" : "high";
    activePositions.set(current.instrument.id, { position: missingDate || ambiguousTie ? null : index + 1, confidence, warning });
  }

  return source.map(({ instrument, status }) => {
    const position = status === "RELEASED" ? null : activePositions.get(instrument.id)?.position ?? null;
    const confidence = status === "RELEASED" ? "high" : activePositions.get(instrument.id)?.confidence || "low";
    const warning = status === "RELEASED" ? "Released/satisfied instrument is excluded from the open-lien priority stack." : activePositions.get(instrument.id)?.warning || "";
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
    };
  }).sort((a, b) => {
    if (a.status === "RELEASED" && b.status !== "RELEASED") return 1;
    if (b.status === "RELEASED" && a.status !== "RELEASED") return -1;
    if (a.chronologicalPosition == null && b.chronologicalPosition == null) return 0;
    if (a.chronologicalPosition == null) return 1;
    if (b.chronologicalPosition == null) return -1;
    return a.chronologicalPosition - b.chronologicalPosition;
  });
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
  if (!target || !target.chronologicalPosition) return { value: "Needs review", basis: "UNRESOLVED", confidence: "low", evidence: target?.evidence || [], evidenceIds: target?.evidenceIds || [], warning: target?.priorityWarning || "Target lien is not resolved in the open-lien stack." };
  const throughTarget = stack.filter((entry) => entry.status !== "RELEASED" && entry.chronologicalPosition != null && entry.chronologicalPosition <= target.chronologicalPosition);
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
  const active = args.lienStack.filter((entry) => entry.status !== "RELEASED");
  const target = args.targetInstrumentId ? active.find((entry) => entry.instrumentId === args.targetInstrumentId) : undefined;
  const targetPosition = target?.chronologicalPosition ?? null;
  const senior = targetPosition ? active.filter((entry) => entry.chronologicalPosition != null && entry.chronologicalPosition < targetPosition) : [];
  const junior = targetPosition ? active.filter((entry) => entry.chronologicalPosition != null && entry.chronologicalPosition > targetPosition) : [];
  const requirements: ForeclosureRequirement[] = [];

  if (args.selectionRequired || !target) requirements.push(requirement("TARGET_LIEN_SELECTION", "EVIDENCE", "BLOCKING", "Foreclosure target lien is unresolved.", "Identify the exact lien being enforced before relying on amount, position, payoff, notice, or cure analysis.", active));
  if (target && (!clean(args.targetAmount) || /^needs review$/i.test(args.targetAmount))) requirements.push(requirement("TARGET_LIEN_AMOUNT", "EVIDENCE", "BLOCKING", "Target lien amount is unresolved.", "Confirm the original/recorded lien amount from the controlling security instrument or title-report source evidence.", [target]));
  if (target && (!clean(args.targetPosition) || /^needs review$/i.test(args.targetPosition))) requirements.push(requirement("TARGET_LIEN_POSITION", "PRIORITY_REVIEW", "BLOCKING", "Target lien position cannot be developed from the available recording evidence.", "Resolve missing recording dates/sequence or obtain priority evidence before foreclosure treatment is finalized.", [target]));
  if (target?.priorityWarning) requirements.push(requirement("PRIORITY_EXCEPTION_REVIEW", "PRIORITY_REVIEW", "REVIEW", target.priorityWarning, "Apply the governing state/jurisdiction priority rule before treating the chronological stack as legal priority.", [target]));
  if (args.targetPositionBasis === "FIRST_IN_TIME" && args.targetPositionConfidence !== "high") requirements.push(requirement("FIRST_IN_TIME_CONFIDENCE", "PRIORITY_REVIEW", "REVIEW", "Lien position is developed from first-in-time chronology but carries a priority exception or sequencing uncertainty.", "Examiner should confirm the applicable priority exception before foreclosure referral/export is finalized.", target ? [target] : []));

  for (const entry of senior) {
    requirements.push(requirement(`SENIOR_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "PAYOFF_REVIEW", "REVIEW", `Senior open encumbrance: ${entry.positionLabel} · ${entry.instrumentType} ${entry.instrumentNumber} · ${entry.amount}.`, "Confirm whether the foreclosure will remain subject to this senior interest or whether payoff, subordination, release, or other treatment is required for the intended foreclosure outcome.", [entry]));
  }
  for (const entry of junior) {
    requirements.push(requirement(`JUNIOR_${normalizeInstrumentNumber(entry.instrumentNumber) || entry.instrumentId}`, "NOTICE_REVIEW", "REVIEW", `Junior open encumbrance: ${entry.positionLabel} · ${entry.instrumentType} ${entry.instrumentNumber} · ${entry.amount}.`, "Confirm required notice, joinder, service, and foreclosure treatment for this junior interest under the governing jurisdiction and process.", [entry]));
  }
  for (const entry of active.filter((candidate) => candidate.priorityWarning && candidate.instrumentId !== target?.instrumentId)) {
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
    openLienCount: active.length,
    lienStack: args.lienStack,
    requirements: deduped,
  };
}
