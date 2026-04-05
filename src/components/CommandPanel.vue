<script setup lang="ts">
import { ref } from 'vue';
import { KNOWN_COMMANDS, fromHex } from '../protocol';

defineProps<{
  connected: boolean;
  deviceName: string | null;
}>();

const emit = defineEmits<{
  command: [src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array];
  rawBytes: [hex: string];
}>();

// Custom command fields
const customSrc = ref('20');
const customDst = ref('01');
const customCmdSet = ref('02');
const customCmdId = ref('01');
const customPayload = ref('');
const rawHex = ref('');

function sendKnownCommand(key: string) {
  const cmd = KNOWN_COMMANDS[key];
  if (!cmd) return;
  const payload = cmd.payloads?.default ? fromHex(cmd.payloads.default) : new Uint8Array(0);
  emit('command', 0x20, 0x01, cmd.cmdSet, cmd.cmdId, payload);
}

function sendCustomCommand() {
  try {
    const src = parseInt(customSrc.value, 16);
    const dst = parseInt(customDst.value, 16);
    const cmdSet = parseInt(customCmdSet.value, 16);
    const cmdId = parseInt(customCmdId.value, 16);
    const payload = customPayload.value ? fromHex(customPayload.value) : new Uint8Array(0);
    emit('command', src, dst, cmdSet, cmdId, payload);
  } catch (e) {
    console.error('Invalid command input:', e);
  }
}

function sendRawHex() {
  if (rawHex.value.length > 0 && rawHex.value.length % 2 === 0) {
    emit('rawBytes', rawHex.value);
  }
}


</script>

<template>
  <div class="commands">
    <h3>Commands</h3>

    <div v-if="!connected" class="notice">
      Connect to a device first to send commands.
    </div>

    <template v-else>
      <div class="warning">
        Commands are based on reverse-engineered protocol and may not work on all devices.
        AC/DC toggle commands have not been verified on all models. Use with caution.
      </div>

      <div class="section">
        <h4>Status Requests</h4>
        <div class="button-grid">
          <button class="cmd-btn" @click="sendKnownCommand('pd_heartbeat')">PD Heartbeat</button>
          <button class="cmd-btn" @click="sendKnownCommand('bms_heartbeat')">BMS Heartbeat</button>
          <button class="cmd-btn" @click="sendKnownCommand('inv_heartbeat')">INV Heartbeat</button>
          <button class="cmd-btn" @click="sendKnownCommand('mppt_heartbeat')">MPPT Heartbeat</button>
        </div>
      </div>

      <div class="section">
        <h4>Output Control</h4>
        <div class="button-grid">
          <button class="cmd-btn on" @click="sendKnownCommand('ac_on')">AC On</button>
          <button class="cmd-btn off" @click="sendKnownCommand('ac_off')">AC Off</button>
          <button class="cmd-btn on" @click="sendKnownCommand('dc_on')">DC On</button>
          <button class="cmd-btn off" @click="sendKnownCommand('dc_off')">DC Off</button>
        </div>
      </div>

      <div class="section">
        <h4>Custom Command</h4>
        <div class="custom-form">
          <div class="field">
            <label>Src (hex)</label>
            <input v-model="customSrc" placeholder="20" />
          </div>
          <div class="field">
            <label>Dst (hex)</label>
            <input v-model="customDst" placeholder="01" />
          </div>
          <div class="field">
            <label>CmdSet (hex)</label>
            <input v-model="customCmdSet" placeholder="02" />
          </div>
          <div class="field">
            <label>CmdId (hex)</label>
            <input v-model="customCmdId" placeholder="01" />
          </div>
          <div class="field wide">
            <label>Payload (hex)</label>
            <input v-model="customPayload" placeholder="optional hex payload" />
          </div>
          <button class="cmd-btn send" @click="sendCustomCommand">Send</button>
        </div>
      </div>

      <div class="section">
        <h4>Raw Bytes</h4>
        <div class="raw-form">
          <div class="field wide">
            <label>Hex data (no spaces)</label>
            <input v-model="rawHex" placeholder="aa03..." />
          </div>
          <button class="cmd-btn send" @click="sendRawHex">Send Raw</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.commands {
  padding: 16px;
  background: #1e1e2e;
  border-radius: 8px;
  border: 1px solid #333;
}

h3 {
  margin: 0 0 12px 0;
  color: #e0e0e0;
  font-size: 1.1em;
}

h4 {
  margin: 0 0 8px 0;
  color: #888;
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.notice {
  color: #666;
  font-style: italic;
  padding: 20px 0;
  text-align: center;
}

.warning {
  background: #422006;
  border: 1px solid #92400e;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  color: #fbbf24;
  font-size: 0.85em;
}

.section {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #333;
}

.section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.button-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.cmd-btn {
  padding: 8px 16px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 6px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.9em;
  font-weight: 500;
}

.cmd-btn:hover {
  background: #333;
}

.cmd-btn.on {
  border-color: #22c55e;
  color: #22c55e;
}

.cmd-btn.off {
  border-color: #ef4444;
  color: #ef4444;
}

.cmd-btn.send {
  background: #3b82f6;
  border-color: #3b82f6;
  color: white;
  align-self: flex-end;
}

.cmd-btn.send:hover {
  background: #2563eb;
}

.custom-form, .raw-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
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
  width: 200px;
}

.field input:focus {
  outline: none;
  border-color: #3b82f6;
}
</style>
