<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getAllTabGroups } from "@/utils/tabs";
import { updateGroup, removeGroup, TAB_GROUP_COLORS, type TabGroupColor } from "@/utils/tabGroups";
import { debounce } from "@/utils/debounce";
import type { AutoGroupRule } from "@/utils/rules";
import Icon from "@/components/Icon.vue";

// Rules with no live group yet (e.g. just added, nothing open matches them) still show up here,
// as a placeholder — a rule is "listening" for a matching tab from the moment it's created.
const props = withDefaults(defineProps<{ rules?: AutoGroupRule[] }>(), { rules: () => [] });

const groups = ref<Browser.tabGroups.TabGroup[]>([]);
const busyKey = ref<string | null>(null);

const pendingRules = computed(() =>
  props.rules.filter((rule) => !groups.value.some((group) => group.title === rule.groupTitle)),
);

async function loadGroups() {
  groups.value = await getAllTabGroups();
}

// Tab groups are live browser state, edited from here, the popup, or Chrome's own UI — stay in
// sync with all of them while this component is mounted, instead of requiring a manual refresh.
const scheduleReload = debounce(loadGroups, 200);

function registerLiveListeners() {
  browser.tabGroups.onCreated.addListener(scheduleReload);
  browser.tabGroups.onUpdated.addListener(scheduleReload);
  browser.tabGroups.onRemoved.addListener(scheduleReload);
  browser.tabGroups.onMoved.addListener(scheduleReload);
}

function unregisterLiveListeners() {
  browser.tabGroups.onCreated.removeListener(scheduleReload);
  browser.tabGroups.onUpdated.removeListener(scheduleReload);
  browser.tabGroups.onRemoved.removeListener(scheduleReload);
  browser.tabGroups.onMoved.removeListener(scheduleReload);
}

onMounted(() => {
  loadGroups();
  registerLiveListeners();
});

onUnmounted(unregisterLiveListeners);

const editingGroupId = ref<number | null>(null);
const editTitle = ref("");
const editColor = ref<TabGroupColor>("grey");

function startEdit(group: Browser.tabGroups.TabGroup) {
  editingGroupId.value = group.id;
  editTitle.value = group.title ?? "";
  editColor.value = group.color;
}

function cancelEdit() {
  editingGroupId.value = null;
}

async function saveEdit(group: Browser.tabGroups.TabGroup) {
  busyKey.value = `edit-${group.id}`;
  try {
    await updateGroup(group.id, editTitle.value.trim() || "Untitled group", editColor.value);
    editingGroupId.value = null;
  } finally {
    busyKey.value = null;
  }
}

async function handleRemoveGroup(group: Browser.tabGroups.TabGroup) {
  busyKey.value = `remove-${group.id}`;
  try {
    await removeGroup(group.id);
  } finally {
    busyKey.value = null;
  }
}
</script>

<template>
  <div>
    <p v-if="groups.length === 0 && pendingRules.length === 0" class="muted">No groups yet.</p>
    <div v-for="group in groups" :key="group.id" class="group-block">
      <div v-if="editingGroupId !== group.id" class="row">
        <div class="row-info">
          <span class="group-icon" :class="`color-${group.color}`"><Icon name="folder" :size="13" /></span>
          <span class="row-title">{{ group.title || "Untitled group" }}</span>
        </div>
        <div class="row-actions">
          <button class="icon-btn" title="Edit group" @click="startEdit(group)">
            <Icon name="edit" :size="13" />
          </button>
          <button
            class="icon-btn icon-btn-danger"
            :disabled="busyKey === `remove-${group.id}`"
            title="Remove group"
            @click="handleRemoveGroup(group)"
          >
            <Icon name="trash" :size="13" />
          </button>
        </div>
      </div>

      <div v-else class="edit-form">
        <input v-model="editTitle" type="text" placeholder="Group title" />
        <select v-model="editColor">
          <option v-for="color in TAB_GROUP_COLORS" :key="color" :value="color">{{ color }}</option>
        </select>
        <div class="row-actions">
          <button class="btn btn-accent" :disabled="busyKey === `edit-${group.id}`" @click="saveEdit(group)">
            {{ busyKey === `edit-${group.id}` ? "Saving..." : "Save" }}
          </button>
          <button class="btn btn-ghost" @click="cancelEdit">Cancel</button>
        </div>
      </div>
    </div>

    <div v-for="rule in pendingRules" :key="rule.id" class="group-block">
      <div class="row">
        <div class="row-info">
          <span class="group-icon" :class="`color-${rule.color}`"><Icon name="folder" :size="13" /></span>
          <span class="row-title">{{ rule.groupTitle }}</span>
          <span class="muted">(no tabs open yet)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.muted {
  color: var(--muted, #8b93b8);
  font-size: 0.85rem;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0;
}

.row-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow: hidden;
}

.row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.group-block {
  border-bottom: 1px solid var(--card-border, rgba(255, 255, 255, 0.09));
  padding-bottom: 0.3rem;
  margin-bottom: 0.3rem;
}

.group-block:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}

.group-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
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

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.09));
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted, #8b93b8);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  color: var(--text, #fff);
  background: rgba(255, 255, 255, 0.08);
}

.icon-btn:disabled {
  cursor: default;
  opacity: 0.5;
}

.icon-btn-danger:hover:not(:disabled) {
  color: var(--red, #ef4444);
  background: rgba(239, 68, 68, 0.12);
}

.btn {
  font-size: 0.82rem;
  font-weight: 500;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.09));
  cursor: pointer;
  font-family: inherit;
}

.btn-accent {
  background: var(--accent, #6366f1);
  border-color: var(--accent, #6366f1);
  color: white;
}

.btn-ghost {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text, #fff);
}

.btn:disabled {
  cursor: default;
  opacity: 0.6;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.edit-form input,
.edit-form select {
  font-size: 0.85rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--card-border, rgba(255, 255, 255, 0.09));
  border-radius: 7px;
  font-family: inherit;
  background: rgba(0, 0, 0, 0.2);
  color: var(--text, #fff);
}

.edit-form select option {
  background: #16204a;
  color: #fff;
}
</style>
