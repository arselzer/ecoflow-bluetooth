<script setup lang="ts">
import type { ConnectionState } from '../protocol';

defineProps<{
  state: ConnectionState;
  deviceName: string | null;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  clear: [];
}>();

const stateLabels: Record<ConnectionState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  negotiating: 'Negotiating...',
  connected: 'Connected',
};

const stateColors: Record<ConnectionState, string> = {
  disconnected: '#666',
  connecting: '#f59e0b',
  negotiating: '#f59e0b',
  connected: '#22c55e',
};
</script>

<template>
  <div class="connection-panel">
    <div class="status">
      <span class="dot" :style="{ background: stateColors[state] }"></span>
      <span class="label">{{ stateLabels[state] }}</span>
      <span v-if="deviceName" class="device-name">{{ deviceName }}</span>
    </div>
    <div class="actions">
      <template v-if="state === 'disconnected'">
        <button class="btn secondary" @click="emit('clear')">Clear</button>
        <button class="btn primary" @click="emit('connect')">Connect</button>
      </template>
      <template v-else>
        <button
          class="btn danger"
          :disabled="state === 'connecting'"
          @click="emit('disconnect')"
        >
          Disconnect
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.connection-panel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.label {
  font-weight: 600;
  color: #e0e0e0;
}

.device-name {
  color: #888;
  font-size: 0.9em;
  font-family: monospace;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.95em;
}

.primary {
  background: #3b82f6;
  color: white;
}

.primary:hover {
  background: #2563eb;
}

.secondary {
  background: #374151;
  color: #e0e0e0;
}

.secondary:hover {
  background: #4b5563;
}

.danger {
  background: #ef4444;
  color: white;
}

.danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
