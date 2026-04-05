# EcoFlow Bluetooth

A web-based tool for local Bluetooth Low Energy (BLE) control and monitoring of EcoFlow portable power stations, without requiring the EcoFlow app or cloud connectivity.

Built with Vue 3 + TypeScript + Vite, using the Web Bluetooth API.

## Supported Devices

EcoFlow devices use two encryption schemes over BLE. The encryption type determines what level of local control is possible:

**Type 1 encryption (fully supported — key derived from serial number):**
- **River 2** (serial: R601/R603, BLE name: EF-R2...)
- **River 2 Max** (serial: R611/R613, BLE name: EF-R2M...)
- **River 2 Pro** (serial: R621/R623, BLE name: EF-R2P...)
- **Delta 2** (serial: DAEB, BLE name: EF-D2...)
- **Delta 2 Max** (serial: DAEC, BLE name: EF-D2M...)

**Type 7 encryption (connection only — full control requires login_key.bin):**
- **River 3** (serial: R651, BLE name: EF-R3...)
- **River 3 Plus** (serial: R653, BLE name: EF-R3P...)
- **River 3 Max** (serial: R654, BLE name: EF-R3M...)
- **Delta 3 / Delta 3 Plus** (serial: P331/P351, BLE name: EF-D3...)
- **Delta Pro 3** (serial: MR51, BLE name: EF-DP3...)
- **Smart Home Panel 2** (serial: HD31, BLE name: EF-HD3...)
- **Delta Pro Ultra** (serial: Y711, BLE name: EF-Y7...)

> **Note:** This is based on community reverse-engineering efforts (primarily [rabits/ha-ef-ble](https://github.com/rabits/ha-ef-ble)). Type 1 devices derive the session key from the serial number alone — no cloud account needed. Type 7 devices use ECDH key exchange and require a `login_key.bin` extracted from the EcoFlow Android APK plus your EcoFlow user ID. Without authentication, Type 7 devices disconnect after ~10 seconds.

## Features

- **Device Discovery** — Scan for EcoFlow BLE devices by manufacturer ID (0xB5B5) and name prefix
- **Automatic Identification** — Detects device model and encryption type from BLE name (e.g., EF-R3P50256 = River 3 Plus, Type 7)
- **Type 1 Encryption** — Automatic key derivation for River 2 / Delta 2 devices
- **Real-time Telemetry** — Decode battery status, power I/O, temperatures via binary struct parsing
- **Command Interface** — River 2 commands: AC/DC toggle, X-Boost, charge limits, charge speed, quiet mode
- **Command Scanner** — Systematically scan cmdSet:cmdId ranges to discover device capabilities
- **Protocol Logger** — Full packet-level logging with CRC validation for reverse engineering
- **Raw Packet View** — Inspect all BLE traffic in hex
- **CSV Export** — Record and export telemetry data over time
- **Session Persistence** — Logs and telemetry survive page reloads via sessionStorage

## Protocol Details

EcoFlow BLE devices use a binary protocol with two packet layers:

### BLE Transport

Devices expose two GATT characteristics:
- **Write:** `00000002-0000-1000-8000-00805f9b34fb` (or Nordic UART `6e400002-...`)
- **Notify:** `00000003-0000-1000-8000-00805f9b34fb` (or Nordic UART `6e400003-...`)

Manufacturer ID `0xB5B5` is used for device filtering in BLE advertisements. The serial number is at bytes 1-17 of manufacturer data.

### Inner Packet (0xAA prefix, protocol v2)
```
[0xAA][version][payload_len_LE][CRC8_header]
[product_byte][seq_LE_4B][0x00][0x00][src][dst][cmdSet][cmdId][payload...]
[CRC16_body_LE]
```

**XOR obfuscation:** If `seq[0] != 0`, each payload byte is XORed with `seq[0]`.

**CRC algorithms:** CRC8-CCITT for header (4 bytes), CRC16-ARC for body.

### Encrypted Packet (0x5A5A prefix)
```
[0x5A][0x5A][frame_type<<4|flags][0x01][length_LE]
[AES-CBC encrypted inner packet]
[CRC16_LE]
```

### Encryption

**Type 1 (River 2, Delta 2):**
- Key = MD5(serial_number)
- IV = MD5(reversed_serial_number)
- AES-128-CBC with null padding

**Type 7 (River 3, Delta 3, SHP2, DPU):**
- ECDH SECP160r1 key exchange
- Device sends seed (2 bytes) + srand (16 bytes)
- Session key = MD5(login_key[seed] + srand)
- IV = MD5(shared_key)
- Auth = MD5(user_id + serial_number) as ASCII hex
- Requires `login_key.bin` from EcoFlow Android APK

### River 2 Commands
| Operation | cmdSet | cmdId | Payload |
|-----------|--------|-------|---------|
| AC toggle | 0x05 | 0x42 | [enabled, xboost] |
| DC 12V toggle | 0x05 | 0x51 | [enabled] |
| Max charge SOC | 0x03 | 0x31 | [soc%] (50-100) |
| Min discharge SOC | 0x03 | 0x33 | [soc%] (0-30) |
| AC charge speed | 0x05 | 0x45 | [watts_LE, 0xFF] |
| Quiet mode | 0x05 | 0x53 | [enabled] |

### Heartbeat Messages (device -> app)
| Module | src | cmdSet | cmdId | Description |
|--------|-----|--------|-------|-------------|
| PD | 0x02 | 0x20 | 0x02 | Battery %, power I/O, USB ports (~155B) |
| EMS | 0x03 | 0x20 | 0x02 | Charge state, SOC limits, time remaining (~46B) |
| BMS | 0x03 | 0x20 | 0x32 | Cell voltage, current, temp, cycles, SOH (~69B) |
| INV | 0x04 | — | 0x02 | AC input/output watts, voltage, X-Boost state |
| MPPT | 0x05 | 0x20 | 0x02 | Solar voltage/current/power, DC input (~80B) |

## Development

```bash
npm install
npm run dev
```

Requires Chrome or Edge with Web Bluetooth API support. Works on localhost without HTTPS.

## Building

```bash
npm run build
npm run preview
```

## Compatibility with EcoFlow App / Home Assistant

This tool uses the **bind command (0x35:85)** to register a user hash on the device. This is the same mechanism the official app uses, just with a different user ID.

- **Home Assistant (ha-ef-ble):** Use the same User ID you entered in this web app (default: `0000000000000000`). Enter it as the User ID in the HA integration configuration.
- **Official EcoFlow app:** The app will try to bind with your cloud account's user ID. If the device was previously bound via this tool, the app may need to re-bind. A **factory reset** on the device (physical button combo — check your device manual) should clear all BLE bindings.
- **Reverting:** Factory reset the device to clear the binding, then pair normally through the EcoFlow app.

The bind is **not permanent** — EcoFlow devices support re-binding. This tool does not modify firmware or make irreversible changes.

## References

- [rabits/ha-ef-ble](https://github.com/rabits/ha-ef-ble) — Home Assistant EcoFlow BLE integration (most complete implementation)
- [rabits/ef-ble-reverse](https://github.com/rabits/ef-ble-reverse) — EcoFlow BLE V2 protocol reverse engineering
- [tolwi/hassio-ecoflow-cloud](https://github.com/tolwi/hassio-ecoflow-cloud) — MQTT cloud integration (River 2 command reference)
- [nielsole/ecoflow-bt-reverse-engineering](https://github.com/nielsole/ecoflow-bt-reverse-engineering) — Early BLE protocol research
- [npike/ha-ecoflow-ble](https://github.com/npike/ha-ecoflow-ble) — Simple HA BLE battery reader
- [Kotsiubynskyi/ef-ble-wrapper](https://github.com/Kotsiubynskyi/ef-ble-wrapper) — Python BLE wrapper

## Disclaimer

This project is not affiliated with EcoFlow. The BLE protocol is reverse-engineered and may change with firmware updates. Use at your own risk. Some commands could potentially affect device operation — exercise caution with output control commands.
