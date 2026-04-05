# EcoFlow Bluetooth

A web-based tool for local Bluetooth Low Energy (BLE) control and monitoring of EcoFlow portable power stations, without requiring the EcoFlow app or cloud connectivity.

Built with Vue 3 + TypeScript + Vite, using the Web Bluetooth API.

## Supported Devices

The protocol implementation targets EcoFlow devices that communicate via BLE:

**Type 1 encryption (fully supported — key derived from serial number):**
- **River 2** (R601, R603)
- **River 2 Max** (R611, R613)
- **River 2 Pro** (R621, R623)
- **Delta 2** (DAEB)
- **Delta 2 Max** (DAEC)

**Type 7 encryption (discovery/monitoring — full control requires login_key.bin):**
- **River 3 series** (R651, R653, R654, R655)
- **Delta 3 series** (P331, P351)
- **Delta Pro 3** (MR51)
- **Smart Home Panel 2** (HD31)
- **Delta Pro Ultra** (Y711)

> **Note:** This is based on community reverse-engineering efforts (primarily [rabits/ha-ef-ble](https://github.com/rabits/ha-ef-ble)). River 2 and Delta 2 use Type 1 encryption where the session key is derived from the serial number alone. Newer devices (River 3, Delta 3, etc.) use Type 7 ECDH encryption which requires a `login_key.bin` file extracted from the EcoFlow app.

## Features

- **Device Discovery** — Scan for EcoFlow BLE devices by name prefix and manufacturer data
- **Real-time Telemetry** — Decode battery status, power I/O, temperatures, and more
- **Command Interface** — Send heartbeat requests, toggle AC/DC output
- **Command Scanner** — Systematically scan command ranges to discover device capabilities
- **Protocol Logger** — Full packet-level logging for reverse engineering
- **Raw Packet View** — Inspect all BLE traffic in hex
- **CSV Export** — Record and export telemetry data
- **Session Persistence** — Logs and telemetry survive page reloads

## Protocol Details

EcoFlow BLE devices use a binary protocol with two packet layers:

### Inner Packet (0xAA prefix, protocol v2)
```
[0xAA][version][payload_len_LE][CRC8_header]
[product_byte][seq_LE_4B][0x00][0x00][src][dst][cmdSet][cmdId][payload...]
[CRC16_body_LE]
```

**XOR obfuscation:** If `seq[0] != 0`, each payload byte is XORed with `seq[0]`.

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
- Session key = MD5(login_key[seed] + srand)
- IV = MD5(shared_key)
- Requires `login_key.bin` from EcoFlow app

### River 2 Commands
```
AC toggle:   cmdSet=0x05, cmdId=0x42, payload=[enabled, xboost]
DC 12V:      cmdSet=0x05, cmdId=0x51, payload=[enabled]
Max charge:  cmdSet=0x03, cmdId=0x31, payload=[soc%]
Min disch:   cmdSet=0x03, cmdId=0x33, payload=[soc%]
AC charge:   cmdSet=0x05, cmdId=0x45, payload=[watts_LE, 0xFF]
Quiet mode:  cmdSet=0x05, cmdId=0x53, payload=[enabled]
```

### Heartbeat Sources
```
PD:   src=0x02, cmdSet=0x20, cmdId=0x02 (~155B, battery/power/USB)
EMS:  src=0x03, cmdSet=0x20, cmdId=0x02 (~46B, charge management)
BMS:  src=0x03, cmdSet=0x20, cmdId=0x32 (~69B, cell data)
INV:  src=0x04, cmdId=0x02 (AC input/output)
MPPT: src=0x05, cmdSet=0x20, cmdId=0x02 (~80B, solar/DC input)
```

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

## References

- [rabits/ef-ble-reverse](https://github.com/rabits/ef-ble-reverse) — EcoFlow BLE V2 protocol reverse engineering
- [rabits/ha-ef-ble](https://github.com/rabits/ha-ef-ble) — Home Assistant EcoFlow BLE integration
- [nielsole/ecoflow-bt-reverse-engineering](https://github.com/nielsole/ecoflow-bt-reverse-engineering) — BLE protocol research
- [npike/ha-ecoflow-ble](https://github.com/npike/ha-ecoflow-ble) — Simple HA BLE battery reader

## Disclaimer

This project is not affiliated with EcoFlow. The BLE protocol is reverse-engineered and may change with firmware updates. Use at your own risk. Some commands could potentially affect device operation — exercise caution with output control commands.
