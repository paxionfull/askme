import { describe, expect, it } from "vitest";

import {
  isPlatformSkillId,
  parseSkillDirectoriesFromRelativeEntries,
} from "./skillDirectory";

type RelativeFileEntry = { relPath: string; file: File };

function makeFile(content: string, name: string): File {
  const file = new File([content], name, { type: "text/plain" });
  if (typeof file.text !== "function") {
    file.text = async () => content;
  }
  return file;
}

function entry(relPath: string, content: string): RelativeFileEntry {
  const name = relPath.split("/").pop() || relPath;
  return { relPath, file: makeFile(content, name) };
}

describe("isPlatformSkillId", () => {
  it("recognizes builtin platform skills", () => {
    expect(isPlatformSkillId("x-platform-discovery")).toBe(true);
    expect(isPlatformSkillId("zhihu-platform")).toBe(true);
    expect(isPlatformSkillId("reddit-platform-discovery")).toBe(true);
  });

  it("rejects regular discovery skills", () => {
    expect(isPlatformSkillId("reuters-discovery")).toBe(false);
    expect(isPlatformSkillId("")).toBe(false);
  });
});

describe("parseSkillDirectoriesFromRelativeEntries", () => {
  it("groups nested discovery folder paths", async () => {
    const entries: RelativeFileEntry[] = [
      entry("skills/discovery/demo-discovery/source.yaml", "id: demo\nname: Demo\n"),
      entry(
        "skills/discovery/demo-discovery/scripts/discover.py",
        "FEED_ID = 'website:demo'\n",
      ),
      entry("skills/discovery/demo-discovery/SKILL.md", "---\nname: demo\ndescription: d\n---\n"),
    ];

    const parsed = await parseSkillDirectoriesFromRelativeEntries(entries);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].skillId).toBe("demo-discovery");
    expect(parsed[0].slug).toBe("demo");
    expect(parsed[0].feedId).toBe("website:demo");
    expect(parsed[0].error).toBeUndefined();
  });

  it("rejects platform skill imports", async () => {
    const entries: RelativeFileEntry[] = [
      entry("x-platform-discovery/source.yaml", "id: x-platform\n"),
      entry("x-platform-discovery/scripts/discover.py", "PLATFORM = 'x'\n"),
    ];

    const parsed = await parseSkillDirectoriesFromRelativeEntries(entries);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].error).toMatch(/内置平台 skill/);
  });
});
