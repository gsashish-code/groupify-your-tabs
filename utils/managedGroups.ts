import { createKeyedLock } from "@/utils/asyncLock";
import { registerBackgroundOp } from "@/utils/backgroundRpc";

/**
 * Tracks which open tabs were added to a live group by this extension, and under which rule
 * title — as opposed to tabs a user grouped by hand. Rules are only ever identified by their live
 * group's *title* (see AutoGroupRule.groupTitle), so without per-tab tracking, deleting/disabling/
 * renaming a rule would cascade to every tab in *any* group with that title, including a group the
 * user built manually, or a shared group where the extension only ever added one of several tabs.
 * Keying by tabId (stable for as long as the tab stays open) instead of groupId means cleanup only
 * ever touches the specific tabs the extension put there.
 */
const STORAGE_KEY = "managedTabTitles";

type ManagedTabTitles = Record<number, string>;

const withLock = createKeyedLock();

async function getManagedTabTitles(): Promise<ManagedTabTitles> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ManagedTabTitles | undefined) ?? {};
}

async function setManagedTabTitles(map: ManagedTabTitles): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: map });
}

async function markTabManagedImpl(tabId: number, groupTitle: string): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabTitles();
    if (map[tabId] === groupTitle) return;
    await setManagedTabTitles({ ...map, [tabId]: groupTitle });
  });
}

/** Marks `tabId` as added to its current group by this extension, under `groupTitle`. */
export const markTabManaged = registerBackgroundOp("managedTabs/mark", markTabManagedImpl);

async function unmarkTabImpl(tabId: number): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabTitles();
    if (!(tabId in map)) return;
    const next = { ...map };
    delete next[tabId];
    await setManagedTabTitles(next);
  });
}

/** Drops tracking for `tabId` — call once the tab closes or leaves its group. */
export const unmarkTab = registerBackgroundOp("managedTabs/unmark", unmarkTabImpl);

async function ungroupManagedTabsForTitleImpl(groupTitle: string): Promise<number> {
  return withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabTitles();
    const tabIds = Object.entries(map)
      .filter(([, title]) => title === groupTitle)
      .map(([tabId]) => Number(tabId));
    if (tabIds.length === 0) return 0;

    // Tabs may have closed, or moved out of any group, since we last tracked them — check what's
    // actually still there rather than assuming the tracked state still holds.
    const openTabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id).catch(() => undefined)));
    const stillGrouped = openTabs
      .filter(
        (tab): tab is Browser.tabs.Tab =>
          tab !== undefined && tab.id !== undefined && tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE,
      )
      .map((tab) => tab.id!);

    if (stillGrouped.length > 0) {
      await browser.tabs.ungroup(stillGrouped as [number, ...number[]]);
    }

    const next = { ...map };
    for (const tabId of tabIds) delete next[tabId];
    await setManagedTabTitles(next);

    return stillGrouped.length;
  });
}

/**
 * Ungroups only the tabs this extension added under `groupTitle` — never a whole group, since a
 * live group with that title may also hold tabs the user placed there themselves. Returns how many
 * tabs were ungrouped.
 */
export const ungroupManagedTabsForTitle = registerBackgroundOp(
  "managedTabs/ungroupForTitle",
  ungroupManagedTabsForTitleImpl,
);

async function renameManagedTabsTitleImpl(oldTitle: string, newTitle: string): Promise<void> {
  if (oldTitle === newTitle) return;
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabTitles();
    let changed = false;
    const next = { ...map };
    for (const [tabId, title] of Object.entries(map)) {
      if (title === oldTitle) {
        next[Number(tabId)] = newTitle;
        changed = true;
      }
    }
    if (changed) await setManagedTabTitles(next);
  });
}

/** Re-points tracking entries from `oldTitle` to `newTitle` after a rule is renamed. */
export const renameManagedTabsTitle = registerBackgroundOp(
  "managedTabs/renameTitle",
  renameManagedTabsTitleImpl,
);

/**
 * Whether every tab currently in `groupId` was added by this extension under `title` — i.e.
 * whether the extension fully owns this group's contents, as opposed to sharing it with tabs the
 * user grouped by hand. Only fully-owned groups are safe to rename/recolor as a whole.
 */
export async function isGroupFullyManaged(groupId: number, title: string): Promise<boolean> {
  const tabsInGroup = await browser.tabs.query({ groupId });
  if (tabsInGroup.length === 0) return false;

  const map = await getManagedTabTitles();
  return tabsInGroup.every((tab) => tab.id !== undefined && map[tab.id] === title);
}

async function reconcileManagedTabsImpl(): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabTitles();
    const tabIds = Object.keys(map).map(Number);
    if (tabIds.length === 0) return;

    const tabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id).catch(() => undefined)));

    const next: ManagedTabTitles = {};
    tabs.forEach((tab, index) => {
      if (tab && tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
        next[tabIds[index]] = map[tabIds[index]];
      }
    });

    await setManagedTabTitles(next);
  });
}

/**
 * Drops tracking entries whose tab no longer exists or is no longer grouped — e.g. because a
 * browser restart handed out fresh tab ids while the extension wasn't running to see the old ones
 * disappear, or events were missed across some other lifecycle gap. Safe to call anytime: it only
 * ever forgets stale bookkeeping, never touches a live tab or group.
 */
export const reconcileManagedTabs = registerBackgroundOp("managedTabs/reconcile", reconcileManagedTabsImpl);
