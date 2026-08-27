import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CybridTech Examiner | Title Review Workbench",
  description: "Upload title reports, verify Vera review fields, run a second-pass critic, and export branded CybridTech review documents.",
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
