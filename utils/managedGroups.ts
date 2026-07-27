import { createKeyedLock } from "@/utils/asyncLock";
import { registerBackgroundOp } from "@/utils/backgroundRpc";

/**
 * Tracks which open tabs were added to a live group by this extension, which group they were put
 * in, and under which rule title — as opposed to tabs a user grouped by hand. Rules are only ever
 * identified by their live group's *title* (see AutoGroupRule.groupTitle), so without per-tab
 * tracking, deleting/disabling/renaming a rule would cascade to every tab in *any* group with that
 * title, including a group the user built manually, or a shared group where the extension only
 * ever added one of several tabs.
 *
 * Tracking the groupId alongside the title (not just the title) matters too: if the user manually
 * drags a tracked tab into a different group after the extension placed it, the tab is no longer
 * really "in" the group the extension put it in, even though our last record of it still says the
 * old title. Checking the tab's *current* groupId against the *recorded* groupId before acting
 * catches that — a tab that moved elsewhere is left alone instead of being ungrouped from a group
 * the extension never touched.
 */
const STORAGE_KEY = "managedTabs";

interface ManagedTabEntry {
  groupId: number;
  title: string;
}

type ManagedTabs = Record<number, ManagedTabEntry>;

const withLock = createKeyedLock();

async function getManagedTabs(): Promise<ManagedTabs> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as ManagedTabs | undefined) ?? {};
}

async function setManagedTabs(map: ManagedTabs): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: map });
}

async function markTabManagedImpl(tabId: number, groupId: number, groupTitle: string): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabs();
    const existing = map[tabId];
    if (existing && existing.groupId === groupId && existing.title === groupTitle) return;
    await setManagedTabs({ ...map, [tabId]: { groupId, title: groupTitle } });
  });
}

/** Marks `tabId` as added to `groupId` by this extension, under `groupTitle`. */
export const markTabManaged = registerBackgroundOp("managedTabs/mark", markTabManagedImpl);

async function unmarkTabImpl(tabId: number): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabs();
    if (!(tabId in map)) return;
    const next = { ...map };
    delete next[tabId];
    await setManagedTabs(next);
  });
}

/** Drops tracking for `tabId` — call once the tab closes or leaves its group. */
export const unmarkTab = registerBackgroundOp("managedTabs/unmark", unmarkTabImpl);

/** The groupId `tabId` was last recorded in by this extension, or undefined if untracked. */
export async function getTrackedGroupId(tabId: number): Promise<number | undefined> {
  const map = await getManagedTabs();
  return map[tabId]?.groupId;
}

async function ungroupManagedTabsForTitleImpl(groupTitle: string): Promise<number> {
  return withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabs();
    const entries = Object.entries(map)
      .filter(([, entry]) => entry.title === groupTitle)
      .map(([tabId, entry]) => ({ tabId: Number(tabId), groupId: entry.groupId }));
    if (entries.length === 0) return 0;

    // A tracked tab may have closed, been ungrouped, or been dragged into a different group
    // (manual or otherwise) since we last recorded it — only ungroup ones still sitting in the
    // exact group we put them in.
    const openTabs = await Promise.all(entries.map(({ tabId }) => browser.tabs.get(tabId).catch(() => undefined)));
    const stillInTrackedGroup = entries
      .filter((entry, index) => openTabs[index]?.groupId === entry.groupId)
      .map((entry) => entry.tabId);

    if (stillInTrackedGroup.length > 0) {
      await browser.tabs.ungroup(stillInTrackedGroup as [number, ...number[]]);
    }

    const next = { ...map };
    for (const { tabId } of entries) delete next[tabId];
    await setManagedTabs(next);

    return stillInTrackedGroup.length;
  });
}

/**
 * Ungroups only the tabs this extension added under `groupTitle`, and only from the exact group it
 * put them in — never a whole group (which may also hold tabs the user placed there themselves),
 * and never a tab that's since been moved elsewhere. Returns how many tabs were ungrouped.
 */
export const ungroupManagedTabsForTitle = registerBackgroundOp(
  "managedTabs/ungroupForTitle",
  ungroupManagedTabsForTitleImpl,
);

async function renameManagedTabsTitleImpl(oldTitle: string, newTitle: string): Promise<void> {
  if (oldTitle === newTitle) return;
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabs();
    let changed = false;
    const next = { ...map };
    for (const [tabId, entry] of Object.entries(map)) {
      if (entry.title === oldTitle) {
        next[Number(tabId)] = { ...entry, title: newTitle };
        changed = true;
      }
    }
    if (changed) await setManagedTabs(next);
  });
}

/** Re-points tracking entries from `oldTitle` to `newTitle` after a rule is renamed. */
export const renameManagedTabsTitle = registerBackgroundOp(
  "managedTabs/renameTitle",
  renameManagedTabsTitleImpl,
);

/**
 * Whether every tab currently in `groupId` was added by this extension to *this* group under
 * `title` — i.e. whether the extension fully owns this group's contents, as opposed to sharing it
 * with tabs the user grouped by hand (or tabs tracked under `title` that have since moved
 * elsewhere). Only fully-owned groups are safe to rename/recolor as a whole.
 */
export async function isGroupFullyManaged(groupId: number, title: string): Promise<boolean> {
  const tabsInGroup = await browser.tabs.query({ groupId });
  if (tabsInGroup.length === 0) return false;

  const map = await getManagedTabs();
  return tabsInGroup.every((tab) => {
    const entry = tab.id !== undefined ? map[tab.id] : undefined;
    return entry !== undefined && entry.groupId === groupId && entry.title === title;
  });
}

async function reconcileManagedTabsImpl(): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const map = await getManagedTabs();
    const tabIds = Object.keys(map).map(Number);
    if (tabIds.length === 0) return;

    const tabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id).catch(() => undefined)));

    const next: ManagedTabs = {};
    tabs.forEach((tab, index) => {
      const tabId = tabIds[index];
      const entry = map[tabId];
      if (tab && tab.groupId === entry.groupId) {
        next[tabId] = entry;
      }
    });

    await setManagedTabs(next);
  });
}

/**
 * Drops tracking entries whose tab no longer exists, or is no longer in the group it was recorded
 * against — e.g. because a browser restart handed out fresh tab ids while the extension wasn't
 * running to see the old ones disappear, the user moved the tab elsewhere, or events were missed
 * across some other lifecycle gap. Safe to call anytime: it only ever forgets stale bookkeeping,
 * never touches a live tab or group.
 */
export const reconcileManagedTabs = registerBackgroundOp("managedTabs/reconcile", reconcileManagedTabsImpl);
