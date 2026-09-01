import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cybrid Title | Evidence-Backed Title Examination",
  description: "Evidence-backed title examination with Vera 20 review, report-to-source reconciliation, lien intelligence, examiner decisions, curative workflow and reviewed client exports.",
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
