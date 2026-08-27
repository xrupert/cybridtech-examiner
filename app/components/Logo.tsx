type LogoProps = {
  height?: number;
  tone?: "dark" | "letterhead";
  className?: string;
};

export function Logo({ height = 32, tone = "dark", className }: LogoProps) {
  const src = tone === "letterhead"
    ? "/cybridtech-logo-letterhead.png"
    : "/cybridtech-logo-dark.png";

  return (
    <img
      src={src}
      alt="CybridTech Solutions"
      className={className}
      style={{ height, width: "auto", display: "block" }}
    />
  );
}
