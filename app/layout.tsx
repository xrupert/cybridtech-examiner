import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cybrid Title | Title QC, Curative & Client Data",
  description: "Batch title-report QC with evidence-backed findings, foreclosure-readiness and curative review, plus configurable CSV and JSON client data exports.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="ambient" aria-hidden="true" />
        <div className="canvas">{children}</div>
      </body>
    </html>
  );
}
