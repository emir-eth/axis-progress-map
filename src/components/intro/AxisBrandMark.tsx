"use client";

import "./preloader.css";

interface AxisBrandMarkProps {
  className?: string;
  /** Full preloader size, or compact header mark */
  variant?: "hero" | "nav";
}

export function AxisBrandMark({
  className = "",
  variant = "hero",
}: AxisBrandMarkProps) {
  const root = `axis-brand-mark${variant === "nav" ? " axis-brand-mark--nav" : ""}${className ? ` ${className}` : ""}`;
  const size = variant === "nav" ? 52 : 152;

  return (
    <div className={root}>
      <div className="axis-brand-mark__logo-wrap">
        <div className="axis-logo-scene" aria-hidden="true">
          <div className="axis-logo-spin">
            <div className="axis-logo-stack">
              <img
                src="/axis-symbol-logo.svg"
                alt=""
                width={size}
                height={size}
                decoding="async"
              />
              <img
                src="/axis-symbol-logo.svg"
                alt=""
                width={size}
                height={size}
                decoding="async"
              />
              <img
                src="/axis-symbol-logo.svg"
                alt=""
                width={size}
                height={size}
                decoding="async"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="axis-brand-mark__wordmark" aria-hidden>
        <span className="axis-brand-mark__wordmark-line">AXIS</span>
        <span className="axis-brand-mark__wordmark-line">PROGRESS MAP</span>
      </div>
      <span className="sr-only">Axis Progress Map</span>
    </div>
  );
}
