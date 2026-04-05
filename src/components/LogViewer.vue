<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import type { LogEntry } from '../protocol';

const props = defineProps<{
  entries: LogEntry[];
}>();

const autoScroll = ref(true);
const container = ref<HTMLElement | null>(null);
const copied = ref(false);

watch(() => props.entries.length, () => {
  if (autoScroll.value) {
    nextTick(() => {
      if (container.value) {
        container.value.scrollTop = container.value.scrollHeight;
      }
    });
  }
});

const directionColors: Record<string, string> = {
  tx: '#3b82f6',
  rx: '#22c55e',
  info: '#888',
  error: '#ef4444',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}

function copyAll() {
  const text = props.entries.map(e => {
    const time = formatTime(e.timestamp);
    const dir = e.direction.toUpperCase().padEnd(5);
    const data = e.data ? ` [${e.data}]` : '';
    return `${time} ${dir} ${e.message}${data}`;
  }).join('\n');

  navigator.clipboard.writeText(text).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }).catch(() => {
    // Fallback for non-HTTPS
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}
</script>

<template>
  <div class="log-viewer">
    <div class="header">
      <h3>Protocol Log ({{ entries.length }})</h3>
      <div class="controls">
        <label class="auto-scroll">
          <input type="checkbox" v-model="autoScroll" /> Auto-scroll
        </label>
        <button class="btn" @click="copyAll">{{ copied ? 'Copied!' : 'Copy All' }}</button>
      </div>
    </div>
    <div ref="container" class="log-container">
      <div
        v-for="(entry, i) in entries"
        :key="i"
        class="log-entry"
      >
        <span class="time">{{ formatTime(entry.timestamp) }}</span>
        <span class="dir" :style="{ color: directionColors[entry.direction] }">
          {{ entry.direction.toUpperCase() }}
        </span>
        <span class="msg">{{ entry.message }}</span>
        <span v-if="entry.data" class="data">{{ entry.data }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-viewer {
  padding: 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

h3 {
  margin: 0;
  color: #e0e0e0;
  font-size: 1.1em;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.auto-scroll {
  color: #888;
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn {
  padding: 4px 12px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.8em;
}

.btn:hover {
  background: #333;
}

.log-container {
  height: 400px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.8em;
  line-height: 1.6;
}

.log-entry {
  display: flex;
  gap: 8px;
  padding: 1px 0;
}

.time {
  color: #555;
  flex-shrink: 0;
}

.dir {
  font-weight: 700;
  width: 40px;
  flex-shrink: 0;
}

.msg {
  color: #ccc;
  word-break: break-word;
}

.data {
  color: #666;
  word-break: break-all;
  font-size: 0.9em;
}
</style>
