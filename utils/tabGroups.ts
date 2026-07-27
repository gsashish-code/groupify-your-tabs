export type TabGroupColor = Browser.tabGroups.TabGroup["color"];

export const TAB_GROUP_COLORS: TabGroupColor[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

export interface GroupRule {
  /** Stable identifier for this category, independent of `name`/title text. */
  id: string;
  name: string;
  color: TabGroupColor;
  /** Hostname substrings that match this category. */
  hostnames: string[];
}

export const PREDEFINED_GROUPS: GroupRule[] = [
  {
    id: "social",
    name: "Social",
    color: "pink",
    hostnames: ["facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com", "reddit.com", "tiktok.com"],
  },
  {
    id: "development",
    name: "Development",
    color: "blue",
    hostnames: ["github.com", "gitlab.com", "stackoverflow.com", "npmjs.com", "developer.mozilla.org", "bitbucket.org"],
  },
  {
    id: "google-workspace",
    name: "Google Workspace",
    color: "yellow",
    hostnames: ["docs.google.com", "sheets.google.com", "slides.google.com", "drive.google.com", "mail.google.com", "calendar.google.com"],
  },
  {
    id: "shopping",
    name: "Shopping",
    color: "green",
    hostnames: ["amazon.", "ebay.", "etsy.com", "walmart.com"],
  },
  {
    id: "entertainment",
    name: "Entertainment",
    color: "purple",
    hostnames: ["youtube.com", "netflix.com", "twitch.tv", "spotify.com", "hulu.com"],
  },
  {
    id: "news",
    name: "News",
    color: "red",
    hostnames: ["nytimes.com", "cnn.com", "bbc.", "theguardian.com", "reuters.com"],
  },
  {
    id: "communication",
    name: "Communication",
    color: "cyan",
    hostnames: ["slack.com", "discord.com", "teams.microsoft.com", "zoom.us", "meet.google.com"],
  },
];

export interface GroupSuggestion {
  id: string;
  name: string;
  color: TabGroupColor;
  tabs: Browser.tabs.Tab[];
}

function getHostname(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Buckets tabs into predefined categories by hostname. Tabs matching no rule are omitted. */
export function suggestGroups(tabs: Browser.tabs.Tab[]): GroupSuggestion[] {
  const byId = new Map<string, GroupSuggestion>(
    PREDEFINED_GROUPS.map((rule) => [rule.id, { id: rule.id, name: rule.name, color: rule.color, tabs: [] }]),
  );

  for (const tab of tabs) {
    const hostname = getHostname(tab.url);
    if (!hostname) continue;

    const rule = PREDEFINED_GROUPS.find((r) => r.hostnames.some((h) => hostname.includes(h)));
    if (rule) byId.get(rule.id)!.tabs.push(tab);
  }

  return [...byId.values()].filter((s) => s.tabs.length > 0);
}

/** Groups the given tabs and applies a title/color to the resulting group. */
export async function createGroup(
  tabIds: number[],
  title: string,
  color: TabGroupColor,
): Promise<number> {
  if (tabIds.length === 0) throw new Error("createGroup requires at least one tab id");

  const groupId = await browser.tabs.group({ tabIds: tabIds as [number, ...number[]] });
  await browser.tabGroups.update(groupId, { title, color });
  return groupId;
}

/** Renames/recolors an existing group. */
export async function updateGroup(groupId: number, title: string, color: TabGroupColor): Promise<void> {
  await browser.tabGroups.update(groupId, { title, color });
}

/** A tab group only exists while it has tabs, so removing one means ungrouping all its tabs. */
export async function removeGroup(groupId: number): Promise<void> {
  const tabsInGroup = await browser.tabs.query({ groupId });
  const tabIds = tabsInGroup.map((tab) => tab.id).filter((id): id is number => id !== undefined);
  if (tabIds.length === 0) return;

  await browser.tabs.ungroup(tabIds as [number, ...number[]]);
}

/**
 * Adds tabs to the group titled `title` within `windowId`, creating it (with `color`) if it
 * doesn't exist yet. A group only exists within a single window, so this must be called per-window.
 */
export async function addTabsToNamedGroup(
  windowId: number,
  title: string,
  color: TabGroupColor,
  tabIds: number[],
): Promise<number> {
  if (tabIds.length === 0) throw new Error("addTabsToNamedGroup requires at least one tab id");

  const groupsInWindow = await browser.tabGroups.query({ windowId });
  const existing = groupsInWindow.find((group) => group.title === title);

  if (existing) {
    await browser.tabs.group({ groupId: existing.id, tabIds: tabIds as [number, ...number[]] });
    return existing.id;
  }

  return createGroup(tabIds, title, color);
}
