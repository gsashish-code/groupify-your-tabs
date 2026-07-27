import { getHostname, hostMatchesPattern } from "@/utils/hostMatch";
import { markTabManaged } from "@/utils/managedGroups";
import { createKeyedLock } from "@/utils/asyncLock";
import { registerBackgroundOp } from "@/utils/backgroundRpc";

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

/** Buckets tabs into predefined categories by hostname. Tabs matching no rule are omitted. */
export function suggestGroups(tabs: Browser.tabs.Tab[]): GroupSuggestion[] {
  const byId = new Map<string, GroupSuggestion>(
    PREDEFINED_GROUPS.map((rule) => [rule.id, { id: rule.id, name: rule.name, color: rule.color, tabs: [] }]),
  );

  for (const tab of tabs) {
    const hostname = getHostname(tab.url);
    if (!hostname) continue;

    const rule = PREDEFINED_GROUPS.find((r) => r.hostnames.some((h) => hostMatchesPattern(hostname, h)));
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

/** Partitions `tabs` by window and creates one group per window, since a single tab group can't
 *  span multiple windows — a `browser.tabs.group` call mixing tabs from two windows fails. */
export async function createGroupAcrossWindows(
  tabs: Browser.tabs.Tab[],
  title: string,
  color: TabGroupColor,
): Promise<number[]> {
  const tabIdsByWindow = new Map<number, number[]>();
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const tabIds = tabIdsByWindow.get(tab.windowId) ?? [];
    tabIds.push(tab.id);
    tabIdsByWindow.set(tab.windowId, tabIds);
  }

  const groupIds: number[] = [];
  for (const tabIds of tabIdsByWindow.values()) {
    groupIds.push(await createGroup(tabIds, title, color));
  }
  return groupIds;
}

// Queues concurrent find-or-create calls that share a window+title so two tabs matching the same
// rule at once (e.g. during session restore) can't both query before either group exists and each
// create their own duplicate. This only actually serializes anything once addTabsToNamedGroup
// itself is routed through the background (below) — the lock lives in whichever context calls it,
// and the background (automatic per-navigation grouping) and an options page (Sync All, Apply Now)
// are different contexts with separate module instances of this map.
const withGroupLock = createKeyedLock();

async function addTabsToNamedGroupImpl(
  windowId: number,
  title: string,
  color: TabGroupColor,
  tabIds: number[],
): Promise<number> {
  if (tabIds.length === 0) throw new Error("addTabsToNamedGroup requires at least one tab id");

  const groupId = await withGroupLock(`${windowId} ${title}`, async () => {
    const groupsInWindow = await browser.tabGroups.query({ windowId });
    const existing = groupsInWindow.find((group) => group.title === title);

    if (existing) {
      await browser.tabs.group({ groupId: existing.id, tabIds: tabIds as [number, ...number[]] });
      return existing.id;
    }

    return createGroup(tabIds, title, color);
  });

  // Track exactly which tabs the extension put here, and in which group — not the whole group —
  // so a later disable/delete/rename only ever touches these tabs, and only while they're still
  // sitting in this same group (not one the user moved them into afterward).
  await Promise.all(tabIds.map((tabId) => markTabManaged(tabId, groupId, title)));

  return groupId;
}

/**
 * Adds tabs to the group titled `title` within `windowId`, creating it (with `color`) if it
 * doesn't exist yet. A group only exists within a single window, so this must be called per-window.
 *
 * Routed through the background instance (registerBackgroundOp), so the find-or-create lock above
 * is genuinely shared across every caller — otherwise the background's automatic grouping and an
 * options page's "Sync All"/"Apply Now" could each hold their own lock, both miss the same
 * not-yet-created group, and create duplicate same-titled groups in one window.
 */
export const addTabsToNamedGroup = registerBackgroundOp(
  "tabGroups/addTabsToNamedGroup",
  addTabsToNamedGroupImpl,
);
