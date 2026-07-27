<script lang="ts" setup>
import { onMounted, ref } from "vue";

const groups = ref<Browser.tabGroups.TabGroup[]>([]);
const ungroupedTabs = ref<Browser.tabs.Tab[]>([]);
const loading = ref(true);

async function loadTabs() {
  loading.value = true;

  const [allTabs, allGroups] = await Promise.all([
    browser.tabs.query({}),
    browser.tabGroups.query({}),
  ]);

  groups.value = allGroups;
  // Tabs already in a group are excluded — only ungrouped tabs are candidates for grouping.
  ungroupedTabs.value = allTabs.filter(
    (tab) => tab.groupId === browser.tabGroups.TAB_GROUP_ID_NONE,
  );

  loading.value = false;
}

onMounted(loadTabs);
</script>

<template>
  <div class="popup">
    <h1>Groupify Your Tabs</h1>

    <p v-if="loading">Loading tabs...</p>

    <template v-else>
      <section v-if="groups.length" class="section">
        <h2>Existing Groups</h2>
        <div v-for="group in groups" :key="group.id" class="group">
          <span class="group-dot" :class="`color-${group.color}`"></span>
          <span class="group-title">{{ group.title || "Untitled group" }}</span>
        </div>
      </section>

      <section class="section">
        <h2>Ungrouped Tabs ({{ ungroupedTabs.length }})</h2>
        <p v-if="ungroupedTabs.length === 0">Every tab already belongs to a group.</p>
        <ul v-else class="tab-list">
          <li v-for="tab in ungroupedTabs" :key="tab.id" class="tab-item">
            <img v-if="tab.favIconUrl" :src="tab.favIconUrl" class="favicon" alt="" />
            <span class="title">{{ tab.title || tab.url }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.popup {
  min-width: 280px;
  max-height: 400px;
  padding: 1rem;
  text-align: center;
  overflow-y: auto;
}

.section {
  text-align: left;
  margin-top: 1rem;
}

.section h2 {
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #666;
  margin: 0 0 0.4rem;
}

.group {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0;
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

.tab-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  overflow: hidden;
}

.favicon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
