<script lang="ts" setup>
import Icon from "@/components/Icon.vue";

withDefaults(defineProps<{ message: string | null; variant?: "success" | "error" }>(), {
  variant: "success",
});
</script>

<template>
  <Teleport to="body">
    <Transition name="toast">
      <div v-if="message" class="toast" :class="`toast-${variant}`" role="status">
        <span class="toast-icon"><Icon :name="variant === 'error' ? 'alert' : 'check'" :size="12" /></span>
        <span class="toast-text">{{ message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 1.5rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.65rem 1.1rem;
  border-radius: 10px;
  background: #16204a;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.92);
  font-size: 0.85rem;
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 1000;
  max-width: min(90vw, 420px);
}

.toast-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.18);
  color: #22c55e;
  flex-shrink: 0;
}

.toast-error {
  border-color: rgba(239, 68, 68, 0.35);
}

.toast-error .toast-icon {
  background: rgba(239, 68, 68, 0.18);
  color: #ef4444;
}

.toast-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    transition: none;
  }
}
</style>
