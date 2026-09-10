type LogoProps = {
  height?: number;
  tone?: "dark" | "letterhead";
  className?: string;
};

// Original approved Cybrid Title artwork; preserve the complete square canvas.
export function Logo({ height = 64, className }: LogoProps) {
  return (
    <img
      className={className}
      src="/cybrid-title.png"
      alt="Cybrid Title"
      width={height}
      height={height}
      style={{ width: height, height, display: "block", objectFit: "contain", flex: "0 0 auto" }}
    />
  );
}
