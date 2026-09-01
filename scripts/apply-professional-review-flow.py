from pathlib import Path

path = Path("app/demo/page.tsx")
text = path.read_text()

text = text.replace('import { buildVeraAccuracyAudit, veraPassFailReason } from "@/lib/vera-accuracy-audit";\n', '')
text = text.replace(
    'import { ReviewDecisionControls, type ExaminerDecision, type SavedDecision } from "./ReviewDecisionControls";\n',
    'import type { ExaminerDecision, SavedDecision } from "./ReviewDecisionControls";\nimport { ProfessionalReviewReport } from "./ProfessionalReviewReport";\n',
)

text = text.replace('  const selectedAudit = selected?.review ? buildVeraAccuracyAudit(selected.review.record, selected.review.qc) : [];\n', '')
text = text.replace('  const selectedPassFail = selected?.review ? veraPassFailReason(selected.review.qc) : null;\n', '')
text = text.replace('  const selectedIsForeclosure = isForeclosureReview(selected?.review);\n', '')

text = text.replace(
    '      {items.length ? <><section className={styles.metrics}>',
    '      {items.length > 1 || !selected?.review ? <><section className={styles.metrics}>',
    1,
)

start_marker = '      {selected?.review ? <>'
end_marker = '      {completeItems.length ? <section className={`${styles.panel} ${styles.exportPanel}`}>'
start = text.index(start_marker)
end = text.index(end_marker, start)
replacement = '''      {selected?.review ? <ProfessionalReviewReport
        review={selected.review}
        fileName={selected.fileName}
        reviewComplete={selectedReviewComplete}
        reviewedCount={selectedVeraReviewed}
        currentDecision={(checkId) => decisionFor(selected, checkId)?.decision}
        onSaved={(_check, saved) => applySavedDecision(selected, saved)}
        onOpenSource={(page) => openSourcePage(selected.fileName, page)}
        onConfirmAllClean={() => void confirmAllClean(selected)}
      /> : null}\n\n'''
text = text[:start] + replacement + text[end:]

text = text.replace(
    'if (veraPending.length) warnings.push(`${item.fileName}: ${veraPending.length} of the Vera 20 questions still require examiner disposition.`);',
    'if (veraPending.length) warnings.push(`${item.fileName}: examiner disposition required for ${veraPending.map((check) => `Q${check.legacyQuestionNumber} ${check.label}`).join("; ")}.`);',
)
text = text.replace(
    'if (supplementalPending.length) warnings.push(`${item.fileName}: ${supplementalPending.length} supplemental order/foreclosure exception${supplementalPending.length === 1 ? "" : "s"} still require examiner disposition.`);',
    'if (supplementalPending.length) warnings.push(`${item.fileName}: supplemental review required — ${supplementalPending.map((check) => `${check.label}: ${check.summary}`).join("; ")}.`);',
)
text = text.replace('<h2>Reviewed client export</h2>', '<h2>Professional review document & data export</h2>')
text = text.replace(
    '<b>Review export blocked until:</b>',
    '<b>Professional review cannot be released until these specific items are resolved:</b>',
)
text = text.replace('>Print / Save review</button>', '>Print / Save professional review</button>')

path.write_text(text)
print("Professional review flow applied")
