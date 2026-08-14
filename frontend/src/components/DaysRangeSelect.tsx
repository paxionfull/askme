import { type DefaultDays, normalizeDefaultDays } from "../hooks/useSettings";

interface DaysRangeSelectProps {
  value: DefaultDays;
  onChange: (days: DefaultDays) => void;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export default function DaysRangeSelect({
  value,
  onChange,
  disabled = false,
  className = "",
  size = "md",
}: DaysRangeSelectProps) {
  const sizeClass = size === "sm" ? "px-2 py-1.5 text-xs" : "px-2 py-1.5 text-sm";

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(normalizeDefaultDays(Number(e.target.value)))}
      aria-label="时间范围"
      className={`ui-select disabled:opacity-50 ${sizeClass} ${className}`}
    >
      <option value={1}>今天</option>
      <option value={3}>近 3 天</option>
    </select>
  );
}
