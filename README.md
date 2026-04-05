# EcoFlow Bluetooth

A web-based tool for local Bluetooth Low Energy (BLE) control and monitoring of EcoFlow portable power stations, **without requiring the EcoFlow app or cloud connectivity**.

Built with Vue 3 + TypeScript + Vite, using the Web Bluetooth API. Tested on River 3 Plus with live telemetry and AC/DC control.

> **Warning:** Connecting to an unbound device will automatically **bind your user hash** to it via the BLE bind command (`0x35:85`). This registers a user on the device so that authentication succeeds. The bind is reversible (factory reset clears it), but be aware that a device bound this way may reject authentication from the official EcoFlow app until re-bound. See the [Compatibility](#compatibility-with-ecoflow-app--home-assistant) section for details.

## Supported Devices

**Type 1 encryption (River 2 / Delta 2):**
- **River 2** (serial: R601/R603, BLE name: EF-R2...)
- **River 2 Max** (serial: R611/R613, BLE name: EF-R2M...)
- **River 2 Pro** (serial: R621/R623, BLE name: EF-R2P...)
- **Delta 2** (serial: DAEB, BLE name: EF-D2...)
- **Delta 2 Max** (serial: DAEC, BLE name: EF-D2M...)

**Type 7 encryption (River 3 / Delta 3 / newer devices):**
- **River 3** (serial: R651, BLE name: EF-R3...)
- **River 3 Plus** (serial: R653, BLE name: EF-R3P...) -- tested
- **River 3 Max** (serial: R654, BLE name: EF-R3M...)
- **Delta 3 / Delta 3 Plus** (serial: P331/P351, BLE name: EF-D3...)
- **Delta Pro 3** (serial: MR51, BLE name: EF-DP3...)
- **Smart Home Panel 2** (serial: HD31, BLE name: EF-HD3...)
- **Delta Pro Ultra** (serial: Y711, BLE name: EF-Y7...)

Both encryption types are fully supported. No EcoFlow account or app is needed -- the tool handles ECDH key exchange, user binding, and authentication entirely over BLE.

## Features

- **No cloud dependency** -- connects, binds, authenticates, and controls devices entirely via local Bluetooth
- **Automatic ECDH handshake** -- SECP160r1 key exchange, session key derivation from bundled key data
- **User binding without EcoFlow app** -- discovered undocumented bind command (`0x35:85`) that registers a user on the device
- **Real-time telemetry** -- protobuf-decoded data: battery %, temperature, solar input, power I/O, cycle count, SOH, and 30+ fields
- **Device control** -- AC/DC/12V/X-Boost toggle, charge limits (River 3 protobuf commands)
- **Command scanner** -- probe for unknown commands, with bind/unbind discovery presets
- **Protocol logger** -- full packet-level logging with export to JSON/TXT
- **Raw packet view** -- inspect all encrypted/decrypted BLE traffic in hex
- **CSV telemetry export** -- record and download telemetry data over time
- **Session persistence** -- logs and telemetry survive page reloads

## Quick Start

```bash
npm install
npm run dev
```

1. Open in Chrome/Edge (Web Bluetooth required)
2. Enter your device serial number (from the sticker on the device, e.g. `R631ZE1AWH550256`)
3. Click **Connect** and select your EcoFlow device
4. The app handles ECDH handshake, binding, and authentication automatically
5. Telemetry appears in the Telemetry tab, controls in the Commands tab

## Protocol Details

### Authentication Flow (Type 7)

1. **ECDH key exchange** -- generate SECP160r1 keypair, exchange public keys via unencrypted `0x5A5A` frames
2. **Session key derivation** -- device sends encrypted seed+srand, compute `MD5(keydata[seed] + srand)`
3. **Bind user (`0x35:85`)** -- send `MD5(userId + serial)` as uppercase hex ASCII to register on device
4. **Auth status (`0x35:89`)** -- query authentication state
5. **Authenticate (`0x35:86`)** -- send same auth hash, device confirms and starts streaming telemetry

### Packet Format

**Inner Packet (0xAA prefix):**
```
[0xAA][version][payload_len_LE][CRC8_header]
[product_byte][seq_LE_4B][0x00][0x00][src][dst][dsrc][ddst][cmdSet][cmdId][payload...]
[CRC16_LE]
```
- v3 packets: auth commands (dsrc=1, ddst=1)
- v19 (0x13) packets: telemetry data with XOR obfuscation (seq[0] as key)
- CRC8-CCITT for header, CRC16-ARC for body

**Encrypted Packet (0x5A5A prefix):**
```
[0x5A][0x5A][frame_type<<4][0x01][length_LE]
[AES-128-CBC encrypted inner packet]
[CRC16_LE]
```

### Encryption

**Type 1 (River 2, Delta 2):** `Key = MD5(serial)`, `IV = MD5(reversed_serial)`

**Type 7 (River 3, Delta 3, etc.):** ECDH SECP160r1 shared secret, `IV = MD5(shared_key)`, session key from bundled 65KB lookup table

### River 3 Commands (protobuf ConfigWrite)

Config packets: `Packet(src=0x20, dst=0x02, cmdSet=0xFE, cmdId=0x11, version=0x13)`

| Operation | Protobuf field | Type |
|-----------|---------------|------|
| AC output toggle | `cfg_ac_out_open` (field 76) | bool |
| DC output toggle | `cfg_dc_out_open` (field 20) | bool |
| 12V car port toggle | `cfg_dc_12v_out_open` (field 18) | bool |
| X-Boost toggle | `cfg_xboost_en` (field 25) | bool |
| Max charge SOC | `cfg_max_chg_soc` (field 33) | uint32 |
| Min discharge SOC | `cfg_min_dsg_soc` (field 34) | uint32 |
| AC charge speed | `cfg_plug_in_info_ac_in_chg_pow_max` (field 87) | uint32 |
| DC charge type | `cfg_pv_chg_type` (field varies) | uint32 |

### River 3 Telemetry (protobuf, cmd=fe:15)

| Field | Protobuf field # | Description |
|-------|-----------------|-------------|
| Battery % | 8 | State of charge |
| Temperature | 242 | Device temp (float32, C) |
| Solar input | 359 | Solar power (W) |
| BMS cycles | 227 | Battery cycle count |
| BMS SOH | 263 | State of health (float32, %) |
| AC enabled | 25 | AC output state |
| DC enabled | 195 | DC output state |
| Charge limit | 270 | Max charge % |
| Discharge limit | 271 | Min discharge % |
| Full capacity | 248 | Wh capacity |

### Auth/Bind Commands

| cmdSet | cmdId | Direction | Description |
|--------|-------|-----------|-------------|
| 0x35 | 0x84 | app->device | Unbind? (returns 0x00) |
| 0x35 | 0x85 | app->device | **Bind user** (discovered) |
| 0x35 | 0x86 | app->device | Authenticate user |
| 0x35 | 0x89 | app->device | Query auth status |

### Auth Error Codes

| Code | Meaning |
|------|---------|
| 0x00 | Success |
| 0x03 | DeviceAlreadyBound |
| 0x04 | NeedBindInstallFirst |
| 0x06 | WrongKey (user ID mismatch) |

## Compatibility with EcoFlow App / Home Assistant

This tool uses the **bind command (0x35:85)** to register a user hash on the device -- the same mechanism the official app uses.

- **Home Assistant (ha-ef-ble):** Use the same User ID from this web app (default: `0000000000000000`) in the HA integration config.
- **Official EcoFlow app:** May need to re-bind. A **factory reset** on the device should clear BLE bindings.
- **Reverting:** Factory reset the device, then pair normally through the EcoFlow app.

The bind is **not permanent** -- EcoFlow devices support re-binding. This tool does not modify firmware or make irreversible changes.

## Building

```bash
npm run build
npm run preview
```

## References

- [rabits/ha-ef-ble](https://github.com/rabits/ha-ef-ble) -- Home Assistant EcoFlow BLE integration
- [rabits/ef-ble-reverse](https://github.com/rabits/ef-ble-reverse) -- EcoFlow BLE V2 protocol reverse engineering
- [tolwi/hassio-ecoflow-cloud](https://github.com/tolwi/hassio-ecoflow-cloud) -- MQTT cloud integration
- [nielsole/ecoflow-bt-reverse-engineering](https://github.com/nielsole/ecoflow-bt-reverse-engineering) -- Early BLE protocol research

## Disclaimer

This project is not affiliated with EcoFlow. The BLE protocol is reverse-engineered and may change with firmware updates. Use at your own risk.
