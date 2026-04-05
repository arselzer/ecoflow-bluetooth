<script setup lang="ts">
import { ref } from 'vue';
import type { ConnectionState } from '../protocol';

defineProps<{
  state: ConnectionState;
  deviceName: string | null;
}>();

const emit = defineEmits<{
  connect: [userId: string, serialOverride: string];
  disconnect: [];
  clear: [];
}>();

const userId = ref(localStorage.getItem('ef-user-id') ?? '');
const serialOverride = ref(localStorage.getItem('ef-serial') ?? '');

function handleConnect() {
  localStorage.setItem('ef-user-id', userId.value);
  localStorage.setItem('ef-serial', serialOverride.value);
  emit('connect', userId.value, serialOverride.value);
}

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
    <div class="top-row">
      <div class="status">
        <span class="dot" :style="{ background: stateColors[state] }"></span>
        <span class="label">{{ stateLabels[state] }}</span>
        <span v-if="deviceName" class="device-name">{{ deviceName }}</span>
      </div>
      <div class="actions">
        <template v-if="state === 'disconnected'">
          <button class="btn secondary" @click="emit('clear')">Clear</button>
          <button class="btn primary" @click="handleConnect">Connect</button>
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
    <div v-if="state === 'disconnected'" class="settings-row">
      <input
        v-model="serialOverride"
        placeholder="Device Serial (from sticker, e.g. R653...)"
        class="settings-input"
        title="Full 16-char serial from device sticker. BLE name is truncated — auth needs the real serial."
      />
      <input
        v-model="userId"
        placeholder="EcoFlow User ID (optional)"
        class="settings-input"
        title="Get from EcoFlow app ef_uid cookie. Leave empty to try default."
      />
    </div>
  </div>
</template>

<style scoped>
.connection-panel {
  padding: 12px 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.settings-row {
  margin-top: 8px;
  display: flex;
  gap: 8px;
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

.settings-input {
  padding: 6px 10px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-family: monospace;
  font-size: 0.85em;
  flex: 1;
  min-width: 0;
}

.settings-input:focus {
  outline: none;
  border-color: #3b82f6;
}
</style>
