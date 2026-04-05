<script setup lang="ts">
import { ref } from 'vue';
import { fromHex } from '../protocol';

const props = defineProps<{
  connected: boolean;
}>();

const emit = defineEmits<{
  command: [src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array];
}>();

const scanning = ref(false);
const scanSrc = ref('20');
const scanDst = ref('01');
const scanCmdSet = ref('02');
const scanIdFrom = ref('00');
const scanIdTo = ref('3f');
const scanPayload = ref('');
const scanDelay = ref(500);
const scanResults = ref<{ cmd: string; sent: boolean }[]>([]);
const currentCmd = ref('');
const scanProgress = ref(0);
const scanTotal = ref(0);

async function startScan() {
  const from = parseInt(scanIdFrom.value, 16);
  const to = parseInt(scanIdTo.value, 16);
  if (isNaN(from) || isNaN(to) || from > to) return;

  const src = parseInt(scanSrc.value, 16);
  const dst = parseInt(scanDst.value, 16);
  const cmdSet = parseInt(scanCmdSet.value, 16);

  scanning.value = true;
  scanResults.value = [];
  scanTotal.value = to - from + 1;
  scanProgress.value = 0;

  const payload = scanPayload.value ? fromHex(scanPayload.value) : new Uint8Array(0);

  for (let cmdId = from; cmdId <= to; cmdId++) {
    if (!scanning.value) break;
    if (!props.connected) {
      scanning.value = false;
      break;
    }

    const cmdHex = `${cmdSet.toString(16).padStart(2, '0')}:${cmdId.toString(16).padStart(2, '0')}`;
    currentCmd.value = cmdHex;
    scanProgress.value = cmdId - from + 1;

    scanResults.value.push({ cmd: cmdHex, sent: true });
    emit('command', src, dst, cmdSet, cmdId, payload);

    await new Promise(r => setTimeout(r, scanDelay.value));
  }

  currentCmd.value = '';
  scanning.value = false;
}

function stopScan() {
  scanning.value = false;
}
</script>

<template>
  <div class="scanner">
    <h3>Command Scanner</h3>
    <p class="description">
      Scans a range of command IDs within a command set and logs responses.
      Watch the Protocol Log tab to see which commands get responses.
    </p>

    <div class="config">
      <div class="field">
        <label>Src (hex)</label>
        <input v-model="scanSrc" placeholder="20" :disabled="scanning" />
      </div>
      <div class="field">
        <label>Dst (hex)</label>
        <input v-model="scanDst" placeholder="01" :disabled="scanning" />
      </div>
      <div class="field">
        <label>CmdSet (hex)</label>
        <input v-model="scanCmdSet" placeholder="02" :disabled="scanning" />
      </div>
      <div class="field">
        <label>CmdId from</label>
        <input v-model="scanIdFrom" placeholder="00" :disabled="scanning" />
      </div>
      <div class="field">
        <label>CmdId to</label>
        <input v-model="scanIdTo" placeholder="3f" :disabled="scanning" />
      </div>
      <div class="field wide">
        <label>Payload (hex)</label>
        <input v-model="scanPayload" placeholder="optional" :disabled="scanning" />
      </div>
      <div class="field">
        <label>Delay (ms)</label>
        <input v-model.number="scanDelay" type="number" :disabled="scanning" />
      </div>
    </div>

    <div class="actions">
      <button
        v-if="!scanning"
        class="btn start"
        :disabled="!connected"
        @click="startScan"
      >
        Scan {{ scanCmdSet }}:{{ scanIdFrom }} - {{ scanCmdSet }}:{{ scanIdTo }}
      </button>
      <button v-else class="btn stop" @click="stopScan">
        Stop ({{ scanProgress }}/{{ scanTotal }} - {{ currentCmd }})
      </button>
    </div>

    <div v-if="scanResults.length > 0" class="results">
      <div class="result-summary">
        Scanned {{ scanResults.length }} commands. Check the Log tab for responses.
      </div>
      <div class="commands-sent">
        <span v-for="r in scanResults" :key="r.cmd" class="cmd-badge">
          {{ r.cmd }}
        </span>
      </div>
    </div>

    <div class="presets">
      <h4>Bind Discovery (probe for bind commands)</h4>
      <p class="description">
        Send auth-like payloads on cmdSet 0x35 to find the bind command.
        Known: 0x86=auth, 0x89=auth status. Try nearby cmdIds with auth payload.
      </p>
      <div class="preset-grid">
        <button class="preset bind" @click="scanSrc = '21'; scanDst = '35'; scanCmdSet = '35'; scanIdFrom = '80'; scanIdTo = '8f'; scanPayload = ''; scanDelay = 1000" :disabled="scanning">
          0x35:80-8F (near auth)
        </button>
        <button class="preset bind" @click="scanSrc = '21'; scanDst = '35'; scanCmdSet = '35'; scanIdFrom = '00'; scanIdTo = '20'; scanPayload = ''; scanDelay = 1000" :disabled="scanning">
          0x35:00-20 (low range)
        </button>
        <button class="preset bind" @click="scanSrc = '21'; scanDst = '35'; scanCmdSet = '35'; scanIdFrom = '00'; scanIdTo = 'ff'; scanPayload = ''; scanDelay = 800" :disabled="scanning">
          0x35:00-FF (full auth set)
        </button>
        <button class="preset bind" @click="scanSrc = '21'; scanDst = '35'; scanCmdSet = '53'; scanIdFrom = '00'; scanIdTo = '60'; scanPayload = ''; scanDelay = 1000" :disabled="scanning">
          0x53:00-60 (BLE/WiFi module)
        </button>
      </div>
    </div>

    <div class="presets">
      <h4>CmdSet Presets</h4>
      <div class="preset-grid">
        <button class="preset" @click="scanCmdSet = '01'" :disabled="scanning">0x01 (System)</button>
        <button class="preset" @click="scanCmdSet = '02'" :disabled="scanning">0x02 (PD/BMS)</button>
        <button class="preset" @click="scanCmdSet = '04'" :disabled="scanning">0x04 (Inverter)</button>
        <button class="preset" @click="scanCmdSet = '05'" :disabled="scanning">0x05 (MPPT)</button>
        <button class="preset" @click="scanCmdSet = '0c'" :disabled="scanning">0x0C (Time)</button>
        <button class="preset" @click="scanCmdSet = '35'" :disabled="scanning">0x35 (Auth)</button>
      </div>
    </div>

    <div class="presets">
      <h4>Scan Range Presets</h4>
      <div class="preset-grid">
        <button class="preset" @click="scanIdFrom = '00'; scanIdTo = '3f'" :disabled="scanning">0x00-0x3F</button>
        <button class="preset" @click="scanIdFrom = '40'; scanIdTo = '7f'" :disabled="scanning">0x40-0x7F</button>
        <button class="preset" @click="scanIdFrom = '80'; scanIdTo = 'bf'" :disabled="scanning">0x80-0xBF</button>
        <button class="preset" @click="scanIdFrom = 'c0'; scanIdTo = 'ff'" :disabled="scanning">0xC0-0xFF</button>
        <button class="preset full" @click="scanIdFrom = '00'; scanIdTo = 'ff'" :disabled="scanning">Full 0x00-0xFF</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scanner {
  padding: 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

h3 {
  margin: 0 0 4px 0;
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

.description {
  color: #888;
  font-size: 0.85em;
  margin: 0 0 12px 0;
}

.config {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field label {
  font-size: 0.75em;
  color: #888;
}

.field input {
  padding: 6px 10px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  font-family: monospace;
  font-size: 0.9em;
  width: 80px;
}

.field.wide input {
  width: 140px;
}

.field input:focus {
  outline: none;
  border-color: #3b82f6;
}

.field input:disabled {
  opacity: 0.5;
}

.actions {
  margin-bottom: 12px;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.95em;
}

.start {
  background: #f59e0b;
  color: #000;
}

.start:hover:not(:disabled) {
  background: #d97706;
}

.start:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stop {
  background: #ef4444;
  color: white;
}

.stop:hover {
  background: #dc2626;
}

.results {
  margin-bottom: 12px;
}

.result-summary {
  color: #888;
  font-size: 0.85em;
  margin-bottom: 8px;
}

.commands-sent {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cmd-badge {
  font-family: monospace;
  font-size: 0.75em;
  padding: 2px 6px;
  background: #2a2a3e;
  border-radius: 3px;
  color: #888;
}

.presets {
  border-top: 1px solid #333;
  padding-top: 8px;
}

.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset {
  padding: 6px 12px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.8em;
  font-family: monospace;
}

.preset:hover:not(:disabled) {
  background: #333;
}

.preset.full {
  border-color: #f59e0b;
  color: #f59e0b;
}

.preset.bind {
  border-color: #a855f7;
  color: #a855f7;
}

.preset:disabled {
  opacity: 0.5;
}
</style>
