<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { EcoFlowConnection } from './protocol';
import type { ConnectionState, TelemetryData, LogEntry } from './protocol';
import ConnectionPanel from './components/ConnectionPanel.vue';
import TelemetryDisplay from './components/TelemetryDisplay.vue';
import CommandPanel from './components/CommandPanel.vue';
import CommandScanner from './components/CommandScanner.vue';
import LogViewer from './components/LogViewer.vue';
import RawPackets from './components/RawPackets.vue';

const connectionState = ref<ConnectionState>('disconnected');
const deviceName = ref<string | null>(null);
const telemetry = reactive<TelemetryData>({});
const logEntries = ref<LogEntry[]>([]);
const rawPackets = ref<{ timestamp: number; direction: 'tx' | 'rx'; data: Uint8Array }[]>([]);
const activeTab = ref<'telemetry' | 'commands' | 'scanner' | 'log' | 'raw'>('telemetry');
const webBluetoothSupported = ref(true);
const currentUserId = ref('');
const currentSerial = ref('');
let wakeLock: WakeLockSentinel | null = null;

const connection = new EcoFlowConnection({
  onStateChange(state) {
    connectionState.value = state;
    if (state === 'connected') {
      acquireWakeLock();
    } else if (state === 'disconnected') {
      releaseWakeLock();
    }
  },
  onTelemetry(data) {
    for (const [key, value] of Object.entries(data)) {
      telemetry[key] = value;
    }
  },
  onLog(entry) {
    logEntries.value.push(entry);
    if (logEntries.value.length > 500) {
      logEntries.value = logEntries.value.slice(-400);
    }
  },
  onRawPacket(direction, data) {
    rawPackets.value.push({ timestamp: Date.now(), direction, data });
    if (rawPackets.value.length > 1000) {
      rawPackets.value = rawPackets.value.slice(-800);
    }
  },
  onDeviceInfo(info) {
    deviceName.value = info.deviceName || info.serialNumber;
  },
});

// Persistence
let saveTimer: ReturnType<typeof setInterval> | null = null;

function saveState() {
  try {
    sessionStorage.setItem('ef-bt-logs', JSON.stringify(
      logEntries.value.slice(-200).map(e => ({ ...e })),
    ));
    sessionStorage.setItem('ef-bt-telemetry', JSON.stringify(telemetry));
    sessionStorage.setItem('ef-bt-tab', activeTab.value);
  } catch { /* quota exceeded */ }
}

function restoreState() {
  try {
    const logs = sessionStorage.getItem('ef-bt-logs');
    if (logs) logEntries.value = JSON.parse(logs);

    const tel = sessionStorage.getItem('ef-bt-telemetry');
    if (tel) {
      const data = JSON.parse(tel);
      for (const [k, v] of Object.entries(data)) {
        telemetry[k] = v as string | number;
      }
    }

    const tab = sessionStorage.getItem('ef-bt-tab');
    if (tab) activeTab.value = tab as typeof activeTab.value;
  } catch { /* ignore */ }
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not supported */ }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

async function handleConnect(userId: string, serialOverride: string) {
  try {
    const effectiveUserId = userId || '0000000000000000';
    currentUserId.value = effectiveUserId;
    currentSerial.value = serialOverride;
    connection.setUserId(effectiveUserId);
    if (serialOverride) {
      connection.setSerialOverride(serialOverride);
    }
    await connection.connect();
    deviceName.value = connection.deviceName;
  } catch (e) {
    console.error('Connect failed:', e);
  }
}

async function handleDisconnect() {
  await connection.disconnect();
  deviceName.value = null;
}

function handleClear() {
  logEntries.value = [];
  rawPackets.value = [];
  for (const key of Object.keys(telemetry)) {
    delete telemetry[key];
  }
  sessionStorage.clear();
}

function handleCommand(src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array) {
  connection.sendRawCommand(src, dst, cmdSet, cmdId, payload);
}

function handleRawBytes(hex: string) {
  connection.sendRawBytes(hex);
}

onMounted(() => {
  webBluetoothSupported.value = 'bluetooth' in navigator;
  restoreState();
  saveTimer = setInterval(saveState, 3000);
});

onUnmounted(() => {
  if (saveTimer) clearInterval(saveTimer);
  releaseWakeLock();
});

const tabs = [
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'commands', label: 'Commands' },
  { key: 'scanner', label: 'Scanner' },
  { key: 'log', label: 'Log' },
  { key: 'raw', label: 'Raw' },
] as const;
</script>

<template>
  <div class="app">
    <header>
      <h1>EcoFlow Bluetooth</h1>
      <span class="subtitle">Local BLE control for EcoFlow power stations</span>
    </header>

    <div v-if="!webBluetoothSupported" class="warning">
      Web Bluetooth API is not available in this browser.
      Please use Chrome or Edge on a desktop or Android device.
    </div>

    <ConnectionPanel
      :state="connectionState"
      :device-name="deviceName"
      @connect="handleConnect"
      @disconnect="handleDisconnect"
      @clear="handleClear"
    />

    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
        <span v-if="tab.key === 'log'" class="badge">{{ logEntries.length }}</span>
        <span v-if="tab.key === 'raw'" class="badge">{{ rawPackets.length }}</span>
      </button>
    </nav>

    <main>
      <TelemetryDisplay
        v-if="activeTab === 'telemetry'"
        :telemetry="telemetry"
      />
      <CommandPanel
        v-if="activeTab === 'commands'"
        :connected="connectionState === 'connected'"
        :device-name="deviceName"
        :user-id="currentUserId"
        :serial-number="currentSerial"
        @command="handleCommand"
        @raw-bytes="handleRawBytes"
      />
      <CommandScanner
        v-if="activeTab === 'scanner'"
        :connected="connectionState === 'connected'"
        @command="handleCommand"
      />
      <LogViewer
        v-if="activeTab === 'log'"
        :entries="logEntries"
      />
      <RawPackets
        v-if="activeTab === 'raw'"
        :packets="rawPackets"
      />
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 960px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
}

h1 {
  margin: 0;
  font-size: 1.4em;
  color: #e0e0e0;
}

.subtitle {
  color: #666;
  font-size: 0.85em;
}

.warning {
  background: #7f1d1d;
  border: 1px solid #991b1b;
  border-radius: 8px;
  padding: 12px 16px;
  color: #fca5a5;
  font-size: 0.9em;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #333;
  padding-bottom: 0;
}

.tab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #888;
  cursor: pointer;
  font-size: 0.95em;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab:hover {
  color: #ccc;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.badge {
  background: #333;
  color: #888;
  font-size: 0.75em;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 400;
}

main {
  min-height: 400px;
}
</style>
