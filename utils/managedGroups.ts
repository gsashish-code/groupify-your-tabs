/**
 * Tracks which live tab groups this extension created or populated via a rule, as opposed to
 * groups the user built by hand. Rules are only ever identified by their live group's title (see
 * AutoGroupRule.groupTitle), so without this set, deleting/disabling/renaming a rule would cascade
 * to *every* group with that title — including one a user grouped manually themselves. Consulting
 * this set before touching a same-titled group keeps that cascade scoped to groups the extension
 * actually owns.
 */
const STORAGE_KEY = "managedGroupIds";

async function getManagedGroupIds(): Promise<number[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as number[] | undefined) ?? [];
}

async function setManagedGroupIds(ids: number[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: ids });
}

/** Marks `groupId` as extension-owned. Call whenever a rule creates or adds tabs to a group. */
export async function markGroupManaged(groupId: number): Promise<void> {
  const ids = await getManagedGroupIds();
  if (ids.includes(groupId)) return;
  await setManagedGroupIds([...ids, groupId]);
}

/** Drops `groupId` from the managed set. Call once the group no longer exists. */
export async function unmarkGroupManaged(groupId: number): Promise<void> {
  const ids = await getManagedGroupIds();
  if (!ids.includes(groupId)) return;
  await setManagedGroupIds(ids.filter((id) => id !== groupId));
}

/** Filters `groups` down to the ones this extension created or has populated via a rule. */
export async function filterManagedGroups<T extends { id: number }>(groups: T[]): Promise<T[]> {
  const managed = new Set(await getManagedGroupIds());
  return groups.filter((group) => managed.has(group.id));
}
