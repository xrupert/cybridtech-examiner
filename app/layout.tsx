import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cybrid Title | Evidence-First Title Review",
  description: "Upload a title-report packet for a VERA v3 evidence review or build a verified Run Sheet from recorded title documents.",
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
