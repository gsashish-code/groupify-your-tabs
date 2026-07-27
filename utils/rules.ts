import { addTabsToNamedGroup, type TabGroupColor } from "@/utils/tabGroups";
import { getHostname, hostMatchesPattern } from "@/utils/hostMatch";
import { createKeyedLock } from "@/utils/asyncLock";
import { registerBackgroundOp } from "@/utils/backgroundRpc";

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
  /** Whether this rule actively groups tabs. Absent means enabled — keeps old stored rules working. */
  enabled?: boolean;
}

/** True if `rule` came from a predefined category (via Quick Add) rather than the manual form. */
export function isPredefinedRule(rule: AutoGroupRule): boolean {
  return rule.predefinedId !== undefined;
}

/** `enabled` defaults to true when absent, so rules created before this field existed still run. */
export function isRuleEnabled(rule: AutoGroupRule): boolean {
  return rule.enabled !== false;
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

// Rules are read-modify-write against browser.storage.local, which has no compare-and-swap. Two
// options pages (or a popup and an options page) reading the same old value and each writing back
// would otherwise let one silently clobber the other's change. Routing every mutation through the
// single background instance (registerBackgroundOp) and serializing them there (withLock) removes
// the race instead of narrowing it.
const withLock = createKeyedLock();

async function addRuleImpl(rule: Omit<AutoGroupRule, "id">): Promise<AutoGroupRule> {
  return withLock(STORAGE_KEY, async () => {
    const rules = await getRules();
    const created: AutoGroupRule = { ...rule, id: crypto.randomUUID() };
    await saveRules([...rules, created]);
    return created;
  });
}
export const addRule = registerBackgroundOp("rules/add", addRuleImpl);

async function deleteRuleImpl(id: string): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const rules = await getRules();
    await saveRules(rules.filter((rule) => rule.id !== id));
  });
}
export const deleteRule = registerBackgroundOp("rules/delete", deleteRuleImpl);

async function updateRuleImpl(id: string, updates: Partial<Omit<AutoGroupRule, "id">>): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const rules = await getRules();
    await saveRules(rules.map((rule) => (rule.id === id ? { ...rule, ...updates } : rule)));
  });
}
export const updateRule = registerBackgroundOp("rules/update", updateRuleImpl);

/**
 * Removes every rule quick-added from this predefined category, not just one — guards against
 * duplicates (e.g. from repeated Add clicks before a fix landed) leaving "Added" stuck on.
 */
async function deleteRulesByPredefinedIdImpl(predefinedId: string): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    const rules = await getRules();
    await saveRules(rules.filter((rule) => rule.predefinedId !== predefinedId));
  });
}
export const deleteRulesByPredefinedId = registerBackgroundOp(
  "rules/deleteByPredefinedId",
  deleteRulesByPredefinedIdImpl,
);

async function clearAllRulesImpl(): Promise<void> {
  await withLock(STORAGE_KEY, async () => {
    await saveRules([]);
  });
}
export const clearAllRules = registerBackgroundOp("rules/clear", clearAllRulesImpl);

export function ruleMatchesUrl(rule: AutoGroupRule, url: string): boolean {
  const host = rule.matchType === "url" ? getHostname(url) : "";
  return rule.patterns.some((pattern) => {
    if (!pattern) return false;
    if (rule.matchType === "regex") {
      try {
        return new RegExp(pattern).test(url);
      } catch {
        return false;
      }
    }
    return hostMatchesPattern(host, pattern);
  });
}

export function findMatchingRule(rules: AutoGroupRule[], url: string): AutoGroupRule | undefined {
  return rules.find((rule) => isRuleEnabled(rule) && ruleMatchesUrl(rule, url));
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
