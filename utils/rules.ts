import { addTabsToNamedGroup, type TabGroupColor } from "@/utils/tabGroups";

export type MatchType = "url" | "regex";

export interface AutoGroupRule {
  id: string;
  /** Title of the tab group this rule moves matching tabs into. Created if it doesn't exist yet. */
  groupTitle: string;
  color: TabGroupColor;
  matchType: MatchType;
  /** Hostname/URL substrings, or regex source strings, depending on matchType. Any match triggers the rule. */
  patterns: string[];
  /**
   * `PREDEFINED_GROUPS[].id` this rule was quick-added from, if any. Undefined for rules the user
   * wrote by hand. Tracked separately from `groupTitle` since the title can be renamed/reused.
   */
  predefinedId?: string;
}

/** True if `rule` came from a predefined category (via Quick Add) rather than the manual form. */
export function isPredefinedRule(rule: AutoGroupRule): boolean {
  return rule.predefinedId !== undefined;
}

export const RULES_STORAGE_KEY = "autoGroupRules";
const STORAGE_KEY = RULES_STORAGE_KEY;

export async function getRules(): Promise<AutoGroupRule[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as AutoGroupRule[] | undefined) ?? [];
}

async function saveRules(rules: AutoGroupRule[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: rules });
}

export async function addRule(rule: Omit<AutoGroupRule, "id">): Promise<AutoGroupRule> {
  const rules = await getRules();
  const created: AutoGroupRule = { ...rule, id: crypto.randomUUID() };
  rules.push(created);
  await saveRules(rules);
  return created;
}

export async function deleteRule(id: string): Promise<void> {
  const rules = await getRules();
  await saveRules(rules.filter((rule) => rule.id !== id));
}

export async function updateRule(
  id: string,
  updates: Partial<Omit<AutoGroupRule, "id">>,
): Promise<void> {
  const rules = await getRules();
  await saveRules(rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)));
}

/**
 * Removes every rule quick-added from this predefined category, not just one — guards against
 * duplicates (e.g. from repeated Add clicks before a fix landed) leaving "Added" stuck on.
 */
export async function deleteRulesByPredefinedId(predefinedId: string): Promise<void> {
  const rules = await getRules();
  await saveRules(rules.filter((rule) => rule.predefinedId !== predefinedId));
}

export async function clearAllRules(): Promise<void> {
  await saveRules([]);
}

export function ruleMatchesUrl(rule: AutoGroupRule, url: string): boolean {
  return rule.patterns.some((pattern) => {
    if (!pattern) return false;
    if (rule.matchType === "regex") {
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return false;
      }
    }
    return url.includes(pattern);
  });
}

export function findMatchingRule(rules: AutoGroupRule[], url: string): AutoGroupRule | undefined {
  return rules.find((rule) => ruleMatchesUrl(rule, url));
}

/**
 * Groups every currently open, ungrouped tab that matches the rule — creating the target group
 * per-window if needed. Returns how many tabs were moved.
 */
export async function applyRuleToOpenTabs(rule: AutoGroupRule): Promise<number> {
  const tabs = await browser.tabs.query({});
  const matching = tabs.filter(
    (tab) =>
      tab.id !== undefined &&
      tab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE &&
      ruleMatchesUrl(rule, tab.url ?? ""),
  );
  if (matching.length === 0) return 0;

  const tabIdsByWindow = new Map<number, number[]>();
  for (const tab of matching) {
    const tabIds = tabIdsByWindow.get(tab.windowId) ?? [];
    tabIds.push(tab.id!);
    tabIdsByWindow.set(tab.windowId, tabIds);
  }

  for (const [windowId, tabIds] of tabIdsByWindow) {
    await addTabsToNamedGroup(windowId, rule.groupTitle, rule.color, tabIds);
  }

  return matching.length;
}
