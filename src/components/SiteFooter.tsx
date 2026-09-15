import { XLogo } from "@/components/ui/XLogo";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="content-shell flex flex-col items-center gap-3 px-5 py-8 text-center sm:px-8 sm:py-10">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[13px] tracking-[0.12em] text-ink sm:text-[14px]">
          <span>Created by</span>
          <a
            href="https://x.com/emir_ethh"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-text-muted transition-colors duration-200 hover:text-ink"
            aria-label="emir_ethh on X"
          >
            <XLogo className="h-3.5 w-3.5" />
            <span>@emir_ethh</span>
          </a>
        </p>
        <p className="max-w-md text-[13px] leading-relaxed text-text-muted sm:text-[14px]">
          Unofficial. Not affiliated with Axis Robotics. Public data only — I
          never ask you to connect a wallet.
        </p>
      </div>
    </footer>
  );
}
