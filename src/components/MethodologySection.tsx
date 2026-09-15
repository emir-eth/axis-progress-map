"use client";

export function MethodologySection() {
  return (
    <div>
      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3 sm:gap-10">
        {[
          {
            title: "Pull",
            body: "Public Hub attempts",
          },
          {
            title: "Match",
            body: "Tasks → skill / environment data",
          },
          {
            title: "Split",
            body: "Signed vs unsigned from Hub",
          },
        ].map((step) => (
          <div key={step.title}>
            <p className="font-display text-sm tracking-[0.12em] text-ink">
              {step.title.toUpperCase()}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {step.body}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-8 eng-label text-text-muted">
        Read-only · No connect · No private keys
      </p>
      <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-text-muted">
        Trajectories and signed / unsigned come straight from Hub. I don’t
        re-check every attempt on-chain just to show this page.
      </p>
    </div>
  );
}
