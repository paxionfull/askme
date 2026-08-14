const BUNDLE_ROOT = "askme-skills";
const PLATFORM_ACCOUNTS_DIR = "platform-accounts";

const BUILTIN_PLATFORM_SKILLS = new Set([
  "x-platform-discovery",
  "zhihu-platform-discovery",
  "reddit-platform-discovery",
]);

const ALLOWED_SUFFIXES = new Set([".md", ".yaml", ".yml", ".py", ".txt", ".json"]);

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>;
};

export interface SkillDirectoryFile {
  path: string;
  content: string;
}

export interface ParsedSkillDirectory {
  skillId: string;
  slug: string;
  feedId: string;
  name: string;
  files: SkillDirectoryFile[];
  error?: string;
}

export interface PlatformAccountDirectoryRecord {
  feed_id: string;
  platform?: string;
  account_key?: string;
  user_type?: string;
  entry_url?: string;
  posts_url?: string;
  display_name?: string;
  list_api_path?: string;
  slug?: string;
  xsec_token?: string;
  group_id?: string | null;
}

interface RelativeFileEntry {
  relPath: string;
  file: File;
}

function isPlatformSkillId(skillId: string): boolean {
  const value = skillId.trim().toLowerCase();
  if (!value) return false;
  if (BUILTIN_PLATFORM_SKILLS.has(value)) return true;
  return /^(x|zhihu|reddit)-platform(-discovery)?$/.test(value);
}

function allowedRelativePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/") || normalized.includes("..")) return false;
  const dot = normalized.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_SUFFIXES.has(normalized.slice(dot).toLowerCase());
}

function slugFromSourceYaml(content: string): string | null {
  const match = content.match(/^\s*id:\s*([^\n#]+)/m);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, "") || null;
}

function skillIdFromFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("-discovery")) return trimmed;
  return `${trimmed}-discovery`;
}

function normalizeImportPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isSkippedImportPath(path: string): boolean {
  const normalized = normalizeImportPath(path);
  if (!normalized || normalized.startsWith(".") || normalized.startsWith("__MACOSX/")) return true;
  if (normalized === "README.txt" || normalized.endsWith("/README.txt")) return true;
  if (normalized.split("/").includes(PLATFORM_ACCOUNTS_DIR)) return true;
  return false;
}

function stripBundlePrefix(path: string): string {
  const normalized = normalizeImportPath(path);
  const parts = normalized.split("/");
  if (parts[0] === BUNDLE_ROOT && parts.length > 1) {
    return parts.slice(1).join("/");
  }
  return normalized;
}

function looksLikeFlatSkillDirectory(entries: RelativeFileEntry[]): boolean {
  const paths = entries
    .map((entry) => stripBundlePrefix(entry.relPath))
    .filter((path) => !isSkippedImportPath(path));
  if (paths.length === 0) return false;
  if (paths.some((path) => findDiscoverySegment(path.split("/")) >= 0)) return false;
  return paths.some((path) => path === "scripts/discover.py" || path.endsWith("/scripts/discover.py"));
}

function findDiscoverySegment(parts: string[]): number {
  return parts.findIndex((part) => part.endsWith("-discovery"));
}

const FLAT_SKILL_FOLDER_KEY = "__flat_skill__";

function inferSkillMeta(
  files: SkillDirectoryFile[],
  folderKey: string,
): Pick<ParsedSkillDirectory, "skillId" | "slug" | "feedId" | "name"> {
  const sourceYaml = files.find((file) => file.path === "source.yaml" || file.path === "source.yml");
  const slugFromYaml = sourceYaml ? slugFromSourceYaml(sourceYaml.content) : null;
  const resolvedFolderKey =
    folderKey === FLAT_SKILL_FOLDER_KEY
      ? slugFromYaml || "imported-skill"
      : folderKey;
  const skillId = resolvedFolderKey.endsWith("-discovery")
    ? resolvedFolderKey
    : skillIdFromFolderName(resolvedFolderKey) || resolvedFolderKey;
  const slug = slugFromYaml || skillId.replace(/-discovery$/, "");
  return {
    skillId,
    slug,
    feedId: `website:${slug}`,
    name: slug.replace(/-/g, " "),
  };
}

async function finalizeSkillGroups(grouped: Map<string, RelativeFileEntry[]>): Promise<ParsedSkillDirectory[]> {
  const parsed: ParsedSkillDirectory[] = [];
  for (const [folderKey, entries] of grouped.entries()) {
    const files: SkillDirectoryFile[] = [];
    for (const entry of entries) {
      files.push({ path: entry.relPath, content: await entry.file.text() });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    const meta = inferSkillMeta(files, folderKey);
    if (!files.some((file) => file.path === "scripts/discover.py")) {
      parsed.push({
        ...meta,
        files,
        error: `${meta.skillId} 缺少 scripts/discover.py`,
      });
      continue;
    }
    if (isPlatformSkillId(meta.skillId)) {
      parsed.push({
        ...meta,
        files,
        error: "内置平台 skill 不可导入。请使用「链接接入」添加 X / 知乎 / Reddit 账号。",
      });
      continue;
    }
    parsed.push({ ...meta, files });
  }
  return parsed.sort((a, b) => a.skillId.localeCompare(b.skillId));
}

function groupRelativeFileEntries(entries: RelativeFileEntry[]): Map<string, RelativeFileEntry[]> {
  const usableEntries = entries.filter((entry) => !isSkippedImportPath(entry.relPath));
  if (looksLikeFlatSkillDirectory(usableEntries)) {
    const grouped = new Map<string, RelativeFileEntry[]>();
    const bucket: RelativeFileEntry[] = [];
    for (const entry of usableEntries) {
      let innerPath = stripBundlePrefix(entry.relPath);
      const parts = innerPath.split("/");
      if (parts.length >= 2 && !parts[0].endsWith("-discovery")) {
        innerPath = parts.slice(1).join("/");
      }
      if (!innerPath || !allowedRelativePath(innerPath)) continue;
      bucket.push({ relPath: innerPath, file: entry.file });
    }
    if (bucket.length > 0) grouped.set(FLAT_SKILL_FOLDER_KEY, bucket);
    return grouped;
  }

  const grouped = new Map<string, RelativeFileEntry[]>();

  for (const entry of usableEntries) {
    const normalized = stripBundlePrefix(entry.relPath);
    if (!normalized) continue;

    const parts = normalized.split("/");
    const discoveryIndex = findDiscoverySegment(parts);
    let folderKey: string;
    let innerPath: string;

    if (discoveryIndex >= 0) {
      folderKey = parts[discoveryIndex];
      innerPath = parts.slice(discoveryIndex + 1).join("/");
    } else if (parts.length >= 2) {
      folderKey = parts[0];
      innerPath = parts.slice(1).join("/");
      if (!folderKey.endsWith("-discovery")) continue;
    } else {
      continue;
    }

    if (!innerPath || !allowedRelativePath(innerPath)) continue;
    const bucket = grouped.get(folderKey) || [];
    bucket.push({ relPath: innerPath, file: entry.file });
    grouped.set(folderKey, bucket);
  }

  return grouped;
}

function dedupePlatformAccounts(accounts: PlatformAccountDirectoryRecord[]): PlatformAccountDirectoryRecord[] {
  const deduped: PlatformAccountDirectoryRecord[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const feedId = (account.feed_id || "").trim();
    if (!feedId || seen.has(feedId)) continue;
    seen.add(feedId);
    deduped.push(account);
  }
  return deduped;
}

export async function parsePlatformAccountsFromRelativeEntries(
  entries: RelativeFileEntry[],
): Promise<PlatformAccountDirectoryRecord[]> {
  const accounts: PlatformAccountDirectoryRecord[] = [];

  for (const entry of entries) {
    const normalized = normalizeImportPath(entry.relPath);
    if (!normalized.endsWith(`${PLATFORM_ACCOUNTS_DIR}/manifest.json`)) continue;
    try {
      const payload = JSON.parse(await entry.file.text()) as { accounts?: PlatformAccountDirectoryRecord[] };
      if (Array.isArray(payload.accounts)) {
        accounts.push(...payload.accounts.filter((item) => item?.feed_id));
      }
    } catch {
      // ignore invalid manifest
    }
  }

  if (accounts.length > 0) {
    return dedupePlatformAccounts(accounts);
  }

  for (const entry of entries) {
    const normalized = normalizeImportPath(entry.relPath);
    if (!normalized.includes(`${PLATFORM_ACCOUNTS_DIR}/accounts/`)) continue;
    if (!normalized.endsWith(".json") || normalized.endsWith("manifest.json")) continue;
    try {
      const item = JSON.parse(await entry.file.text()) as PlatformAccountDirectoryRecord;
      if (item?.feed_id) accounts.push(item);
    } catch {
      // ignore invalid account file
    }
  }

  return dedupePlatformAccounts(accounts);
}

export async function parseSkillDirectoriesFromFileList(fileList: FileList): Promise<ParsedSkillDirectory[]> {
  const entries: RelativeFileEntry[] = [];
  for (let index = 0; index < fileList.length; index += 1) {
    const file = fileList.item(index);
    if (!file) continue;
    const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    entries.push({ relPath, file });
  }
  return finalizeSkillGroups(groupRelativeFileEntries(entries));
}

type FileSystemEntryLike = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (successCallback: (file: File) => void) => void;
  createReader: () => {
    readEntries: (successCallback: (entries: FileSystemEntryLike[]) => void) => void;
  };
};

async function readEntryFiles(entry: FileSystemEntryLike, prefix: string): Promise<RelativeFileEntry[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve) => {
      entry.file((value) => resolve(value));
    });
    const relPath = prefix ? `${prefix}/${file.name}` : file.name;
    return [{ relPath, file }];
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const children: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve) => {
      reader.readEntries((values) => resolve(values));
    });
    if (batch.length === 0) break;
    children.push(...batch);
  }

  const nestedPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const nested: RelativeFileEntry[] = [];
  for (const child of children) {
    nested.push(...(await readEntryFiles(child, nestedPrefix)));
  }
  return nested;
}

export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<FileList | RelativeFileEntry[]> {
  const items = dataTransfer.items;
  if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === "function") {
    const entries: RelativeFileEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item.kind !== "file") continue;
      const entry = item.webkitGetAsEntry() as FileSystemEntryLike | null;
      if (!entry) continue;
      const collected = await readEntryFiles(entry, "");
      entries.push(...collected);
    }
    if (entries.length > 0) return entries;
  }
  return dataTransfer.files;
}

export function directoryPickerSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

async function collectFilesFromDirectoryHandle(
  dirHandle: FileSystemDirectoryHandle,
  prefix = "",
): Promise<RelativeFileEntry[]> {
  const entries: RelativeFileEntry[] = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const nextPrefix = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      entries.push(...(await collectFilesFromDirectoryHandle(handle, nextPrefix)));
      continue;
    }
    const file = await handle.getFile();
    entries.push({ relPath: nextPrefix, file });
  }
  return entries;
}

export async function pickSkillDirectoryEntries(): Promise<RelativeFileEntry[] | null> {
  const pickerWindow = window as DirectoryPickerWindow;
  if (!pickerWindow.showDirectoryPicker) return null;
  const root = await pickerWindow.showDirectoryPicker({ mode: "read" });
  return collectFilesFromDirectoryHandle(root, root.name);
}

export async function parseSkillDirectoriesFromRelativeEntries(
  entries: RelativeFileEntry[],
): Promise<ParsedSkillDirectory[]> {
  return finalizeSkillGroups(groupRelativeFileEntries(entries));
}

export { BUILTIN_PLATFORM_SKILLS, isPlatformSkillId };
