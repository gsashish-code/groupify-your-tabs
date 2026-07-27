<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  PREDEFINED_GROUPS,
  TAB_GROUP_COLORS,
  removeGroup,
  updateGroup,
  type TabGroupColor,
} from "@/utils/tabGroups";
import { getAllTabGroups } from "@/utils/tabs";
import {
  getRules,
  addRule,
  updateRule,
  deleteRule,
  clearAllRules,
  applyRuleToOpenTabs,
  isPredefinedRule,
  isRuleEnabled,
  RULES_STORAGE_KEY,
  type AutoGroupRule,
  type MatchType,
} from "@/utils/rules";
import YourTabs from "@/components/YourTabs.vue";
import Icon from "@/components/Icon.vue";
import Toast from "@/components/Toast.vue";

const rules = ref<AutoGroupRule[]>([]);
const loading = ref(true);
const busyKey = ref<string | null>(null);
const statusMessage = ref<string | null>(null);

// Toast auto-dismisses a few seconds after each new message, restarting the clock on every change.
let toastTimer: ReturnType<typeof setTimeout> | undefined;
watch(statusMessage, (message) => {
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => (statusMessage.value = null), 3500);
});

async function loadRules() {
  rules.value = await getRules();
}

async function initialLoad() {
  loading.value = true;
  await loadRules();
  loading.value = false;
}

// Rules live in browser.storage.local, so pick up edits made from another options tab too.
function handleStorageChange(
  changes: Record<string, Browser.storage.StorageChange>,
  area: string,
) {
  if (area === "local" && RULES_STORAGE_KEY in changes) loadRules();
}

onMounted(() => {
  initialLoad();
  browser.storage.onChanged.addListener(handleStorageChange);
});

onUnmounted(() => {
  browser.storage.onChanged.removeListener(handleStorageChange);
});

function parsePatterns(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

async function createAndApplyRule(rule: Omit<AutoGroupRule, "id">) {
  const created = await addRule(rule);
  await loadRules();

  const movedCount = await applyRuleToOpenTabs(created);
  statusMessage.value =
    movedCount > 0
      ? `"${rule.groupTitle}": grouped ${movedCount} open tab${movedCount === 1 ? "" : "s"}.`
      : null;
}

// --- Search / filter over "Your Rules" ---

const searchQuery = ref("");
const typeFilter = ref<"all" | MatchType>("all");

const filteredRules = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return rules.value.filter((rule) => {
    if (typeFilter.value !== "all" && rule.matchType !== typeFilter.value) return false;
    if (!query) return true;
    return (
      rule.groupTitle.toLowerCase().includes(query) ||
      rule.patterns.some((pattern) => pattern.toLowerCase().includes(query))
    );
  });
});

const stats = computed(() => ({
  total: rules.value.length,
  active: rules.value.filter(isRuleEnabled).length,
  domain: rules.value.filter((rule) => rule.matchType === "url").length,
  regex: rules.value.filter((rule) => rule.matchType === "regex").length,
}));

// --- Quick add from predefined categories (e.g. "Entertainment" -> youtube.com, netflix.com, ...) ---

function isCategoryAdded(category: (typeof PREDEFINED_GROUPS)[number]): boolean {
  return rules.value.some((rule) => rule.predefinedId === category.id);
}

async function quickAddCategory(category: (typeof PREDEFINED_GROUPS)[number]) {
  if (isCategoryAdded(category)) return;

  busyKey.value = `quick-${category.id}`;
  try {
    await createAndApplyRule({
      groupTitle: category.name,
      color: category.color,
      matchType: "url",
      patterns: category.hostnames,
      predefinedId: category.id,
    });
  } finally {
    busyKey.value = null;
  }
}

// --- Manual rule form ---

const showAddForm = ref(false);
const newRuleGroupTitle = ref("");
const newRuleColor = ref<TabGroupColor>("grey");
const newRuleMatchType = ref<MatchType>("url");
const newRulePatterns = ref("");

async function submitNewRule() {
  const patterns = parsePatterns(newRulePatterns.value);
  if (!newRuleGroupTitle.value.trim() || patterns.length === 0) return;

  busyKey.value = "new-rule";
  try {
    await createAndApplyRule({
      groupTitle: newRuleGroupTitle.value.trim(),
      color: newRuleColor.value,
      matchType: newRuleMatchType.value,
      patterns,
    });
    newRuleGroupTitle.value = "";
    newRulePatterns.value = "";
    showAddForm.value = false;
  } finally {
    busyKey.value = null;
  }
}

async function removeRule(id: string) {
  const rule = rules.value.find((r) => r.id === id);

  busyKey.value = `rule-${id}`;
  try {
    await deleteRule(id);
    await loadRules();

    // Only drop the live group if no other remaining rule still targets the same title.
    if (rule && !rules.value.some((r) => r.groupTitle === rule.groupTitle)) {
      const groups = await getAllTabGroups();
      const matching = groups.filter((group) => group.title === rule.groupTitle);
      await Promise.all(matching.map((group) => removeGroup(group.id)));
    }
  } finally {
    busyKey.value = null;
  }
}

async function resetAllRules() {
  if (
    !confirm(
      "Remove all rules, including anything added via Quick Add? This can't be undone.",
    )
  )
    return;

  busyKey.value = "reset-all";
  try {
    await clearAllRules();
    await loadRules();
    statusMessage.value = "All rules removed.";
  } finally {
    busyKey.value = null;
  }
}

async function applyRuleNow(rule: AutoGroupRule) {
  busyKey.value = `apply-${rule.id}`;
  try {
    const movedCount = await applyRuleToOpenTabs(rule);
    if (movedCount > 0) {
      statusMessage.value = `"${rule.groupTitle}": grouped ${movedCount} open tab${movedCount === 1 ? "" : "s"}.`;
    }
  } finally {
    busyKey.value = null;
  }
}

async function toggleRuleEnabled(rule: AutoGroupRule) {
  const nextEnabled = !isRuleEnabled(rule);

  busyKey.value = `toggle-${rule.id}`;
  try {
    await updateRule(rule.id, { enabled: nextEnabled });
    await loadRules();

    if (nextEnabled) {
      // Re-enabling immediately groups any already-open matching tabs, same as "Apply Now".
      const movedCount = await applyRuleToOpenTabs(rule);
      if (movedCount > 0) {
        statusMessage.value = `"${rule.groupTitle}": grouped ${movedCount} open tab${movedCount === 1 ? "" : "s"}.`;
      }
    } else {
      // Disabling stops future auto-grouping — also ungroup its live tabs now, unless another
      // still-enabled rule shares the same target group title.
      const stillActive = rules.value.some(
        (r) => r.groupTitle === rule.groupTitle && isRuleEnabled(r),
      );
      if (!stillActive) {
        const groups = await getAllTabGroups();
        const matching = groups.filter((group) => group.title === rule.groupTitle);
        await Promise.all(matching.map((group) => removeGroup(group.id)));
      }
    }
  } finally {
    busyKey.value = null;
  }
}

// --- Expand/collapse a rule's pattern details ---

const expandedRuleIds = ref<Set<string>>(new Set());

function isExpanded(id: string): boolean {
  return expandedRuleIds.value.has(id);
}

function toggleExpanded(id: string) {
  const next = new Set(expandedRuleIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedRuleIds.value = next;
}

// --- Editing an existing rule (title, color, patterns) ---

const editingRuleId = ref<string | null>(null);
const editRuleTitle = ref("");
const editRuleColor = ref<TabGroupColor>("grey");
const editRulePatterns = ref("");

function startEditRule(rule: AutoGroupRule) {
  editingRuleId.value = rule.id;
  editRuleTitle.value = rule.groupTitle;
  editRuleColor.value = rule.color;
  editRulePatterns.value = rule.patterns.join("\n");
}

function cancelEditRule() {
  editingRuleId.value = null;
}

async function saveEditRule(rule: AutoGroupRule) {
  const patterns = parsePatterns(editRulePatterns.value);
  if (!editRuleTitle.value.trim() || patterns.length === 0) return;

  const oldTitle = rule.groupTitle;
  const newTitle = editRuleTitle.value.trim();
  const newColor = editRuleColor.value;

  // Only propagate to the live group if this rule is the sole owner of the old title —
  // otherwise another rule still relies on that group and shouldn't have it renamed out from under it.
  const soleOwner = rules.value.filter((r) => r.groupTitle === oldTitle).length === 1;

  busyKey.value = `edit-${rule.id}`;
  try {
    await updateRule(rule.id, {
      groupTitle: newTitle,
      color: newColor,
      patterns,
    });
    await loadRules();

    if (soleOwner) {
      const groups = await getAllTabGroups();
      const matching = groups.filter((group) => group.title === oldTitle);
      await Promise.all(matching.map((group) => updateGroup(group.id, newTitle, newColor)));
    }

    editingRuleId.value = null;
  } finally {
    busyKey.value = null;
  }
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="topbar-title">
        <span class="brand-icon"><Icon name="bolt" :size="20" /></span>
        <div>
          <h1>Groupify Your Tabs</h1>
          <p class="subtitle">Define automatic tab grouping rules</p>
        </div>
      </div>
      <button class="btn btn-ghost" :disabled="busyKey === 'reset-all'" @click="resetAllRules">
        <Icon name="trash" :size="14" />
        {{ busyKey === "reset-all" ? "Resetting..." : "Reset Rules" }}
      </button>
    </header>

    <Toast :message="statusMessage" />
    <p v-if="loading" class="muted">Loading...</p>

    <template v-else>
      <section class="stats">
        <div class="stat-card">
          <span class="stat-value stat-purple">{{ stats.total }}</span>
          <span class="stat-label">Total Rules</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-green">{{ stats.active }}</span>
          <span class="stat-label">Active Rules</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-blue">{{ stats.domain }}</span>
          <span class="stat-label">Domain Rules</span>
        </div>
        <div class="stat-card">
          <span class="stat-value stat-red">{{ stats.regex }}</span>
          <span class="stat-label">Regex Rules</span>
        </div>
      </section>

      <section class="section">
        <h2><Icon name="folder" :size="14" /> Your Tabs</h2>
        <YourTabs :rules="rules" />
      </section>

      <section class="section">
        <h2><Icon name="plus" :size="14" /> Quick Add from Categories</h2>
        <div v-for="category in PREDEFINED_GROUPS" :key="category.id" class="row quick-row">
          <div class="row-info">
            <span class="group-dot" :class="`color-${category.color}`"></span>
            <span class="row-title">{{ category.name }}</span>
            <span class="muted">{{ category.hostnames.join(", ") }}</span>
          </div>

          <div class="row-actions">
            <button
              class="btn"
              :class="isCategoryAdded(category) ? 'btn-added' : 'btn-accent'"
              :disabled="busyKey === `quick-${category.id}` || isCategoryAdded(category)"
              @click="quickAddCategory(category)"
            >
              <Icon :name="isCategoryAdded(category) ? 'check' : 'plus'" :size="14" />
              {{ busyKey === `quick-${category.id}` ? "Adding..." : isCategoryAdded(category) ? "Added" : "Add" }}
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="rules-toolbar">
          <div class="search-box">
            <Icon name="search" :size="14" />
            <input v-model="searchQuery" type="text" placeholder="Search rules..." />
          </div>
          <div class="select-box">
            <select v-model="typeFilter">
              <option value="all">All Types</option>
              <option value="url">Domain</option>
              <option value="regex">Regex</option>
            </select>
            <Icon name="chevron-down" :size="14" />
          </div>
          <button class="btn btn-accent" @click="showAddForm = !showAddForm">
            <Icon name="plus" :size="14" />
            Add Rule
          </button>
        </div>

        <div v-if="showAddForm" class="add-form-panel">
          <div class="edit-form">
            <input v-model="newRuleGroupTitle" type="text" placeholder="Target group title" />
            <select v-model="newRuleColor">
              <option v-for="color in TAB_GROUP_COLORS" :key="color" :value="color">
                {{ color }}
              </option>
            </select>
            <select v-model="newRuleMatchType">
              <option value="url">URL contains</option>
              <option value="regex">Regex</option>
            </select>
            <textarea
              v-model="newRulePatterns"
              rows="4"
              placeholder="One pattern per line (or comma-separated), e.g. github.com or ^https://.*\.atlassian\.net/"
            ></textarea>
            <div class="row-actions">
              <button class="btn btn-accent" :disabled="busyKey === 'new-rule'" @click="submitNewRule">
                {{ busyKey === "new-rule" ? "Adding..." : "Add Rule" }}
              </button>
              <button class="btn btn-ghost" @click="showAddForm = false">Cancel</button>
            </div>
          </div>
        </div>

        <p v-if="rules.length === 0" class="muted">No rules yet.</p>
        <p v-else-if="filteredRules.length === 0" class="muted">No rules match your search.</p>

        <div
          v-for="rule in filteredRules"
          :key="rule.id"
          class="rule-card"
          :class="{ 'rule-disabled': !isRuleEnabled(rule) }"
        >
          <template v-if="editingRuleId === rule.id">
            <div class="edit-form">
              <input v-model="editRuleTitle" type="text" placeholder="Target group title" />
              <select v-model="editRuleColor">
                <option v-for="color in TAB_GROUP_COLORS" :key="color" :value="color">
                  {{ color }}
                </option>
              </select>
              <textarea
                v-model="editRulePatterns"
                rows="4"
                placeholder="One pattern per line (or comma-separated)"
              ></textarea>
              <div class="row-actions">
                <button class="btn btn-accent" :disabled="busyKey === `edit-${rule.id}`" @click="saveEditRule(rule)">
                  {{ busyKey === `edit-${rule.id}` ? "Saving..." : "Save" }}
                </button>
                <button class="btn btn-ghost" @click="cancelEditRule">Cancel</button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="rule-head">
              <div class="rule-title-row">
                <button
                  class="chevron-btn"
                  :class="{ expanded: isExpanded(rule.id) }"
                  :title="isExpanded(rule.id) ? 'Hide details' : 'Show details'"
                  @click="toggleExpanded(rule.id)"
                >
                  <Icon name="chevron-down" :size="14" />
                </button>
                <h3>{{ rule.groupTitle }}</h3>
                <span class="badge" :class="rule.matchType === 'url' ? 'badge-domain' : 'badge-regex'">
                  <Icon :name="rule.matchType === 'url' ? 'globe' : 'code'" :size="11" />
                  {{ rule.matchType === "url" ? "domain" : "regex" }}
                </span>
                <span v-if="isPredefinedRule(rule)" class="badge badge-muted">predefined</span>
              </div>
              <div class="rule-actions">
                <button
                  class="icon-btn"
                  :class="isRuleEnabled(rule) ? 'icon-btn-on' : 'icon-btn-off'"
                  :disabled="busyKey === `toggle-${rule.id}`"
                  :title="isRuleEnabled(rule) ? 'Disable rule' : 'Enable rule'"
                  @click="toggleRuleEnabled(rule)"
                >
                  <Icon name="power" :size="14" />
                </button>
                <button
                  class="icon-btn"
                  :disabled="busyKey === `apply-${rule.id}`"
                  title="Apply to open tabs now"
                  @click="applyRuleNow(rule)"
                >
                  <Icon name="refresh" :size="14" />
                </button>
                <button class="icon-btn" title="Edit rule" @click="startEditRule(rule)">
                  <Icon name="edit" :size="14" />
                </button>
                <button
                  class="icon-btn icon-btn-danger"
                  :disabled="busyKey === `rule-${rule.id}`"
                  title="Remove rule"
                  @click="removeRule(rule.id)"
                >
                  <Icon name="trash" :size="14" />
                </button>
              </div>
            </div>

            <Transition name="expand">
              <div v-if="isExpanded(rule.id)">
                <div class="pattern-box">
                  <div v-for="pattern in rule.patterns" :key="pattern" class="pattern-line">
                    {{ pattern }}
                  </div>
                </div>

                <div class="groups-into">
                  <span>→ Groups into:</span>
                  <span class="group-dot" :class="`color-${rule.color}`"></span>
                  <span class="group-link">{{ rule.groupTitle }}</span>
                </div>
              </div>
            </Transition>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page {
  --bg-1: #0b1330;
  --bg-2: #16215294;
  --card-bg: rgba(255, 255, 255, 0.05);
  --card-border: rgba(255, 255, 255, 0.09);
  --text: rgba(255, 255, 255, 0.92);
  --muted: #8b93b8;
  --accent: #6366f1;
  --accent-hover: #7678f5;
  --blue: #3b82f6;
  --green: #22c55e;
  --red: #ef4444;
  --purple: #a855f7;

  min-height: 100vh;
  background: radial-gradient(circle at top left, #1c2b63, var(--bg-1) 60%);
  color: var(--text);
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  padding: 1.75rem 2rem 3rem;
  max-width: 880px;
  margin: 0 auto;
  box-sizing: border-box;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
}

.topbar-title {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--accent), var(--purple));
  color: white;
  flex-shrink: 0;
}

h1 {
  font-size: 1.35rem;
  margin: 0;
}

.subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.82rem;
  color: var(--muted);
}

.muted {
  color: var(--muted);
  font-size: 0.85rem;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 0.9rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.stat-label {
  font-size: 0.78rem;
  color: var(--muted);
}

.stat-purple { color: var(--purple); }
.stat-green { color: var(--green); }
.stat-blue { color: var(--blue); }
.stat-red { color: var(--red); }

.section {
  margin-top: 1.75rem;
}

.section h2 {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
  margin: 0 0 0.6rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.9rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  margin-bottom: 0.5rem;
}

.row-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}

.row-title {
  font-weight: 500;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.rules-toolbar {
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.9rem;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  color: var(--muted);
}

.search-box input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.select-box {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  color: var(--muted);
}

.select-box select {
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 0.85rem;
  font-family: inherit;
}

.select-box select option {
  background: #16204a;
  color: var(--text);
}

.add-form-panel {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.rule-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 12px;
  padding: 0.9rem 1rem;
  margin-bottom: 0.75rem;
}

.rule-disabled {
  opacity: 0.55;
}

.rule-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.rule-title-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.rule-title-row h3 {
  margin: 0;
  font-size: 1rem;
}

.rule-actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.chevron-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--muted);
  cursor: pointer;
  flex-shrink: 0;
}

.chevron-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}

.chevron-btn :deep(svg) {
  transition: transform 0.18s ease;
}

.chevron-btn.expanded :deep(svg) {
  transform: rotate(180deg);
}

.expand-enter-active,
.expand-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .chevron-btn :deep(svg),
  .expand-enter-active,
  .expand-leave-active {
    transition: none;
  }
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  border: 1px solid transparent;
}

.badge-domain {
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.15);
  border-color: rgba(59, 130, 246, 0.35);
}

.badge-regex {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.35);
}

.badge-muted {
  color: var(--muted);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--card-border);
}

.pattern-box {
  margin-top: 0.6rem;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.78rem;
  color: #c9d1f0;
}

.pattern-line + .pattern-line {
  margin-top: 0.2rem;
}

.groups-into {
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--muted);
}

.group-link {
  color: #93c5fd;
  font-weight: 500;
}

.group-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  background: grey;
}

.color-blue { background: #1a73e8; }
.color-cyan { background: #007b83; }
.color-green { background: #188038; }
.color-grey { background: #5f6368; }
.color-orange { background: #e8710a; }
.color-pink { background: #d01884; }
.color-purple { background: #a142f4; }
.color-red { background: #d93025; }
.color-yellow { background: #f9ab00; }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--card-border);
  background: var(--card-bg);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}

.btn:disabled {
  cursor: default;
  opacity: 0.55;
}

.btn-accent {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.btn-accent:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.06);
}

.btn-added {
  color: var(--green);
  border-color: rgba(34, 197, 94, 0.4);
  background: rgba(34, 197, 94, 0.1);
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}

.icon-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.icon-btn-on {
  color: var(--green);
}

.icon-btn-off {
  color: var(--muted);
}

.icon-btn-danger:hover:not(:disabled) {
  color: var(--red);
  background: rgba(239, 68, 68, 0.12);
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-form input,
.edit-form select,
.edit-form textarea {
  font-size: 0.9rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  font-family: inherit;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text);
}

.edit-form select option {
  background: #16204a;
  color: var(--text);
}
</style>
