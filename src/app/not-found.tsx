import Link from "next/link";

export default function NotFound() {
  return (
    <div className="content-shell flex min-h-[50vh] flex-col justify-center px-5 py-16 sm:px-8">
      <p className="eng-label">404</p>
      <h1 className="mt-3 font-display text-2xl text-ink">Page not found</h1>
      <p className="mt-3 text-sm text-text-muted">
        That route does not exist in Axis Progress Map.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex w-fit border border-ink px-4 py-2.5 text-sm text-ink transition hover:bg-ink hover:text-bg"
      >
        Back to home
      </Link>
    </div>
  );
}
