<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from "vue";
import { getAllTabs } from "@/utils/tabs";
import { suggestGroups, createGroup, type GroupSuggestion } from "@/utils/tabGroups";
import { debounce } from "@/utils/debounce";
import { getRules, RULES_STORAGE_KEY, type AutoGroupRule } from "@/utils/rules";
import YourTabs from "@/components/YourTabs.vue";
import Icon from "@/components/Icon.vue";

const suggestions = ref<GroupSuggestion[]>([]);
const rules = ref<AutoGroupRule[]>([]);
const loading = ref(true);
const busyKey = ref<string | null>(null);

// Refreshes without toggling `loading`, so live updates don't flash the loading state.
async function loadSuggestions() {
  const allTabs = await getAllTabs();
  const ungroupedTabs = allTabs.filter((tab) => tab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE);
  suggestions.value = suggestGroups(ungroupedTabs);
}

async function loadRules() {
  rules.value = await getRules();
}

function handleStorageChange(
  changes: Record<string, Browser.storage.StorageChange>,
  area: string,
) {
  if (area === "local" && RULES_STORAGE_KEY in changes) loadRules();
}

async function initialLoad() {
  loading.value = true;
  await Promise.all([loadSuggestions(), loadRules()]);
  loading.value = false;
}

// Which tabs count as "ungrouped" changes whenever tabs or groups change anywhere — options page,
// another window, or Chrome's own UI — so keep suggestions in sync with all of them.
const scheduleReload = debounce(loadSuggestions, 200);

function registerLiveListeners() {
  browser.tabGroups.onCreated.addListener(scheduleReload);
  browser.tabGroups.onUpdated.addListener(scheduleReload);
  browser.tabGroups.onRemoved.addListener(scheduleReload);
  browser.tabGroups.onMoved.addListener(scheduleReload);
  browser.tabs.onCreated.addListener(scheduleReload);
  browser.tabs.onRemoved.addListener(scheduleReload);
  browser.tabs.onUpdated.addListener(scheduleReload);
}

function unregisterLiveListeners() {
  browser.tabGroups.onCreated.removeListener(scheduleReload);
  browser.tabGroups.onUpdated.removeListener(scheduleReload);
  browser.tabGroups.onRemoved.removeListener(scheduleReload);
  browser.tabGroups.onMoved.removeListener(scheduleReload);
  browser.tabs.onCreated.removeListener(scheduleReload);
  browser.tabs.onRemoved.removeListener(scheduleReload);
  browser.tabs.onUpdated.removeListener(scheduleReload);
}

onMounted(() => {
  initialLoad();
  registerLiveListeners();
  browser.storage.onChanged.addListener(handleStorageChange);
});

onUnmounted(() => {
  unregisterLiveListeners();
  browser.storage.onChanged.removeListener(handleStorageChange);
});

function openCustomTabRules() {
  browser.runtime.openOptionsPage();
}

// --- Suggested tabs ---

async function createSuggestedGroup(suggestion: GroupSuggestion) {
  const tabIds = suggestion.tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
  if (tabIds.length === 0) return;

  busyKey.value = `suggestion-${suggestion.name}`;
  try {
    await createGroup(tabIds, suggestion.name, suggestion.color);
  } finally {
    busyKey.value = null;
  }
}
</script>

<template>
  <div class="popup">
    <header class="popup-header">
      <span class="brand-icon"><Icon name="bolt" :size="16" /></span>
      <h1>Groupify Your Tabs</h1>
    </header>

    <p v-if="loading" class="muted">Loading tabs...</p>

    <template v-else>
      <section class="section">
        <button class="link-button" @click="openCustomTabRules">
          Customize your own tab rule
          <Icon name="chevron-down" :size="13" style="transform: rotate(-90deg)" />
        </button>
      </section>

      <section v-if="suggestions.length" class="section">
        <h2><Icon name="plus" :size="12" /> Suggested Tabs</h2>
        <div v-for="suggestion in suggestions" :key="suggestion.name" class="row">
          <div class="row-info">
            <span class="group-icon" :class="`color-${suggestion.color}`"><Icon name="folder" :size="12" /></span>
            <span class="row-title">{{ suggestion.name }}</span>
            <span class="muted">({{ suggestion.tabs.length }})</span>
          </div>
          <button
            class="btn btn-accent"
            :disabled="busyKey === `suggestion-${suggestion.name}`"
            @click="createSuggestedGroup(suggestion)"
          >
            {{ busyKey === `suggestion-${suggestion.name}` ? "Creating..." : "Create" }}
          </button>
        </div>
      </section>

      <section class="section">
        <h2><Icon name="folder" :size="12" /> Your Tabs</h2>
        <YourTabs :rules="rules" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.popup {
  --bg-1: #0b1330;
  --card-bg: rgba(255, 255, 255, 0.05);
  --card-border: rgba(255, 255, 255, 0.09);
  --text: rgba(255, 255, 255, 0.92);
  --muted: #8b93b8;
  --accent: #6366f1;
  --accent-hover: #7678f5;
  --green: #22c55e;
  --red: #ef4444;
  --purple: #a855f7;

  min-width: 320px;
  max-height: 480px;
  padding: 1rem;
  overflow-y: auto;
  background: radial-gradient(circle at top left, #1c2b63, var(--bg-1) 65%);
  color: var(--text);
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
}

.popup-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.brand-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: linear-gradient(135deg, var(--accent), var(--purple));
  color: white;
  flex-shrink: 0;
}

h1 {
  font-size: 1rem;
  margin: 0;
}

.section {
  text-align: left;
  margin-top: 1.1rem;
}

.section h2 {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
  margin: 0 0 0.5rem;
}

.muted {
  color: var(--muted);
  font-size: 0.85rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.7rem;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: 9px;
  margin-bottom: 0.4rem;
}

.row-info {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  overflow: hidden;
}

.row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn {
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.3rem 0.7rem;
  border-radius: 7px;
  border: 1px solid var(--card-border);
  cursor: pointer;
  font-family: inherit;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}

.btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.btn-accent {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.btn-accent:hover:not(:disabled) {
  background: var(--accent-hover);
}

.group-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  flex-shrink: 0;
  color: white;
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

.link-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 8px;
  color: #a5b4fc;
  font-weight: 500;
  font-size: 0.85rem;
  padding: 0.5rem 0.6rem;
  cursor: pointer;
  font-family: inherit;
}

.link-button:hover {
  background: rgba(99, 102, 241, 0.2);
}
</style>
