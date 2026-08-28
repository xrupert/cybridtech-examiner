import { NextRequest } from "next/server";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { AuditFinding, EvidenceRef, FieldEvidence, VeraExam } from "@/lib/vera";

export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim() || "Not Stated";
}

function evidenceParagraphs(evidence: EvidenceRef[]): Paragraph[] {
  if (!evidence.length) return [new Paragraph({ children: [new TextRun({ text: "Evidence: Not Stated", italics: true })] })];
  return evidence.map((item) => new Paragraph({
    children: [
      new TextRun({ text: `Evidence — ${item.sourceFile ? `${item.sourceFile}, ` : ""}Page ${item.page}, ${item.documentType}: `, bold: true }),
      new TextRun({ text: `“${item.quote}”` }),
    ],
  }));
}

function fieldBlock(field: FieldEvidence): Paragraph[] {
  return [
    new Paragraph({ children: [new TextRun({ text: `${field.field}: `, bold: true }), new TextRun(text(field.value))] }),
    ...evidenceParagraphs(field.evidence),
    new Paragraph({ children: [new TextRun({ text: "Proof/Reason: ", bold: true }), new TextRun(text(field.proofReason))] }),
  ];
}

function findingBlock(finding: AuditFinding): Paragraph[] {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_3,
      children: [new TextRun({ text: `${finding.number}. ${finding.question}`, bold: true })],
    }),
    new Paragraph({ children: [new TextRun({ text: "Response: ", bold: true }), new TextRun(text(finding.response))] }),
    ...evidenceParagraphs(finding.evidence),
    ...(finding.critical ? [new Paragraph({ children: [new TextRun({ text: "Status: ", bold: true }), new TextRun(finding.status === "PASS" || finding.status === "NOT_APPLICABLE" ? "PASS" : "FAIL")] })] : []),
    new Paragraph({ children: [new TextRun({ text: "Proof/Reason: ", bold: true }), new TextRun(text(finding.proofReason))] }),
    ...(finding.commentary ? [new Paragraph({ children: [new TextRun({ text: "Commentary: ", bold: true }), new TextRun(finding.commentary)] })] : []),
  ];
}

function metaTable(exam: VeraExam): Table {
  const row = (labelA: string, valueA: string, labelB: string, valueB: string) => new TableRow({ children: [
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: labelA, bold: true })] })] }),
    new TableCell({ children: [new Paragraph(valueA)] }),
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: labelB, bold: true })] })] }),
    new TableCell({ children: [new Paragraph(valueB)] }),
  ] });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      row("Search Type", text(exam.searchType), "Client Order#", text(exam.clientOrder)),
      row("Property Address", text(exam.propertyAddress), "Effective Date", text(exam.searchEffectiveDate)),
      row("State / County", `${text(exam.state)} / ${text(exam.county)}`, "MIN#", text(exam.minNumber)),
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    const exam = await request.json() as VeraExam;
    if (!exam || !Array.isArray(exam.findings)) return Response.json({ error: "A completed VERA review is required." }, { status: 400 });

    const children: Array<Paragraph | Table> = [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "CYBRIDTECH SOLUTIONS", bold: true, size: 30 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Title Report Review Summary", bold: true })] }),
      metaTable(exam),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Property & Tax Information", bold: true })] }),
      ...exam.summaryEvidence.flatMap(fieldBlock),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Required Question Responses", bold: true })] }),
      ...exam.findings.flatMap(findingBlock),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Title Report / Run Sheet Accuracy Audit", bold: true })] }),
      new Paragraph(`Vesting Deed Information: ${text(exam.audit.vestingDeed)}`),
      new Paragraph(`Chain of Title: ${text(exam.audit.chainOfTitle)}`),
      new Paragraph(`Mortgage Information: ${text(exam.audit.mortgageInformation)}`),
      new Paragraph(`Tax Information: ${text(exam.audit.taxInformation)}`),
      new Paragraph(`Judgments and Liens: ${text(exam.audit.judgmentsAndLiens)}`),
      new Paragraph(`Easements and Restrictions: ${text(exam.audit.easementsAndRestrictions)}`),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Pass/Fail Determination", bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: "Status: ", bold: true }), new TextRun(text(exam.status))] }),
      new Paragraph({ children: [new TextRun({ text: "Reason: ", bold: true }), new TextRun(text(exam.reason))] }),
      new Paragraph({ children: [new TextRun({ text: "Confirmation: ", bold: true }), new TextRun(text(exam.confirmation))] }),
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Notes / Comments", bold: true })] }),
      new Paragraph(text(exam.notes || "None")),
      new Paragraph({ children: [new TextRun({ text: `Prepared ${new Date(exam.extractedAt || Date.now()).toLocaleString()} · CybridTech Examiner · VERA v3 structure`, italics: true, size: 18 })] }),
    ];

    const document = new Document({ sections: [{ properties: {}, children }] });
    const buffer = await Packer.toBuffer(document);
    const name = (exam.clientOrder && exam.clientOrder !== "Not Provided" ? exam.clientOrder : "title-review").replace(/[^a-z0-9-_]+/gi, "-");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${name}-VERA-v3.docx"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate VERA DOCX.";
    return Response.json({ error: message }, { status: 500 });
  }
}
