import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconBrief(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 4h10v12H5z" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}

export function IconSources(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6h12M4 10h12M4 14h8" />
      <circle cx="15.5" cy="14" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.15 2.7h3.7l.4 1.7c.48.18.92.43 1.32.74l1.65-.45 1.85 3.2-1.28 1.1c.1.42.15.86.15 1.31s-.05.89-.15 1.31l1.28 1.1-1.85 3.2-1.65-.45a5.7 5.7 0 0 1-1.32.74l-.4 1.7H8.15l-.4-1.7a5.7 5.7 0 0 1-1.32-.74l-1.65.45-1.85-3.2 1.28-1.1A5.8 5.8 0 0 1 4.06 10c0-.45.05-.89.15-1.31L2.93 7.59l1.85-3.2 1.65.45c.4-.31.84-.56 1.32-.74l.4-1.7z" />
      <circle cx="10" cy="10" r="2.35" />
    </svg>
  );
}

export function IconHelp(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.5a2.2 2.2 0 0 1 4 1.2c0 1.5-2.2 1.5-2.2 3" />
      <circle cx="10" cy="14.2" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLanguage(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M2.5 10h15M10 2.5c2 2.5 2 12.5 0 15M10 2.5c-2 2.5-2 12.5 0 15" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15.5 8.2a5.5 5.5 0 1 0 1 3.3" />
      <path d="M15.5 4.5v3.7h-3.7" />
    </svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l8 8M14 6l-8 8" />
    </svg>
  );
}

export function IconChevron(props: IconProps & { direction?: "up" | "down" }) {
  const { direction = "down", ...rest } = props;
  return (
    <svg {...base} {...rest}>
      {direction === "up" ? <path d="M6 12l4-4 4 4" /> : <path d="M6 8l4 4 4-4" />}
    </svg>
  );
}
