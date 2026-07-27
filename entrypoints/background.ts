import { getAllTabs, getAllTabGroups, getUngroupedTabs } from "@/utils/tabs";
import { getRules, findMatchingRule } from "@/utils/rules";
import { addTabsToNamedGroup } from "@/utils/tabGroups";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    const [tabs, groups] = await Promise.all([getAllTabs(), getAllTabGroups()]);
    console.log("all tabs", tabs);
    console.log("all groups", groups);
    console.log("ungrouped tabs", await getUngroupedTabs());
  });

  // When a tab navigates and matches a rule, move it into that rule's group,
  // creating the group in that window if it doesn't exist yet.
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) return;

    const rules = await getRules();
    const rule = findMatchingRule(rules, changeInfo.url);
    if (!rule) return;

    await addTabsToNamedGroup(tab.windowId, rule.groupTitle, rule.color, [tabId]);
  });
});
