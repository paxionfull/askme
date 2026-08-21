/**
 * DEV-only taste board — compare button accents, surfaces, and type pairings.
 * Does not change PRODUCT/DESIGN; pick here, then carbonize.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";

type AccentOption = {
  id: string;
  label: string;
  note: string;
  accent: string;
  accentHover: string;
  onAccent: string;
  soft: string;
};

type SurfaceOption = {
  id: string;
  label: string;
  note: string;
  surface: string;
  raised: string;
  border: string;
  ink: string;
  muted: string;
};

type TypeOption = {
  id: string;
  label: string;
  note: string;
  ui: string;
  reading: string;
  google?: string;
};

const ACCENTS: AccentOption[] = [
  {
    id: "indigo",
    label: "Indigo（当前）",
    note: "Linear 系 · 易显 AI 默认",
    accent: "#5e6ad2",
    accentHover: "#4f5abf",
    onAccent: "#ffffff",
    soft: "#f3f4fb",
  },
  {
    id: "ink",
    label: "近黑",
    note: "冷静产品面 · 少彩",
    accent: "#171717",
    accentHover: "#0a0a0a",
    onAccent: "#fafafa",
    soft: "#f4f4f5",
  },
  {
    id: "slate",
    label: "石板灰",
    note: "工具感 · 非紫",
    accent: "#334155",
    accentHover: "#1e293b",
    onAccent: "#f8fafc",
    soft: "#f1f5f9",
  },
  {
    id: "teal",
    label: "深青",
    note: "科技但不甜",
    accent: "#0f766e",
    accentHover: "#0d9488",
    onAccent: "#ecfdf5",
    soft: "#f0fdfa",
  },
  {
    id: "olive",
    label: "橄榄",
    note: "暖工具 · 少见",
    accent: "#3f6212",
    accentHover: "#4d7c0f",
    onAccent: "#f7fee7",
    soft: "#f7fee7",
  },
  {
    id: "rust",
    label: "铁锈",
    note: "强调有温度 · 慎用面积",
    accent: "#9a3412",
    accentHover: "#c2410c",
    onAccent: "#fff7ed",
    soft: "#fff7ed",
  },
  {
    id: "forest",
    label: "墨绿",
    note: "稳重 · 阅读产品常见",
    accent: "#14532d",
    accentHover: "#166534",
    onAccent: "#f0fdf4",
    soft: "#ecfdf5",
  },
  {
    id: "navy",
    label: "墨蓝",
    note: "非亮紫蓝 · 偏编辑感",
    accent: "#1e3a5f",
    accentHover: "#254a73",
    onAccent: "#f8fafc",
    soft: "#eef2f7",
  },
];

const SURFACES: SurfaceOption[] = [
  {
    id: "current",
    label: "冷白（当前）",
    note: "fafafa / 纯白 raised · 易显廉价",
    surface: "#fafafa",
    raised: "#ffffff",
    border: "#e5e5e5",
    ink: "#171717",
    muted: "#737373",
  },
  {
    id: "warm-paper",
    label: "暖纸",
    note: "石膏纸感 · 非奶油滥调",
    surface: "#f4f1ea",
    raised: "#fbf9f5",
    border: "#e4dfd4",
    ink: "#1c1917",
    muted: "#78716c",
  },
  {
    id: "stone",
    label: "暖石灰",
    note: "略暖灰舞台 · raised 非纯白",
    surface: "#f0eeea",
    raised: "#f7f6f3",
    border: "#ddd9d1",
    ink: "#1c1917",
    muted: "#6f6b64",
  },
  {
    id: "sage",
    label: "薄青灰",
    note: "极轻绿灰 · 安静",
    surface: "#eef1ef",
    raised: "#f6f8f6",
    border: "#d7ddd9",
    ink: "#1a1f1c",
    muted: "#6b736e",
  },
  {
    id: "mist",
    label: "冷雾灰",
    note: "蓝灰雾 · 非白卡片",
    surface: "#eceff3",
    raised: "#f5f7fa",
    border: "#d5dae2",
    ink: "#15181e",
    muted: "#667084",
  },
  {
    id: "clay",
    label: "陶土雾",
    note: "微粉灰 · 柔和",
    surface: "#f2ebe6",
    raised: "#faf6f2",
    border: "#e2d6ce",
    ink: "#1c1917",
    muted: "#7c7168",
  },
  {
    id: "graphite",
    label: "石墨浅底",
    note: "更深舞台 · 对比更强",
    surface: "#e8e8e8",
    raised: "#f3f3f3",
    border: "#cfcfcf",
    ink: "#111111",
    muted: "#5c5c5c",
  },
];

const TYPES: TypeOption[] = [
  {
    id: "geist",
    label: "Geist 通吃（当前）",
    note: "Vercel 脸 · 你已觉通用",
    ui: '"Geist", ui-sans-serif, system-ui, sans-serif',
    reading: '"Geist", ui-sans-serif, system-ui, sans-serif',
  },
  {
    id: "plex-split",
    label: "Plex Sans + Plex Serif",
    note: "UI 工具 / 正文阅读拆开",
    ui: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    reading: '"IBM Plex Serif", Georgia, serif',
    google: "IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600",
  },
  {
    id: "source-split",
    label: "Source Sans 3 + Source Serif 4",
    note: "清晰 UI + 耐读正文",
    ui: '"Source Sans 3", ui-sans-serif, system-ui, sans-serif',
    reading: '"Source Serif 4", Georgia, serif',
    google: "Source+Sans+3:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;600",
  },
  {
    id: "public-news",
    label: "Public Sans + Newsreader",
    note: "产品无衬线 + 杂志阅读",
    ui: '"Public Sans", ui-sans-serif, system-ui, sans-serif',
    reading: '"Newsreader", Georgia, serif',
    google: "Public+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;600",
  },
  {
    id: "instrument-literata",
    label: "Instrument Sans + Literata",
    note: "现代 chrome + 长文气质",
    ui: '"Instrument Sans", ui-sans-serif, system-ui, sans-serif',
    reading: '"Literata", Georgia, serif',
    google: "Instrument+Sans:wght@400;500;600&family=Literata:opsz,wght@7..72,400;600",
  },
  {
    id: "schibsted-lora",
    label: "Schibsted Grotesk + Lora",
    note: "略有个性的无衬线 + 书卷",
    ui: '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif',
    reading: '"Lora", Georgia, serif',
    google: "Schibsted+Grotesk:wght@400;500;600&family=Lora:wght@400;600",
  },
  {
    id: "plex-only",
    label: "仅 IBM Plex Sans",
    note: "同族通吃 · 比 Geist 少滥",
    ui: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    reading: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
    google: "IBM+Plex+Sans:wght@400;500;600",
  },
  {
    id: "bricolage-source",
    label: "Bricolage + Source Serif",
    note: "UI 更有辨识 · 正文稳",
    ui: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif',
    reading: '"Source Serif 4", Georgia, serif',
    google:
      "Bricolage+Grotesque:opsz,wght@12..96,400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;600",
  },
];

function loadGoogleFamilies() {
  const families = TYPES.map((t) => t.google).filter(Boolean) as string[];
  if (families.length === 0) return;
  const href = `https://fonts.googleapis.com/css2?${families
    .map((f) => `family=${f}`)
    .join("&")}&display=swap`;
  const existing = document.getElementById("askme-design-choices-fonts");
  if (existing) {
    (existing as HTMLLinkElement).href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = "askme-design-choices-fonts";
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export default function DesignChoicesPage() {
  const [accentId, setAccentId] = useState("ink");
  const [surfaceId, setSurfaceId] = useState("warm-paper");
  const [typeId, setTypeId] = useState("plex-split");

  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[1];
  const surface = SURFACES.find((s) => s.id === surfaceId) ?? SURFACES[1];
  const type = TYPES.find((t) => t.id === typeId) ?? TYPES[1];

  useEffect(() => {
    loadGoogleFamilies();
  }, []);

  const picks = useMemo(
    () => ({
      accent: accent.label,
      surface: surface.label,
      type: type.label,
    }),
    [accent.label, surface.label, type.label],
  );

  return (
    <div
      className="min-h-screen"
      style={{
        background: surface.surface,
        color: surface.ink,
        fontFamily: type.ui,
      }}
    >
      <header
        className="sticky top-0 z-10 border-b px-5 py-4"
        style={{
          borderColor: surface.border,
          background: surface.raised,
        }}
      >
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]"
              style={{ fontFamily: type.ui }}
            >
              Design choices
            </h1>
            <p
              className="mt-1 m-0 max-w-[60ch] text-[0.8125rem] leading-5"
              style={{ color: surface.muted }}
            >
              只筛选、不写入规范。点选下方方案，看右侧组合预览；满意后把三选一告诉我再改 PRODUCT /
              DESIGN。
            </p>
          </div>
          <p className="m-0 text-[0.75rem] font-medium" style={{ color: surface.muted }}>
            已选：{picks.accent} · {picks.surface} · {picks.type}
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-8">
          <Section title="1 · 按钮主色">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {ACCENTS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setAccentId(opt.id)}
                  className="rounded-[6px] border p-3 text-left"
                  style={{
                    borderColor: accentId === opt.id ? opt.accent : surface.border,
                    background: surface.raised,
                    boxShadow:
                      accentId === opt.id
                        ? `0 0 0 2px color-mix(in srgb, ${opt.accent} 35%, transparent)`
                        : "none",
                  }}
                >
                  <div className="mb-2 flex h-9 items-center gap-2">
                    <span
                      className="inline-flex h-8 items-center rounded-[5px] px-3 text-[0.8125rem] font-medium"
                      style={{ background: opt.accent, color: opt.onAccent }}
                    >
                      Save
                    </span>
                    <span
                      className="inline-flex h-8 items-center rounded-[5px] border px-3 text-[0.8125rem] font-medium"
                      style={{
                        borderColor: surface.border,
                        color: surface.ink,
                        background: surface.raised,
                      }}
                    >
                      Cancel
                    </span>
                  </div>
                  <div className="text-[0.8125rem] font-semibold tracking-[-0.015em]">{opt.label}</div>
                  <div className="mt-0.5 text-[0.75rem]" style={{ color: surface.muted }}>
                    {opt.note}
                  </div>
                  <code className="mt-2 block text-[0.6875rem]" style={{ color: surface.muted }}>
                    {opt.accent}
                  </code>
                </button>
              ))}
            </div>
          </Section>

          <Section title="2 · 背景 / 纸色">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {SURFACES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSurfaceId(opt.id)}
                  className="overflow-hidden rounded-[6px] border text-left"
                  style={{
                    borderColor: surfaceId === opt.id ? accent.accent : opt.border,
                    boxShadow:
                      surfaceId === opt.id
                        ? `0 0 0 2px color-mix(in srgb, ${accent.accent} 30%, transparent)`
                        : "none",
                  }}
                >
                  <div className="flex h-24" style={{ background: opt.surface }}>
                    <div
                      className="m-3 flex flex-1 flex-col justify-between rounded-[6px] border p-3"
                      style={{
                        background: opt.raised,
                        borderColor: opt.border,
                        color: opt.ink,
                      }}
                    >
                      <span className="text-[0.8125rem] font-semibold">Panel</span>
                      <span className="text-[0.75rem]" style={{ color: opt.muted }}>
                        Raised on stage
                      </span>
                    </div>
                  </div>
                  <div
                    className="border-t px-3 py-2"
                    style={{ borderColor: opt.border, background: opt.raised }}
                  >
                    <div className="text-[0.8125rem] font-semibold" style={{ color: opt.ink }}>
                      {opt.label}
                    </div>
                    <div className="text-[0.75rem]" style={{ color: opt.muted }}>
                      {opt.note}
                    </div>
                    <code className="mt-1 block text-[0.6875rem]" style={{ color: opt.muted }}>
                      {opt.surface} / {opt.raised}
                    </code>
                  </div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="3 · 字体（UI / 正文）">
            <div className="grid gap-3 lg:grid-cols-2">
              {TYPES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTypeId(opt.id)}
                  className="rounded-[6px] border p-4 text-left"
                  style={{
                    borderColor: typeId === opt.id ? accent.accent : surface.border,
                    background: surface.raised,
                    boxShadow:
                      typeId === opt.id
                        ? `0 0 0 2px color-mix(in srgb, ${accent.accent} 30%, transparent)`
                        : "none",
                  }}
                >
                  <div
                    className="text-[0.8125rem] font-semibold tracking-[-0.015em]"
                    style={{ fontFamily: opt.ui }}
                  >
                    {opt.label}
                  </div>
                  <div
                    className="mt-0.5 text-[0.75rem]"
                    style={{ color: surface.muted, fontFamily: type.ui }}
                  >
                    {opt.note}
                  </div>
                  <p
                    className="mt-3 m-0 text-[0.8125rem] font-medium"
                    style={{ fontFamily: opt.ui }}
                  >
                    UI · Add source · Ready · Settings
                  </p>
                  <p
                    className="mt-2 m-0 text-[0.9375rem] leading-6"
                    style={{ fontFamily: opt.reading, color: surface.ink }}
                  >
                    正文 · OpenAI 暂停强化学习训练两周。Askme
                    帮你扫完更新、筛出重点，再追问细节。
                  </p>
                </button>
              ))}
            </div>
          </Section>
        </div>

        <aside
          className="h-fit rounded-[6px] border lg:sticky lg:top-24"
          style={{ borderColor: surface.border, background: surface.raised }}
        >
          <div className="border-b px-4 py-3" style={{ borderColor: surface.border }}>
            <h2 className="m-0 text-[0.9375rem] font-semibold tracking-[-0.02em]">组合预览</h2>
            <p className="mt-1 m-0 text-[0.75rem]" style={{ color: surface.muted }}>
              当前三选一的实时效果
            </p>
          </div>
          <div className="px-4 py-4" style={{ background: surface.surface }}>
            <div
              className="rounded-[6px] border p-4"
              style={{ borderColor: surface.border, background: surface.raised }}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3
                    className="m-0 text-[1.25rem] font-semibold tracking-[-0.03em]"
                    style={{ fontFamily: type.ui }}
                  >
                    Sources
                  </h3>
                  <p
                    className="mt-1 m-0 text-[0.8125rem]"
                    style={{ color: surface.muted, fontFamily: type.ui }}
                  >
                    No sources yet. Keys stay on this machine.
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-[5px] px-2.5 py-1 text-[0.6875rem] font-semibold"
                  style={{ background: accent.soft, color: accent.accent }}
                >
                  Local
                </span>
              </div>
              <p
                className="mt-4 m-0 text-[0.9375rem] leading-6"
                style={{ fontFamily: type.reading }}
              >
                Anthropic 年化营收突破节点。把这篇加入 Ask，继续追问细节。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-8 rounded-[5px] px-3 text-[0.8125rem] font-medium"
                  style={{
                    background: accent.accent,
                    color: accent.onAccent,
                    fontFamily: type.ui,
                  }}
                >
                  Add your first source
                </button>
                <button
                  type="button"
                  className="h-8 rounded-[5px] border px-3 text-[0.8125rem] font-medium"
                  style={{
                    borderColor: surface.border,
                    background: surface.raised,
                    color: surface.ink,
                    fontFamily: type.ui,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
          <div
            className="space-y-2 border-t px-4 py-3 text-[0.75rem]"
            style={{ borderColor: surface.border }}
          >
            <Row k="Accent" v={accent.accent} muted={surface.muted} ink={surface.ink} />
            <Row k="Surface" v={surface.surface} muted={surface.muted} ink={surface.ink} />
            <Row k="Raised" v={surface.raised} muted={surface.muted} ink={surface.ink} />
            <Row
              k="UI font"
              v={type.ui.split(",")[0].replace(/"/g, "")}
              muted={surface.muted}
              ink={surface.ink}
            />
            <Row
              k="Reading"
              v={type.reading.split(",")[0].replace(/"/g, "")}
              muted={surface.muted}
              ink={surface.ink}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="m-0 mb-3 text-[0.9375rem] font-semibold tracking-[-0.02em]">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v, muted, ink }: { k: string; v: string; muted: string; ink: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: muted }}>{k}</span>
      <code className="text-right" style={{ color: ink }}>
        {v}
      </code>
    </div>
  );
}
