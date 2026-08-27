import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CybridTech Examiner",
  description: "Upload a title report. Receive a Vera exam worksheet with critic Pass/Fail.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="ambient" />
        <div className="canvas">{children}</div>
      </body>
    </html>
  );
}
