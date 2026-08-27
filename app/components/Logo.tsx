"use client";

import { LOGO_SRC } from "./logo-src";

export function Logo({
  height = 28,
}: {
  height?: number;
  showWord?: boolean;
}) {
  return (
    <span className="brand" style={{ gap: 12 }}>
      <img
        src={LOGO_SRC}
        alt="CybridTech Solutions"
        style={{ height, width: "auto", display: "block" }}
      />
    </span>
  );
}
