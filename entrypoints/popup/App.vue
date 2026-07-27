<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from "vue";
import { getAllTabs } from "@/utils/tabs";
import { suggestGroups, createGroup, type GroupSuggestion } from "@/utils/tabGroups";
import { debounce } from "@/utils/debounce";
import { getRules, RULES_STORAGE_KEY, type AutoGroupRule } from "@/utils/rules";
import YourTabs from "@/components/YourTabs.vue";

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
    <h1>Groupify Your Tabs</h1>

    <p v-if="loading">Loading tabs...</p>

    <template v-else>
      <section class="section">
        <button class="link-button" @click="openCustomTabRules">Customize your own tab rule →</button>
      </section>

      <section v-if="suggestions.length" class="section">
        <h2>Suggested Tabs</h2>
        <div v-for="suggestion in suggestions" :key="suggestion.name" class="row">
          <div class="row-info">
            <span class="group-dot" :class="`color-${suggestion.color}`"></span>
            <span class="row-title">{{ suggestion.name }}</span>
            <span class="muted">({{ suggestion.tabs.length }})</span>
          </div>
          <button
            :disabled="busyKey === `suggestion-${suggestion.name}`"
            @click="createSuggestedGroup(suggestion)"
          >
            {{ busyKey === `suggestion-${suggestion.name}` ? "Creating..." : "Create" }}
          </button>
        </div>
      </section>

      <section class="section">
        <h2>Your Tabs</h2>
        <YourTabs :rules="rules" />
      </section>
    </template>
  </div>
</template>

<style scoped>
.popup {
  min-width: 300px;
  max-height: 480px;
  padding: 1rem;
  text-align: center;
  overflow-y: auto;
}

.section {
  text-align: left;
  margin-top: 1.1rem;
}

.section h2 {
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #666;
  margin: 0 0 0.4rem;
}

.muted {
  color: #888;
  font-size: 0.85rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0;
}

.row-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
}

.row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

button {
  font-size: 0.8rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
}

button:disabled {
  cursor: default;
  opacity: 0.6;
}

.group-dot {
  width: 10px;
  height: 10px;
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

.link-button {
  width: 100%;
  text-align: center;
  background: none;
  border: none;
  color: #646cff;
  font-weight: 500;
  padding: 0.4rem 0;
}

.link-button:hover {
  text-decoration: underline;
}
</style>
