import { LOGO_SRC } from "./logo-src";

type LogoProps = {
  height?: number;
  tone?: "dark" | "letterhead";
  className?: string;
};

// The supplied Cybrid Title artwork lives on a square transparent canvas.
// Render only the visible mark so the logo is not visually reduced to a thumbnail.
const SOURCE_SIZE = 1254;
const MARK_BOUNDS = { left: 273, top: 225, width: 706, height: 770 } as const;

export function Logo({ height = 34, className }: LogoProps) {
  const scale = height / MARK_BOUNDS.height;
  const renderedSourceSize = SOURCE_SIZE * scale;
  const width = MARK_BOUNDS.width * scale;

  return (
    <span
      className={className}
      role="img"
      aria-label="Cybrid Title"
      style={{
        position: "relative",
        display: "inline-block",
        width,
        height,
        overflow: "hidden",
        flex: "0 0 auto",
      }}
    >
      <img
        src={LOGO_SRC}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute",
          width: renderedSourceSize,
          height: renderedSourceSize,
          maxWidth: "none",
          left: -MARK_BOUNDS.left * scale,
          top: -MARK_BOUNDS.top * scale,
          display: "block",
        }}
      />
    </span>
  );
}
