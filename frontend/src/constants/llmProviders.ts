export interface LlmProvider {
  id: string;
  name: string;
  apiBase: string;
  keyPlaceholder: string;
  /** 该厂商模型名是否已经自带 litellm provider 前缀（如 anthropic/）*/
  modelPrefix: string;
  popularModels: string[];
  defaultThinkingStyle?: string;
}

export const THINKING_STYLES = [
  { id: "", label: "自动推断（根据模型名）" },
  { id: "thinking_type", label: "thinking.type（GLM / Kimi / DeepSeek / MiMo）" },
  { id: "enable_thinking", label: "enable_thinking 布尔值（通义 Qwen）" },
  { id: "claude", label: "thinking.budget_tokens（Anthropic Claude）" },
  { id: "reasoning_effort", label: "reasoning_effort（OpenAI o 系列）" },
  { id: "none", label: "不支持深度思考" },
] as const;

export const LLM_PROVIDERS: LlmProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
    modelPrefix: "openai/",
    popularModels: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"],
    defaultThinkingStyle: "none",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiBase: "https://api.deepseek.com/v1",
    keyPlaceholder: "sk-...",
    modelPrefix: "openai/",
    popularModels: ["deepseek-chat", "deepseek-reasoner"],
    defaultThinkingStyle: "thinking_type",
  },
  {
    id: "qwen",
    name: "通义千问",
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyPlaceholder: "sk-...",
    modelPrefix: "openai/",
    popularModels: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3-235b-a22b"],
    defaultThinkingStyle: "enable_thinking",
  },
  {
    id: "moonshot",
    name: "Kimi / Moonshot",
    apiBase: "https://api.moonshot.cn/v1",
    keyPlaceholder: "sk-...",
    modelPrefix: "openai/",
    popularModels: ["kimi-k2-0711-preview", "moonshot-v1-8k", "moonshot-v1-32k"],
    defaultThinkingStyle: "thinking_type",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    apiBase: "https://open.bigmodel.cn/api/paas/v4",
    keyPlaceholder: "xxxxxxxx.xxxxxxxx",
    modelPrefix: "openai/",
    popularModels: ["glm-4-flash", "glm-4-air", "glm-4", "glm-z1-flash"],
    defaultThinkingStyle: "thinking_type",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    apiBase: "https://api.siliconflow.cn/v1",
    keyPlaceholder: "sk-...",
    modelPrefix: "openai/",
    popularModels: ["Qwen/Qwen3-235B-A22B", "deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1"],
    defaultThinkingStyle: "enable_thinking",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    apiBase: "",
    keyPlaceholder: "sk-ant-...",
    modelPrefix: "anthropic/",
    popularModels: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    defaultThinkingStyle: "claude",
  },
  {
    id: "ollama",
    name: "Ollama (本地)",
    apiBase: "http://localhost:11434/v1",
    keyPlaceholder: "ollama",
    modelPrefix: "openai/",
    popularModels: [],
    defaultThinkingStyle: "none",
  },
  {
    id: "custom",
    name: "自定义",
    apiBase: "",
    keyPlaceholder: "sk-...",
    modelPrefix: "",
    popularModels: [],
    defaultThinkingStyle: "",
  },
];

export function detectProvider(apiBase: string): LlmProvider | undefined {
  if (!apiBase.trim()) return undefined;
  return LLM_PROVIDERS.find(
    (p) => p.apiBase && apiBase.trim().startsWith(p.apiBase.replace(/\/$/, "")),
  );
}
