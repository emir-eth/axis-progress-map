"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check } from "lucide-react";
import { isValidWalletAddress } from "@/lib/format";
import { useLocale } from "./LocaleProvider";

interface WalletEntryFormProps {
  initialAddress?: string;
  autoFocus?: boolean;
  locked?: boolean;
  lockedDisplay?: string;
  onValidSubmit?: (address: string) => void;
}

function normalizeAddressInput(value: string): string {
  const v = value.trim();
  if (!v) return v;
  return v.startsWith("0x") || v.startsWith("0X") ? v : `0x${v}`;
}

export function WalletEntryForm({
  initialAddress = "",
  autoFocus = true,
  locked = false,
  lockedDisplay,
  onValidSubmit,
}: WalletEntryFormProps) {
  const { messages: m } = useLocale();
  const [address, setAddress] = useState(initialAddress);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus || locked) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus, locked]);

  const trimmed = address.trim();
  const candidate = normalizeAddressInput(trimmed);
  const isValid = useMemo(
    () => candidate.length > 2 && isValidWalletAddress(candidate),
    [candidate],
  );
  const showInvalid =
    touched && trimmed.length > 0 && !isValidWalletAddress(candidate);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    const value = normalizeAddressInput(address);
    if (!isValidWalletAddress(value)) {
      setError(m.wallet.errorInvalid);
      return;
    }
    setError(null);
    onValidSubmit?.(value);
  }

  const borderClass = locked
    ? "border-ink"
    : error || showInvalid
      ? "border-danger"
      : isValid
        ? "border-accent"
        : "border-border-strong focus-within:border-ink";

  return (
    <form onSubmit={onSubmit} className="w-full max-w-xl">
      <p className="eng-label mb-3 text-text-muted">{m.wallet.label}</p>
      <label htmlFor="wallet" className="sr-only">
        {m.wallet.labelSr}
      </label>

      <div
        className={`flex items-stretch border bg-bg transition-[border-color] duration-200 ${borderClass} ${
          locked ? "pointer-events-none" : ""
        }`}
      >
        <input
          ref={inputRef}
          id="wallet"
          name="wallet"
          type="text"
          spellCheck={false}
          autoComplete="off"
          disabled={locked}
          placeholder={m.wallet.placeholder}
          value={locked && lockedDisplay ? lockedDisplay : address}
          onChange={(e) => {
            setAddress(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => setTouched(true)}
          className="min-w-0 flex-1 bg-transparent px-4 py-3.5 font-mono text-[14px] text-text outline-none placeholder:text-text-dim disabled:text-text sm:px-5 sm:py-4"
        />
        {isValid && !locked && (
          <span
            className="flex items-center pr-2 text-accent"
            aria-label={m.wallet.validAria}
          >
            <Check size={16} strokeWidth={2} />
          </span>
        )}
        <button
          type="submit"
          disabled={locked || (!isValid && trimmed.length > 0)}
          className="inline-flex shrink-0 items-center gap-2 border-l border-inherit bg-ink px-3 font-mono text-[12px] tracking-[0.12em] text-bg transition hover:bg-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 sm:px-5 sm:text-[13px] sm:tracking-[0.14em]"
        >
          {m.wallet.submit}
          <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {error || showInvalid ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error ?? m.wallet.errorLooksWrong}
        </p>
      ) : (
        <p className="mt-3 text-[13px] text-text-muted">{m.wallet.hint}</p>
      )}
    </form>
  );
}
