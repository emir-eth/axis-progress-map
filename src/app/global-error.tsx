"use client";

/**
 * Root-level error boundary. Must define its own <html> and <body>
 * because it replaces the root layout when that layout fails.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#F3F2EC",
          color: "#151713",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#5C6058",
            }}
          >
            Axis Progress Map
          </p>
          <h1 style={{ margin: "12px 0 0", fontSize: 28, fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ margin: "12px 0 0", color: "#4A4E47", fontSize: 14 }}>
            Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 24,
              padding: "10px 16px",
              border: "1px solid #252923",
              background: "#252923",
              color: "#F3F2EC",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
