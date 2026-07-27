export async function getAllTabs(): Promise<Browser.tabs.Tab[]> {
  return browser.tabs.query({});
}

export async function getAllTabGroups(): Promise<Browser.tabGroups.TabGroup[]> {
  return browser.tabGroups.query({});
}

/** Tabs that aren't already part of a tab group, so callers don't re-group them. */
export async function getUngroupedTabs(): Promise<Browser.tabs.Tab[]> {
  const tabs = await getAllTabs();
  return tabs.filter((tab) => tab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE);
}
