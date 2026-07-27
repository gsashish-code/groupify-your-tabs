<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getAllTabGroups } from "@/utils/tabs";
import { updateGroup, removeGroup, TAB_GROUP_COLORS, type TabGroupColor } from "@/utils/tabGroups";
import { debounce } from "@/utils/debounce";
import type { AutoGroupRule } from "@/utils/rules";

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
          <span class="group-dot" :class="`color-${group.color}`"></span>
          <span class="row-title">{{ group.title || "Untitled group" }}</span>
        </div>
        <div class="row-actions">
          <button @click="startEdit(group)">Edit</button>
          <button
            class="danger"
            :disabled="busyKey === `remove-${group.id}`"
            @click="handleRemoveGroup(group)"
          >
            {{ busyKey === `remove-${group.id}` ? "Removing..." : "Remove" }}
          </button>
        </div>
      </div>

      <div v-else class="edit-form">
        <input v-model="editTitle" type="text" placeholder="Group title" />
        <select v-model="editColor">
          <option v-for="color in TAB_GROUP_COLORS" :key="color" :value="color">{{ color }}</option>
        </select>
        <div class="row-actions">
          <button :disabled="busyKey === `edit-${group.id}`" @click="saveEdit(group)">
            {{ busyKey === `edit-${group.id}` ? "Saving..." : "Save" }}
          </button>
          <button @click="cancelEdit">Cancel</button>
        </div>
      </div>
    </div>

    <div v-for="rule in pendingRules" :key="rule.id" class="group-block">
      <div class="row">
        <div class="row-info">
          <span class="group-dot" :class="`color-${rule.color}`"></span>
          <span class="row-title">{{ rule.groupTitle }}</span>
          <span class="muted">(no tabs open yet)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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

.row-actions {
  display: flex;
  gap: 0.3rem;
  flex-shrink: 0;
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

button.danger {
  border-color: #e0a0a0;
  background: #fdeeee;
  color: #b3261e;
}

.group-block {
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3rem;
  margin-bottom: 0.3rem;
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

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.4rem;
}

.edit-form input,
.edit-form select {
  font-size: 0.85rem;
  padding: 0.3rem;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-family: inherit;
}
</style>
