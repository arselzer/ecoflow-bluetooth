# EcoFlow Bluetooth

A web-based tool for local Bluetooth Low Energy (BLE) control and monitoring of EcoFlow portable power stations, without requiring the EcoFlow app or cloud connectivity.

Built with Vue 3 + TypeScript + Vite, using the Web Bluetooth API.

## Supported Devices

The protocol implementation targets EcoFlow devices that communicate via BLE:

- **River 2 series** (R331, R332, R333)
- **River 3 series** (R651, R653, R654, R655)
- **Delta 2 / Delta 2 Max** (DAEB, DAEC)
- **Delta 3 series** (P331, P351)
- **Delta Pro 3** (MR51)
- **Smart Home Panel 2** (HD31)
- **Delta Pro Ultra** (Y711)

> **Note:** This is based on community reverse-engineering efforts. Not all features work on all devices. Newer devices use encrypted V2 protocol which requires additional key material.

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

### Inner Packet (0xAA prefix)
```
[0xAA][version][length_LE][CRC8]
[seq_LE_4B][0x00][0x00][src][dst][dsrc][ddst][cmdSet][cmdId][payload...]
[CRC16_LE]
```

### Encrypted Packet (0x5A5A prefix) — V2 Protocol
```
[0x5A5A][frame_type][payload_type][length_LE]
[AES-CBC encrypted inner packet]
[CRC16_LE]
```

### Encryption (V2 devices)
- ECDH key exchange (SECP160r1)
- AES-128-CBC with PKCS7 padding
- Session key: MD5(login_key[seed] + srand)
- IV: MD5(shared_key)

### Command Structure
Commands are addressed by `cmdSet:cmdId`:
- `02:01` — PD (Power Delivery) heartbeat
- `02:02` — BMS (Battery Management) heartbeat  
- `04:01` — Inverter heartbeat
- `05:01` — MPPT (Solar) heartbeat
- `04:31` — AC output toggle
- `02:31` — DC output toggle

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
