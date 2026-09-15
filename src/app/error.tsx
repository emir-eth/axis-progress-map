"use client";

/**
 * Route-level error boundary required by the App Router.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="content-shell flex min-h-[50vh] flex-col justify-center px-5 py-16 sm:px-8">
      <p className="eng-label">Error</p>
      <h1 className="mt-3 font-display text-2xl text-ink">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-lg text-sm text-text-muted">
        An unexpected error occurred while rendering this page.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex w-fit border border-ink bg-ink px-4 py-2.5 text-sm text-bg transition hover:bg-text"
      >
        Try again
      </button>
    </div>
  );
}
