import { LOGO_SRC } from "./logo-src";

type LogoProps = {
  height?: number;
  tone?: "dark" | "letterhead";
  className?: string;
};

export function Logo({ height = 34, className }: LogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="Cybrid Title"
      className={className}
      style={{ height, width: "auto", display: "block", borderRadius: Math.max(4, Math.round(height * 0.12)) }}
    />
  );
}
