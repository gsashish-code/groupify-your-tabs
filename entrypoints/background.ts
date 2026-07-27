import { getAllTabs, getAllTabGroups, getUngroupedTabs } from "@/utils/tabs";
import { getRules, findMatchingRule } from "@/utils/rules";
import { addTabsToNamedGroup } from "@/utils/tabGroups";
import { unmarkTab, reconcileManagedTabs, getTrackedGroupId } from "@/utils/managedGroups";
import { markBackgroundContext } from "@/utils/backgroundRpc";

export default defineBackground(() => {
  // Must run first and synchronously: it registers the onMessage listener that lets rules.ts and
  // managedGroups.ts route their storage mutations through this single background instance
  // (see backgroundRpc.ts), and flips the flag so this script's own calls to those mutations run
  // locally instead of round-tripping through a message to itself.
  markBackgroundContext();

  // The service worker can restart for reasons unrelated to a full browser restart (idle timeout,
  // extension re-enable, etc.), and tab ids are not stable across an actual browser restart — so
  // reconcile on every startup rather than only on `onInstalled`/`onStartup`.
  reconcileManagedTabs().catch((error) => console.error("reconcileManagedTabs failed", error));

  browser.runtime.onInstalled.addListener(async () => {
    const [tabs, groups] = await Promise.all([getAllTabs(), getAllTabGroups()]);
    console.log("all tabs", tabs);
    console.log("all groups", groups);
    console.log("ungrouped tabs", await getUngroupedTabs());
  });

  // When a tab navigates and matches a rule, move it into that rule's group,
  // creating the group in that window if it doesn't exist yet.
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) return;

      const rules = await getRules();
      const rule = findMatchingRule(rules, changeInfo.url);
      if (!rule) return;

      await addTabsToNamedGroup(tab.windowId, rule.groupTitle, rule.color, [tabId]);
      return;
    }

    // Tab's group membership changed (ungrouped, or moved into a different group, manually or
    // otherwise) — if that no longer matches what we last recorded, drop the stale tracking so a
    // later rule cleanup can't act on it. Comparing against the specific tracked groupId (instead
    // of only reacting when it becomes "ungrouped") can't race against our own grouping action:
    // if this fires before addTabsToNamedGroup has (re-)marked the tab, the old record was already
    // stale and this is a correct, harmless unmark that gets immediately replaced; if it fires
    // after, the tracked groupId already matches the new one and nothing happens.
    if (changeInfo.groupId !== undefined) {
      const trackedGroupId = await getTrackedGroupId(tabId);
      if (trackedGroupId !== undefined && trackedGroupId !== changeInfo.groupId) {
        unmarkTab(tabId);
      }
    }
  });

  // Once a tab closes, forget it — its id could otherwise be handed to state we no longer care
  // about (nothing to ungroup for a closed tab), and Chrome doesn't reuse tab ids within a session
  // so there's no risk of mismatching a future tab either.
  browser.tabs.onRemoved.addListener((tabId) => {
    unmarkTab(tabId);
  });
});
