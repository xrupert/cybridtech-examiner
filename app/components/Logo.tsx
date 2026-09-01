import { LOGO_SRC } from "./logo-src";

type LogoProps = {
  height?: number;
  tone?: "dark" | "letterhead";
  className?: string;
};

// LOGO_SRC is already a tightly cropped, lossless derivative of the supplied
// Cybrid Title artwork. Render it at its own aspect ratio — never crop it again.
const ARTWORK_WIDTH = 738;
const ARTWORK_HEIGHT = 802;

export function Logo({ height = 34, className }: LogoProps) {
  const width = height * (ARTWORK_WIDTH / ARTWORK_HEIGHT);

  return (
    <img
      className={className}
      src={LOGO_SRC}
      alt="Cybrid Title"
      width={width}
      height={height}
      style={{
        width,
        height,
        display: "block",
        objectFit: "contain",
        flex: "0 0 auto",
      }}
    />
  );
}
