import { getAllTabs, getAllTabGroups, getUngroupedTabs } from "@/utils/tabs";
import { getRules, findMatchingRule } from "@/utils/rules";
import { addTabsToNamedGroup } from "@/utils/tabGroups";
import { unmarkGroupManaged } from "@/utils/managedGroups";

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

  // A group's id is freed once it stops existing (last tab removed/ungrouped), so drop it from the
  // managed set too — otherwise a later, unrelated group could reuse the id and be treated as
  // extension-owned by mistake.
  browser.tabGroups.onRemoved.addListener((group) => {
    unmarkGroupManaged(group.id);
  });
});
