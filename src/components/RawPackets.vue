<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { toHex } from '../protocol';

const props = defineProps<{
  packets: { timestamp: number; direction: 'tx' | 'rx'; data: Uint8Array }[];
}>();

const autoScroll = ref(true);
const container = ref<HTMLElement | null>(null);

watch(() => props.packets.length, () => {
  if (autoScroll.value) {
    nextTick(() => {
      if (container.value) {
        container.value.scrollTop = container.value.scrollHeight;
      }
    });
  }
});

function exportPackets() {
  const data = {
    exported: new Date().toISOString(),
    packetCount: props.packets.length,
    packets: props.packets.map(p => ({
      ts: p.timestamp,
      dir: p.direction,
      hex: toHex(p.data),
      len: p.data.length,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ecoflow-packets-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  } as Intl.DateTimeFormatOptions);
}
</script>

<template>
  <div class="raw-packets">
    <div class="header">
      <h3>Raw Packets ({{ packets.length }})</h3>
      <div class="controls">
        <label class="auto-scroll">
          <input type="checkbox" v-model="autoScroll" /> Auto-scroll
        </label>
        <button class="btn" @click="exportPackets">Save .json</button>
      </div>
    </div>
    <div ref="container" class="packet-container">
      <div
        v-for="(pkt, i) in packets"
        :key="i"
        class="packet-entry"
      >
        <span class="time">{{ formatTime(pkt.timestamp) }}</span>
        <span class="dir" :class="pkt.direction">{{ pkt.direction.toUpperCase() }}</span>
        <span class="size">{{ pkt.data.length }}B</span>
        <span class="hex">{{ toHex(pkt.data) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.raw-packets {
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

.auto-scroll {
  color: #888;
  font-size: 0.85em;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}

.packet-container {
  height: 250px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.75em;
  line-height: 1.6;
}

.packet-entry {
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
  width: 24px;
  flex-shrink: 0;
}

.dir.tx {
  color: #3b82f6;
}

.dir.rx {
  color: #22c55e;
}

.size {
  color: #888;
  width: 36px;
  flex-shrink: 0;
  text-align: right;
}

.hex {
  color: #666;
  word-break: break-all;
}
</style>
