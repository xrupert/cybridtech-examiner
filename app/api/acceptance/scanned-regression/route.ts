import { NextResponse } from "next/server";
import { createCanvas } from "@napi-rs/canvas";
import { reviewTitlePdf } from "@/lib/canonical-title-engine";

export const runtime = "nodejs";
export const maxDuration = 800;

function objectBuffer(id: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${id} 0 obj\n`, "binary"), body, Buffer.from("\nendobj\n", "binary")]);
}

function jpegPdf(jpeg: Buffer, width: number, height: number): ArrayBuffer {
  const content = Buffer.from("q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n", "ascii");
  const objects = [
    objectBuffer(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii")),
    objectBuffer(2, Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii")),
    objectBuffer(3, Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>", "ascii")),
    objectBuffer(4, Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"), content, Buffer.from("endstream", "ascii")])),
    objectBuffer(5, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, "ascii"),
      jpeg,
      Buffer.from("\nendstream", "ascii"),
    ])),
  ];
  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const offsets: number[] = [0];
  let cursor = header.length;
  for (const obj of objects) { offsets.push(cursor); cursor += obj.length; }
  const xrefOffset = cursor;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  for (let id = 1; id <= objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, "0")} 00000 n `);
  const trailer = `${xref.join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const pdf = Buffer.concat([header, ...objects, Buffer.from(trailer, "ascii")]);
  return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
}

function makeScannedTruthPacket(): ArrayBuffer {
  const width = 1000;
  const height = 1420;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  const lines: Array<[string, boolean]> = [
    ["TITLE SEARCH REPORT", true],
    ["Client: Ncala", false],
    ["TS Number: TS-SCAN-001", false],
    ["Order Number: TS-SCAN-001", false],
    ["Search Type: Current Owner Search", false],
    ["State: GA     County: Fulton", false],
    ["Property Address: 123 Main St, Atlanta, GA 30303", false],
    ["Parcel ID: 14-0001-0001     Search Effective Date: 08/30/2026", false],
    ["Borrower: Jane Doe     Current Owner: Jane Doe", false],
    ["RUN SHEET / TITLE SUMMARY", true],
    ["Warranty Deed D123 | Book/Page 100/200 | Recorded 01/15/2020", false],
    ["Grantor John Smith | Grantee Jane Doe | Consideration $200,000.00", false],
    ["Deed of Trust M456 | Book/Page 100/201 | Recorded 01/16/2020", false],
    ["Mortgagor Jane Doe | Beneficiary Example Bank | Amount $150,000.00", false],
    ["Lien Position: First Lien", false],
    ["Legal Description: Lot 1, Block A, Example Subdivision, Fulton County, Georgia.", false],
    ["Federal Tax Lien Search: None Found", false],
    ["Assignments: None referenced or required.", false],
    ["Releases/Satisfactions: None referenced.", false],
    ["Plat: Not referenced.     HOA: Not referenced.", false],
    ["SUPPORTING RECORDED DOCUMENTS", true],
    ["WARRANTY DEED — Instrument D123 — Book/Page 100/200", false],
    ["Document Date 01/14/2020 — Recording Date 01/15/2020", false],
    ["Grantor John Smith — Grantee Jane Doe — Consideration $200,000.00", false],
    ["Property: 123 Main St, Atlanta, GA 30303", false],
    ["Legal: Lot 1, Block A, Example Subdivision, Fulton County, Georgia.", false],
    ["DEED OF TRUST — Instrument M456 — Book/Page 100/201", false],
    ["Document Date 01/15/2020 — Recording Date 01/16/2020", false],
    ["Borrower/Mortgagor Jane Doe — Lender/Beneficiary Example Bank", false],
    ["Original Principal Amount $150,000.00 — Express Lien Position: First Lien", false],
    ["Property: 123 Main St, Atlanta, GA 30303", false],
    ["Legal: Lot 1, Block A, Example Subdivision, Fulton County, Georgia.", false],
  ];
  let y = 46;
  for (const [line, bold] of lines) {
    ctx.font = bold ? "bold 27px sans-serif" : "21px sans-serif";
    ctx.fillText(line, 38, y);
    y += bold ? 42 : 35;
  }
  const jpeg = canvas.toBuffer("image/jpeg", { quality: 0.82 });
  return jpegPdf(jpeg, width, height);
}

export async function GET() {
  try {
    const packet = makeScannedTruthPacket();
    const execution = await reviewTitlePdf(packet, "synthetic-scanned-current-owner.pdf", {
      clientName: "Ncala",
      requestedState: "AUTO",
      requestedSearchType: "Auto Detect",
    });
    const { record, qc } = execution.review;
    return NextResponse.json({
      expected: {
        orderType: "Current Owner Search", state: "GA", county: "Fulton", tsNumber: "TS-SCAN-001",
        borrower: "Jane Doe", currentOwner: "Jane Doe", propertyAddress: "123 Main St, Atlanta, GA 30303",
        deedInstrument: "D123", mortgageInstrument: "M456", mortgageAmount: "$150,000.00", lienPosition: "First Lien",
      },
      diagnostics: execution.diagnostics,
      actual: {
        orderType: record.orderType, state: record.state, county: record.county, tsNumber: record.tsNumber,
        borrower: record.borrower, currentOwner: record.currentOwner, propertyAddress: record.propertyAddress,
        runSheet: record.runSheet,
        mortgages: record.mortgages.map((item) => ({ type: item.type, instrumentNumber: item.instrumentNumber, amount: item.amount, bookPage: item.bookPage, recordingDate: item.recordingDate, parties: item.parties, evidence: item.evidence })),
        deeds: record.deeds.map((item) => ({ type: item.type, instrumentNumber: item.instrumentNumber, amount: item.amount, bookPage: item.bookPage, recordingDate: item.recordingDate, parties: item.parties, evidence: item.evidence })),
        targetLien: record.targetLien,
        qcStatus: qc.qcStatus,
        foreclosureReadiness: qc.foreclosureReadiness,
        checks: qc.checks,
        curativeIssues: qc.curativeIssues,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
