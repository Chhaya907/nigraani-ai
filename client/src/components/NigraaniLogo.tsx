import React from "react";

export function NigraaniShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Outer Protective Vigilance Shield */}
      <path
        d="M12 2.5L4.5 5.8V11.5C4.5 16.8 7.8 21.2 12 22.5C16.2 21.2 19.5 16.8 19.5 11.5V5.8L12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Vigilance Eye / Aperture Lens */}
      <path
        d="M7.6 12C9.2 9.7 14.8 9.7 16.4 12C14.8 14.3 9.2 14.3 7.6 12Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Central AI Analytical Core Node */}
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      {/* Upper Data Integrity Indicator */}
      <path
        d="M12 6.8V8.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface NigraaniLogoProps {
  variant?: "horizontal" | "icon";
  theme?: "dark" | "light";
  size?: "sm" | "md" | "lg";
  className?: string;
  iconClassName?: string;
}

export function NigraaniLogo({
  variant = "horizontal",
  theme = "light",
  size = "md",
  className = "",
  iconClassName = "",
}: NigraaniLogoProps) {
  const isDark = theme === "dark";

  // Icon container sizing
  const iconContainerSize =
    size === "sm" ? "h-8 w-8 rounded-xl" : size === "lg" ? "h-11 w-11 rounded-2xl" : "h-9 w-9 rounded-xl";
  const iconSize = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-6 w-6" : "h-5 w-5";

  // Typography sizing
  const titleClass =
    size === "sm"
      ? "text-xs font-bold tracking-tight"
      : size === "lg"
      ? "text-lg font-bold tracking-tight"
      : "text-sm font-bold tracking-tight";

  const subtitleClass =
    size === "sm"
      ? "text-[8px] font-semibold tracking-[0.16em]"
      : size === "lg"
      ? "text-[10px] font-semibold tracking-[0.18em]"
      : "text-[9px] font-semibold tracking-[0.16em]";

  const iconElement = (
    <div
      className={`grid ${iconContainerSize} shrink-0 place-items-center ${
        isDark
          ? "bg-[#109b82] text-white shadow-md shadow-[#109b82]/25"
          : "bg-[#0b2934] text-[#1cd2ad] shadow-sm"
      } ${iconClassName}`}
    >
      <NigraaniShieldIcon className={iconSize} />
    </div>
  );

  if (variant === "icon") {
    return <div className={`inline-flex items-center ${className}`}>{iconElement}</div>;
  }

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      {iconElement}
      <div className="min-w-0 leading-tight">
        <p className={`truncate ${titleClass} ${isDark ? "text-white" : "text-[#173e49]"}`}>
          NIGRAANI AI
        </p>
        <p
          className={`truncate uppercase ${subtitleClass} ${
            isDark ? "text-[#76b8ac]" : "text-[#1d7d70]"
          }`}
        >
          AI-Powered MPLAD Monitoring
        </p>
      </div>
    </div>
  );
}

export default NigraaniLogo;
