<script setup lang="ts">
import { ref } from 'vue';
import { fromHex, generateAuthPayload } from '../protocol';

const props = defineProps<{
  connected: boolean;
  deviceName: string | null;
  userId: string;
  serialNumber: string;
}>();

const emit = defineEmits<{
  command: [src: number, dst: number, cmdSet: number, cmdId: number, payload: Uint8Array, version?: number];
  rawBytes: [hex: string];
}>();

// Try to bind via 0x35:85 with auth hash payload
function tryBind() {
  const uid = props.userId || '0000000000000000';
  const sn = props.serialNumber || 'unknown';
  const payload = generateAuthPayload(uid, sn);
  emit('command', 0x21, 0x35, 0x35, 0x85, payload);
}

// Query bind status (0x35:85 with empty payload)
function queryBindStatus() {
  emit('command', 0x21, 0x35, 0x35, 0x85, new Uint8Array(0));
}

// Try unbind candidates
function tryUnbind84empty() { emit('command', 0x21, 0x35, 0x35, 0x84, new Uint8Array(0)); }
function tryUnbind84hash() {
  const uid = props.userId || '0000000000000000';
  const sn = props.serialNumber || 'unknown';
  emit('command', 0x21, 0x35, 0x35, 0x84, generateAuthPayload(uid, sn));
}
function tryUnbind85zero() { emit('command', 0x21, 0x35, 0x35, 0x85, new Uint8Array([0x00])); }
function tryUnbind87empty() { emit('command', 0x21, 0x35, 0x35, 0x87, new Uint8Array(0)); }
function tryUnbind88empty() { emit('command', 0x21, 0x35, 0x35, 0x88, new Uint8Array(0)); }

// River 3 config commands — protobuf ConfigWrite via cmdSet=0xFE, cmdId=0x11, version=0x13
// Packet: src=0x20, dst=0x02
function encodeProtobufBool(fieldNum: number, value: boolean): Uint8Array {
  const tag = (fieldNum << 3) | 0; // varint wire type
  const bytes: number[] = [];
  let t = tag;
  while (t > 0x7f) { bytes.push((t & 0x7f) | 0x80); t >>>= 7; }
  bytes.push(t & 0x7f);
  bytes.push(value ? 1 : 0);
  return new Uint8Array(bytes);
}

function encodeProtobufUint32(fieldNum: number, value: number): Uint8Array {
  const tag = (fieldNum << 3) | 0;
  const bytes: number[] = [];
  let t = tag;
  while (t > 0x7f) { bytes.push((t & 0x7f) | 0x80); t >>>= 7; }
  bytes.push(t & 0x7f);
  let v = value;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

// River 3 commands use version 0x13 for config packets
function sendR3Config(payload: Uint8Array) {
  // src=0x20, dst=0x02, cmdSet=0xFE, cmdId=0x11, version=0x13
  emit('command', 0x20, 0x02, 0xfe, 0x11, payload, 0x13);
}

function r3AcOn() { sendR3Config(encodeProtobufBool(76, true)); }
function r3AcOff() { sendR3Config(encodeProtobufBool(76, false)); }
function r3DcOn() { sendR3Config(encodeProtobufBool(20, true)); }
function r3DcOff() { sendR3Config(encodeProtobufBool(20, false)); }
function r3Dc12vOn() { sendR3Config(encodeProtobufBool(18, true)); }
function r3Dc12vOff() { sendR3Config(encodeProtobufBool(18, false)); }
function r3XboostOn() { sendR3Config(encodeProtobufBool(25, true)); }
function r3XboostOff() { sendR3Config(encodeProtobufBool(25, false)); }

// Custom command fields
const customSrc = ref('20');
const customDst = ref('01');
const customCmdSet = ref('02');
const customCmdId = ref('01');
const customPayload = ref('');
const rawHex = ref('');

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
        Commands are based on reverse-engineered protocol (rabits/ha-ef-ble).
        AC/DC toggles verified on River 2 series. Other devices may differ.
        Use with caution — some commands could affect device operation.
      </div>

      <div class="section">
        <h4>Bind / Auth</h4>
        <p class="hint">
          Binding registers a user hash on the device. The auto-connect flow does this automatically.
          If you need to re-bind with a different user ID (e.g., for EcoFlow app or Home Assistant),
          you can use these controls. Factory reset on the device should also clear bindings.
        </p>
        <div class="button-grid">
          <button class="cmd-btn bind" @click="queryBindStatus">Query Status (85 empty)</button>
          <button class="cmd-btn bind" @click="tryBind">Bind (85 + hash)</button>
        </div>
        <h4>Unbind Discovery</h4>
        <p class="hint">Try nearby cmdIds to find an unbind command. Check Log tab for responses.</p>
        <div class="button-grid">
          <button class="cmd-btn unbind" @click="tryUnbind84empty">84 empty</button>
          <button class="cmd-btn unbind" @click="tryUnbind84hash">84 + hash</button>
          <button class="cmd-btn unbind" @click="tryUnbind85zero">85 + 0x00</button>
          <button class="cmd-btn unbind" @click="tryUnbind87empty">87 empty</button>
          <button class="cmd-btn unbind" @click="tryUnbind88empty">88 empty</button>
        </div>
      </div>

      <div class="section">
        <h4>Output Control (River 3)</h4>
        <p class="hint">Protobuf ConfigWrite via cmdSet=0xFE, cmdId=0x11. Watch telemetry for ac_enabled/dc_enabled changes.</p>
        <div class="button-grid">
          <button class="cmd-btn on" @click="r3AcOn">AC On</button>
          <button class="cmd-btn off" @click="r3AcOff">AC Off</button>
          <button class="cmd-btn on" @click="r3DcOn">DC On</button>
          <button class="cmd-btn off" @click="r3DcOff">DC Off</button>
          <button class="cmd-btn on" @click="r3Dc12vOn">12V On</button>
          <button class="cmd-btn off" @click="r3Dc12vOff">12V Off</button>
          <button class="cmd-btn on" @click="r3XboostOn">X-Boost On</button>
          <button class="cmd-btn off" @click="r3XboostOff">X-Boost Off</button>
        </div>
      </div>

      <div class="section">
        <h4>Charge Settings (River 3)</h4>
        <div class="button-grid">
          <button class="cmd-btn" @click="sendR3Config(encodeProtobufUint32(33, 100))">Max Charge 100%</button>
          <button class="cmd-btn" @click="sendR3Config(encodeProtobufUint32(33, 80))">Max Charge 80%</button>
          <button class="cmd-btn" @click="sendR3Config(encodeProtobufUint32(34, 0))">Min Discharge 0%</button>
          <button class="cmd-btn" @click="sendR3Config(encodeProtobufUint32(34, 20))">Min Discharge 20%</button>
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
            <input v-model="rawHex" placeholder="aa02..." />
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

.cmd-btn.bind {
  border-color: #a855f7;
  color: #a855f7;
}

.cmd-btn.unbind {
  border-color: #f59e0b;
  color: #f59e0b;
}

.hint {
  color: #666;
  font-size: 0.8em;
  margin: 0 0 8px 0;
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
