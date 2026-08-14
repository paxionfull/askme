export type DigestCategory = {
  id: string;
  name: string;
  criteria: string;
};

export type DigestProfile = {
  version: number;
  input_mode: "titles" | "full";
  focus: {
    enabled: boolean;
    criteria: string;
    max_events: number;
    exclusive: boolean;
  };
  categories: DigestCategory[];
  ignore: {
    criteria: string;
  };
  cluster: {
    enabled: boolean;
  };
};

export function defaultDigestProfile(): DigestProfile {
  return {
    version: 1,
    input_mode: "titles",
    focus: {
      enabled: true,
      criteria: "",
      max_events: 10,
      exclusive: true,
    },
    categories: [{ id: "cat-1", name: "", criteria: "" }],
    ignore: {
      criteria: "",
    },
    cluster: {
      enabled: true,
    },
  };
}

export function newDigestProfileSkillMd(id: string, description = "结构化概览 skill"): string {
  return `---
name: ${id}
description: ${description}
---

结构化概览 skill（分类 → 重点关注 → 类内聚类 → 渲染）。

规则与类别定义见同目录 \`digest_profile.json\`。系统按配置执行两步 LLM，再渲染为固定 Markdown，不直接使用本文件作为生成 prompt。
`;
}
