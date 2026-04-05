<script setup lang="ts">
import { ref, computed } from 'vue';
import { PARAM_LABELS, PARAM_GROUPS } from '../protocol';
import type { TelemetryData } from '../protocol';

const props = defineProps<{
  telemetry: TelemetryData;
}>();

const recording = ref(false);
const recordedData = ref<{ timestamp: number; data: TelemetryData }[]>([]);
let recordTimer: ReturnType<typeof setInterval> | null = null;

function startRecording() {
  recording.value = true;
  recordedData.value = [];
  recordTimer = setInterval(() => {
    recordedData.value.push({
      timestamp: Date.now(),
      data: { ...props.telemetry },
    });
  }, 10000);
}

function stopRecording() {
  recording.value = false;
  if (recordTimer) {
    clearInterval(recordTimer);
    recordTimer = null;
  }
}

function exportCsv() {
  if (recordedData.value.length === 0) return;

  const allKeys = new Set<string>();
  for (const entry of recordedData.value) {
    for (const key of Object.keys(entry.data)) {
      allKeys.add(key);
    }
  }

  const keys = Array.from(allKeys).sort();
  const header = ['timestamp', ...keys].join(',');
  const rows = recordedData.value.map(entry => {
    const ts = new Date(entry.timestamp).toISOString();
    const vals = keys.map(k => entry.data[k] ?? '');
    return [ts, ...vals].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecoflow-telemetry-${new Date().toISOString().slice(0, 19)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const displayGroups = computed(() => {
  const groups: { name: string; params: { key: string; label: string; value: string | number }[] }[] = [];
  const usedKeys = new Set<string>();

  for (const [groupName, paramNames] of Object.entries(PARAM_GROUPS)) {
    const params: { key: string; label: string; value: string | number }[] = [];
    for (const name of paramNames) {
      if (name in props.telemetry) {
        params.push({
          key: name,
          label: PARAM_LABELS[name] ?? name,
          value: props.telemetry[name],
        });
        usedKeys.add(name);
      }
    }
    if (params.length > 0) {
      groups.push({ name: groupName, params });
    }
  }

  // Add unknown params
  const unknownParams: { key: string; label: string; value: string | number }[] = [];
  for (const [key, value] of Object.entries(props.telemetry)) {
    if (!usedKeys.has(key)) {
      unknownParams.push({
        key,
        label: PARAM_LABELS[key] ?? key,
        value,
      });
    }
  }
  if (unknownParams.length > 0) {
    groups.push({ name: 'Other', params: unknownParams });
  }

  return groups;
});

function formatValue(val: string | number): string {
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val.toString() : val.toFixed(1);
  }
  return String(val);
}
</script>

<template>
  <div class="telemetry">
    <div class="header">
      <h3>Telemetry</h3>
      <div class="controls">
        <button v-if="!recording" class="btn" @click="startRecording">Record</button>
        <template v-else>
          <button class="btn stop" @click="stopRecording">Stop ({{ recordedData.length }})</button>
          <button class="btn" @click="exportCsv" :disabled="recordedData.length === 0">Export CSV</button>
        </template>
      </div>
    </div>

    <div v-if="displayGroups.length === 0" class="empty">
      No telemetry data yet. Connect to a device and wait for data.
    </div>

    <div v-for="group in displayGroups" :key="group.name" class="group">
      <h4>{{ group.name }}</h4>
      <div class="param-grid">
        <div v-for="param in group.params" :key="param.key" class="param">
          <span class="param-label">{{ param.label }}</span>
          <span class="param-value">{{ formatValue(param.value) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.telemetry {
  padding: 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

h3 {
  margin: 0;
  color: #e0e0e0;
  font-size: 1.1em;
}

h4 {
  margin: 12px 0 8px 0;
  color: #888;
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.controls {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 6px 14px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.85em;
}

.btn:hover:not(:disabled) {
  background: #333;
}

.btn.stop {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
}

.btn:disabled {
  opacity: 0.5;
}

.empty {
  color: #666;
  font-style: italic;
  padding: 20px 0;
  text-align: center;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 8px;
}

.param {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  background: #2a2a3e;
  border-radius: 4px;
}

.param-label {
  color: #888;
  font-size: 0.85em;
}

.param-value {
  color: #e0e0e0;
  font-family: monospace;
  font-weight: 600;
}
</style>
