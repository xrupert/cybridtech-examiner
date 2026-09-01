import { reduceQcChecks } from "./title-qc-engine";
import type { ReviewDecisionRecord } from "./review-decisions";
import type { CanonicalInstrument, ForeclosureRequirement, TitleReviewResult } from "./title-domain";

function normalized(value: string | undefined): string {
  return (value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sourceState(instrument: CanonicalInstrument): "CONFIRMED" | "UNCONFIRMED" | "NOT_STATED" {
  if (instrument.evidenceState === "CONFIRMED") return "CONFIRMED";
  return instrument.evidence.length ? "UNCONFIRMED" : "NOT_STATED";
}

function readinessFromRequirements(requirements: ForeclosureRequirement[]): "READY" | "REVIEW" | "CURATIVE_REQUIRED" {
  const operational = requirements.filter((item) => item.severity !== "INFO");
  if (operational.some((item) => item.severity === "BLOCKING" || item.type === "CURE")) return "CURATIVE_REQUIRED";
  return operational.length ? "REVIEW" : "READY";
}

export function applyReviewDecisions(review: TitleReviewResult, decisions: ReviewDecisionRecord[]): TitleReviewResult {
  const byCheck = new Map(decisions.map((decision) => [decision.checkId, decision]));
  let checks = review.qc.checks.map((check) => {
    const decision = byCheck.get(check.id);
    if (!decision) return check;
    if (decision.decision === "CONFIRM") return check;
    if (decision.decision === "NEEDS_EVIDENCE") {
      return {
        ...check,
        status: "CANNOT_CONFIRM" as const,
        summary: `${check.summary} Examiner requires additional evidence: ${decision.reason}`,
      };
    }
    return {
      ...check,
      status: decision.correctedStatus || check.status,
      summary: decision.correctedValue?.trim() || check.summary,
      recommendedAction: decision.correctedStatus === "PASS" || decision.correctedStatus === "NOT_APPLICABLE"
        ? "No curative action required after examiner correction."
        : check.recommendedAction,
    };
  });

  const record = {
    ...review.record,
    targetLien: { ...review.record.targetLien },
    foreclosureAnalysis: {
      ...review.record.foreclosureAnalysis,
      requirements: [...review.record.foreclosureAnalysis.requirements],
      seniorLienIds: [...review.record.foreclosureAnalysis.seniorLienIds],
      juniorLienIds: [...review.record.foreclosureAnalysis.juniorLienIds],
    },
  };

  const targetDecision = byCheck.get("TARGET_LIEN_FOUND");
  if (targetDecision?.decision === "CORRECT" && targetDecision.correctedStatus === "PASS" && targetDecision.correctedValue?.trim()) {
    const needle = normalized(targetDecision.correctedValue);
    const mortgage = record.mortgages.find((candidate) => normalized(candidate.instrumentNumber) === needle || normalized(candidate.id) === needle);
    if (mortgage) {
      const stackEntry = record.foreclosureAnalysis.lienStack.find((entry) => entry.instrumentId === mortgage.id);
      const documentaryState = sourceState(mortgage);
      const beneficiary = mortgage.parties.find((party) => /holder|beneficiary|mortgagee|lender/i.test(party.role))?.name || "Needs review";
      const positionValue = stackEntry?.positionLabel || "Needs review";
      const positionState = positionValue === "Needs review"
        ? "NOT_STATED" as const
        : stackEntry?.priorityConfidence === "high" && documentaryState === "CONFIRMED"
          ? "CONFIRMED" as const
          : "UNCONFIRMED" as const;

      record.targetLien = {
        ...record.targetLien,
        instrumentId: mortgage.id,
        instrumentNumber: { value: mortgage.instrumentNumber, state: documentaryState, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: `Examiner selected the foreclosure target: ${targetDecision.reason}` },
        amount: { value: mortgage.amount, state: mortgage.amount === "Needs review" ? "NOT_STATED" : documentaryState, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: "Amount from examiner-selected target lien source" },
        beneficiary: { value: beneficiary, state: beneficiary === "Needs review" ? "NOT_STATED" : documentaryState, evidence: mortgage.evidence, evidenceIds: mortgage.evidenceIds, basis: "Beneficiary/holder from examiner-selected target lien source" },
        position: { value: positionValue, state: positionState, evidence: stackEntry?.evidence || mortgage.evidence, evidenceIds: stackEntry?.evidenceIds || mortgage.evidenceIds, basis: positionValue === "Needs review" ? "Priority remains unresolved after target selection" : `Developed from the verified lien stack using ${stackEntry?.priorityBasis || "UNRESOLVED"}` },
        positionBasis: stackEntry?.priorityBasis || "UNRESOLVED",
        positionConfidence: stackEntry?.priorityConfidence || "low",
        selectionRequired: false,
      };

      const seniorLienIds = stackEntry?.chronologicalPosition
        ? record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "OPEN" && entry.chronologicalPosition != null && entry.chronologicalPosition < stackEntry.chronologicalPosition!).map((entry) => entry.instrumentId)
        : [];
      const juniorLienIds = stackEntry?.chronologicalPosition
        ? record.foreclosureAnalysis.lienStack.filter((entry) => entry.status === "OPEN" && entry.chronologicalPosition != null && entry.chronologicalPosition > stackEntry.chronologicalPosition!).map((entry) => entry.instrumentId)
        : [];

      const removable = new Set(["TARGET_LIEN_SELECTION"]);
      if (mortgage.amount !== "Needs review" && documentaryState === "CONFIRMED") removable.add("TARGET_LIEN_AMOUNT");
      if (positionValue !== "Needs review" && positionState === "CONFIRMED") removable.add("TARGET_LIEN_POSITION");
      record.foreclosureAnalysis.requirements = record.foreclosureAnalysis.requirements.filter((item) => !removable.has(item.code));
      record.foreclosureAnalysis.targetInstrumentId = mortgage.id;
      record.foreclosureAnalysis.targetAmount = mortgage.amount;
      record.foreclosureAnalysis.targetPosition = positionValue;
      record.foreclosureAnalysis.targetPositionBasis = stackEntry?.priorityBasis || "UNRESOLVED";
      record.foreclosureAnalysis.targetPositionConfidence = stackEntry?.priorityConfidence || "low";
      record.foreclosureAnalysis.seniorLienIds = seniorLienIds;
      record.foreclosureAnalysis.juniorLienIds = juniorLienIds;
      record.foreclosureAnalysis.status = readinessFromRequirements(record.foreclosureAnalysis.requirements);

      checks = checks.map((check) => {
        if (check.id === "TARGET_LIEN_FOUND") return { ...check, status: "PASS" as const, summary: `Examiner selected ${mortgage.instrumentNumber} as the foreclosure target. Documentary facts remain independently auditable.` };
        if (check.id === "TARGET_LIEN_AMOUNT" && mortgage.amount !== "Needs review" && documentaryState === "CONFIRMED") return { ...check, status: "PASS" as const, summary: `Target lien amount ${mortgage.amount} is source-confirmed on the examiner-selected lien.` };
        if (check.id === "TARGET_LIEN_POSITION_ESTABLISHED" && positionValue !== "Needs review" && positionState === "CONFIRMED") return { ...check, status: "PASS" as const, summary: `Target lien position develops as ${positionValue} from the verified lien stack.` };
        return check;
      });
    }
  }

  const positionDecision = byCheck.get("TARGET_LIEN_POSITION_ESTABLISHED");
  if (positionDecision?.decision === "CORRECT" && positionDecision.correctedStatus === "PASS" && positionDecision.correctedValue?.trim()) {
    const position = positionDecision.correctedValue.trim();
    record.targetLien.position = {
      value: position,
      state: "EXAMINER_CONFIRMED",
      evidence: record.targetLien.position.evidence,
      evidenceIds: record.targetLien.position.evidenceIds,
      basis: `Examiner-confirmed priority determination: ${positionDecision.reason}`,
    };
    record.targetLien.positionBasis = "EXAMINER";
    record.targetLien.positionConfidence = "high";
    record.foreclosureAnalysis.targetPosition = position;
    record.foreclosureAnalysis.targetPositionBasis = "EXAMINER";
    record.foreclosureAnalysis.targetPositionConfidence = "high";
    record.foreclosureAnalysis.requirements = record.foreclosureAnalysis.requirements.filter((item) => item.code !== "TARGET_LIEN_POSITION");
    record.foreclosureAnalysis.status = readinessFromRequirements(record.foreclosureAnalysis.requirements);
  }

  return {
    ...review,
    record,
    qc: reduceQcChecks(
      { profileId: review.qc.profileId, profileVersion: review.qc.profileVersion, profileName: review.qc.profileName },
      checks,
    ),
  };
}
