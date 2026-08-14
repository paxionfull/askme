import { type DefaultDays, formatDaysLabel, normalizeDefaultDays } from "../hooks/useSettings";
import { useLocale } from "../i18n/LocaleContext";

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
  const { t, locale } = useLocale();
  const sizeClass = size === "sm" ? "px-2 py-1.5 text-xs" : "px-2 py-1.5 text-sm";

  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(normalizeDefaultDays(Number(e.target.value)))}
      aria-label={t("rangeAriaLabel")}
      className={`ui-select disabled:opacity-50 ${sizeClass} ${className}`}
    >
      <option value={1}>{formatDaysLabel(1, locale)}</option>
      <option value={3}>{formatDaysLabel(3, locale)}</option>
    </select>
  );
}
