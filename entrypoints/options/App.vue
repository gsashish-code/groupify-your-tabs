<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from "vue";
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
  RULES_STORAGE_KEY,
  type AutoGroupRule,
  type MatchType,
} from "@/utils/rules";
import YourTabs from "@/components/YourTabs.vue";

const rules = ref<AutoGroupRule[]>([]);
const loading = ref(true);
const busyKey = ref<string | null>(null);
const statusMessage = ref<string | null>(null);

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
      : `"${rule.groupTitle}" added — no open tabs matched yet.`;
}

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
    statusMessage.value =
      movedCount > 0
        ? `"${rule.groupTitle}": grouped ${movedCount} open tab${movedCount === 1 ? "" : "s"}.`
        : `"${rule.groupTitle}": no open tabs matched.`;
  } finally {
    busyKey.value = null;
  }
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
  <div>
    <h1>Custom Tab Rules</h1>
    <p class="intro">
      Adding a rule immediately groups any already-open matching tabs, creating
      the group if it doesn't exist yet. Future tabs that navigate to a matching
      URL are grouped the same way.
    </p>

    <p v-if="statusMessage" class="status">{{ statusMessage }}</p>
    <p v-if="loading">Loading...</p>

    <template v-else>
      <section class="section">
        <h2>Your Tabs</h2>
        <YourTabs :rules="rules" />
      </section>

      <section class="section">
        <h2>Quick Add from Categories</h2>
        <div
          v-for="category in PREDEFINED_GROUPS"
          :key="category.id"
          class="row"
        >
          <div class="row-info">
            <span class="group-dot" :class="`color-${category.color}`"></span>
            <span class="row-title">{{ category.name }}</span>
            <span class="muted">{{ category.hostnames.join(", ") }}</span>
          </div>

          <div class="row-actions">
            <button
              :disabled="busyKey === `quick-${category.id}` || isCategoryAdded(category)"
              @click="quickAddCategory(category)"
            >
              {{ busyKey === `quick-${category.id}` ? "Adding..." : isCategoryAdded(category) ? "Added" : "Add" }}
            </button>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Your Rules</h2>
        <p v-if="rules.length === 0" class="muted">No rules yet.</p>
        <div v-for="rule in rules" :key="rule.id" class="rule-block">
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
                <button :disabled="busyKey === `edit-${rule.id}`" @click="saveEditRule(rule)">
                  {{ busyKey === `edit-${rule.id}` ? "Saving..." : "Save" }}
                </button>
                <button @click="cancelEditRule">Cancel</button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="row">
              <div class="row-info">
                <span class="group-dot" :class="`color-${rule.color}`"></span>
                <span class="row-title">{{ rule.groupTitle }}</span>
                <span class="muted">({{ rule.matchType }}){{ isPredefinedRule(rule) ? " · predefined" : "" }}</span>
              </div>
              <div class="row-actions">
                <button :disabled="busyKey === `apply-${rule.id}`" @click="applyRuleNow(rule)">
                  {{ busyKey === `apply-${rule.id}` ? "Applying..." : "Apply Now" }}
                </button>
                <button @click="startEditRule(rule)">Edit</button>
                <button class="danger" :disabled="busyKey === `rule-${rule.id}`" @click="removeRule(rule.id)">
                  {{ busyKey === `rule-${rule.id}` ? "Removing..." : "Remove" }}
                </button>
              </div>
            </div>
            <ul class="pattern-list">
              <li v-for="pattern in rule.patterns" :key="pattern">
                {{ pattern }}
              </li>
            </ul>
          </template>
        </div>
      </section>

      <section class="section">
        <h2>Add Custom Rule</h2>
        <div class="edit-form">
          <input
            v-model="newRuleGroupTitle"
            type="text"
            placeholder="Target group title"
          />
          <select v-model="newRuleColor">
            <option
              v-for="color in TAB_GROUP_COLORS"
              :key="color"
              :value="color"
            >
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
          <button :disabled="busyKey === 'new-rule'" @click="submitNewRule">
            {{ busyKey === "new-rule" ? "Adding..." : "Add Rule" }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
h1 {
  font-size: 1.5rem;
  margin-bottom: 0.3rem;
}

.intro {
  color: #888;
  font-size: 0.85rem;
  max-width: 60ch;
}

.link-button {
  background: none;
  border: none;
  color: #b3261e;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  margin-top: 0.5rem;
}

.link-button:disabled {
  cursor: default;
  opacity: 0.6;
}

.status {
  font-size: 0.85rem;
  color: #188038;
  margin-top: 0.5rem;
}

.row-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.section {
  margin-top: 1.5rem;
}

.section h2 {
  font-size: 0.9rem;
  text-transform: uppercase;
  color: #888;
  margin: 0 0 0.5rem;
}

.muted {
  color: #888;
  font-size: 0.85rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0;
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

button {
  font-size: 0.85rem;
  padding: 0.3rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
  flex-shrink: 0;
}

button:disabled {
  cursor: default;
  opacity: 0.6;
}

button.danger {
  border-color: #e0a0a0;
  background: #fdeeee;
  color: #b3261e;
}

.rule-block {
  border-bottom: 1px solid #333;
  padding-bottom: 0.4rem;
  margin-bottom: 0.4rem;
}

.group-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: grey;
}

.color-blue {
  background: #1a73e8;
}
.color-cyan {
  background: #007b83;
}
.color-green {
  background: #188038;
}
.color-grey {
  background: #5f6368;
}
.color-orange {
  background: #e8710a;
}
.color-pink {
  background: #d01884;
}
.color-purple {
  background: #a142f4;
}
.color-red {
  background: #d93025;
}
.color-yellow {
  background: #f9ab00;
}

.pattern-list {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0 0 0 1.6rem;
  font-size: 0.8rem;
  color: #888;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 420px;
}

.edit-form input,
.edit-form select,
.edit-form textarea {
  font-size: 0.9rem;
  padding: 0.4rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-family: inherit;
}

.edit-form button {
  align-self: flex-start;
}
</style>
