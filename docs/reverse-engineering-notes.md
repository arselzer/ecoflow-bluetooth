# EcoFlow BLE Reverse Engineering Notes

## Device Under Test
- **Model:** River 3 Plus
- **BLE Name:** EF-R3P50256
- **Serial:** R631ZE1AWH550256
- **Protocol:** Type 7 (ECDH SECP160r1 + AES-128-CBC)

## Key Discovery: Bind Command (0x35:85)

**The EcoFlow app pairing step can be bypassed entirely via BLE.**

The bind command was discovered by scanning cmdSet `0x35` after the ECDH handshake + session key derivation succeeded but auth failed with `NeedBindInstallFirst (0x04)`.

### Bind Command Details
- **cmdSet:** `0x35`
- **cmdId:** `0x85` (one below auth 0x86)
- **src:** `0x21`
- **dst:** `0x35`
- **dsrc:** `0x01`
- **ddst:** `0x01`
- **version:** `3`
- **Payload:** `MD5(user_id + serial_number)` encoded as uppercase hex ASCII (32 bytes)
  - Same format as auth (0x86) payload
  - user_id can be any fixed string (e.g., `"0000000000000000"`)
  - serial_number is the full device serial (e.g., `"R631ZE1AWH550256"`)

### Bind Response
- `0x00` = Success (user registered on device)
- `0x03` = Query status: not bound (when sent with empty payload)
- `0x04` = Already bound / rejected re-bind

### Discovery Evidence

**Query 0x35:85 (empty payload) — returns bind status:**
```
TX: buildPacket(0x21, 0x35, 0x35, 0x85, empty)
RX: [0xAA] v3 seq=3 35->21 cmd=35:85 (1B) payload=[03]  // not bound
```

**Bind 0x35:85 (with auth hash) — SUCCESS:**
```
TX: buildPacket(0x21, 0x35, 0x35, 0x85, "98E65E12DEAB6E2FF7127AA534180954")
RX: [0xAA] v3 seq=4 35->21 cmd=35:85 (1B) payload=[00]  // success!
```

**Immediately after bind, device floods telemetry:**
```
RX: [0xAA] v19 seq=47988 2->21 cmd=fe:15 (294B)  // telemetry data!
RX: [0xAA] v19 seq=47989 2->21 cmd=fe:15 (102B)
RX: [0xAA] v3  seq=0    35->21 cmd=01:52 (0B)     // RTC time request
RX: [0xAA] v19 seq=47990 2->21 cmd=fe:15 (116B)
RX: [0xAA] v3  seq=0    35->20 cmd=35:20 (8B)     // some status
RX: [0xAA] v19 seq=47996 2->21 cmd=fe:15 (294B)   // keeps streaming
```

## Complete Auth Flow (Type 7 — no EcoFlow app needed)

1. **ECDH Key Exchange** — generate SECP160r1 keypair, send `SimplePacketAssembler.encode([0x01, 0x00, pubkey])` via write characteristic
2. **Receive Device Public Key** — device responds with its pubkey in a simple frame, compute shared secret
3. **Derive Initial Keys** — `AES_key = shared_secret[:16]`, `IV = MD5(shared_secret)`
4. **Request Session Key** — send `SimplePacketAssembler.encode([0x02])`, device responds with encrypted `srand(16B) + seed(2B)`
5. **Derive Final Session Key** — `session_key = MD5(keydata[seed[0]*16 + (seed[1]-1)*256 ... +16] + srand)`
6. **Bind User (0x35:85)** — send `MD5(user_id + serial)` as uppercase hex ASCII via encrypted packet
7. **Query Auth Status (0x35:89)** — encrypted, empty payload
8. **Authenticate (0x35:86)** — send same hash as bind, encrypted
9. **Device starts streaming data** — `fe:15` telemetry packets

## Auth Error Codes (from Python AuthErrors)

| Code | Name | Description |
|------|------|-------------|
| 0x00 | Success | Auth/bind accepted |
| 0x01 | NeedRefreshToken | Re-login required |
| 0x02 | DeviceInternalError | Device error |
| 0x03 | DeviceAlreadyBound | Already bound to another user |
| 0x04 | NeedBindInstallFirst | No user bound — need to bind first |
| 0x05 | AppSendDataError | Data format error |
| 0x06 | WrongKey | User ID hash doesn't match |
| 0x07 | MaximumDevicesError | Too many bound devices |

## XOR Obfuscation Bug Discovery

Auth responses use v3 packets where XOR should NOT be applied. Telemetry uses v19 (0x13) packets where XOR IS applied. Applying XOR to v3 auth responses corrupted the error code:
- Raw payload: `0x04` (NeedBindInstallFirst)
- With XOR seq[0]=4: `0x04 ^ 0x04 = 0x00` (appeared as Success)
- With XOR seq[0]=2: `0x04 ^ 0x02 = 0x06` (appeared as WrongKey)

This caused inconsistent auth results that masked the real error.

## Telemetry Format (cmd=fe:15)

- **Version:** 0x13 (19)
- **XOR obfuscation:** Yes (seq[0] as XOR key)
- **src:** 0x02 (PD module)
- **cmdSet:** 0xfe
- **cmdId:** 0x15
- **Packet sizes:** 294B, 102B, 116B (sent as 3 fragments per cycle)
- **Encoding:** Likely protobuf (needs further analysis)
- **v19 trailer:** may end with `0xBBBB` (strip before parsing)

### Other Commands Observed

| src | cmdSet | cmdId | Direction | Description |
|-----|--------|-------|-----------|-------------|
| 0x35 | 0x01 | 0x52 | device->app | RTC time request (send time sync back) |
| 0x35 | 0x35 | 0x20 | device->app | Status/config (8B payload: `0102000000000000`) |
| 0x35 | 0x35 | 0x84 | app->device | Unbind? (returns 0x00 with empty payload) |
| 0x35 | 0x35 | 0x85 | app->device | Bind user |
| 0x35 | 0x35 | 0x86 | app->device | Authenticate user |
| 0x35 | 0x35 | 0x89 | app->device | Query auth status |

## River 3 Control Commands (Confirmed Working)

Config commands use protobuf `ConfigWrite` messages:
- **Packet format:** `Packet(src=0x20, dst=0x02, cmdSet=0xFE, cmdId=0x11, version=0x13)`
- **Payload:** Protobuf-encoded ConfigWrite message

### Protobuf Field Numbers (from pr705_pb2.py)

| Field # | Name | Type | Description |
|---------|------|------|-------------|
| 76 | cfg_ac_out_open | bool | AC output on/off — **CONFIRMED WORKING** |
| 20 | cfg_dc_out_open | bool | DC output on/off |
| 18 | cfg_dc_12v_out_open | bool | 12V car port on/off |
| 25 | cfg_xboost_en | bool | X-Boost on/off |
| 33 | cfg_max_chg_soc | uint32 | Max charge SOC (%) |
| 34 | cfg_min_dsg_soc | uint32 | Min discharge SOC (%) |
| 87 | cfg_plug_in_info_pv_dc_amp_max | uint32 | DC charge max amps |
| 11 | cfg_dc_standby_time | uint32 | DC standby timeout |
| 15 | cfg_hv_ac_out_open | bool | HV AC output |
| 16 | cfg_lv_ac_out_open | bool | LV AC output |
| 17 | cfg_ac_out_freq | uint32 | AC output frequency |
| 19 | cfg_usb_open | bool | USB ports on/off |
| 23 | cfg_ac_out_always_on | message | AC always-on config |

### Telemetry Protobuf Fields (cmd=fe:15, from live capture)

| Field # | Name | Confirmed Value | Description |
|---------|------|----------------|-------------|
| 8 | soc | 50 | Battery percentage |
| 17 | full_cap_mins | 1440 | Full capacity in minutes |
| 18 | remain_mins_1 | 300 | Remaining time 1 |
| 19 | remain_mins_2 | 720 | Remaining time 2 |
| 22 | watts_out_sum | 0 | Total output watts |
| 23 | output_count | 5 | Number of output ports |
| 25 | ac_enabled | 0/1 | AC output state — changes on command |
| 37 | watts_in_sum | 0 | Total input watts |
| 195 | dc_enabled | 1 | DC output state |
| 211 | lcd_soc | 50 | LCD displayed SOC |
| 212 | charge_watts | 0 | Charge power |
| 227 | bms_cycles | 230 | Battery cycle count |
| 242 | temperature | 26.0 | Temperature (float32, °C) |
| 243 | max_charge_soc | 100.0 | Max charge (float32) |
| 248 | full_cap_wh | 12800 | Full capacity Wh |
| 254 | total_out_kwh | 87 | Total output energy |
| 255 | total_in_kwh | 5939 | Total input energy |
| 258-261 | temp_sensor_1-4 | 25,26,25,25 | Temperature sensors (°C) |
| 262 | inv_temperature | 26.0 | Inverter temp (float32, °C) |
| 263 | bms_soh | 100.0 | Battery health (float32, %) |
| 270 | charge_limit | 100 | Charge limit % |
| 271 | discharge_limit | 0 | Discharge limit % |
| 359 | solar_watts | 80 | Solar input (W) |

### Important Protocol Notes

- **Serial number matters for auth:** The full 16-char serial from the device sticker (e.g., `R631ZE1AWH550256`) must be used. The BLE name (`EF-R3P50256`) is truncated and produces a wrong auth hash.
- **Bind persists across connections:** Once bound, the device remembers the user hash across power cycles. Reconnecting reuses the same bind.
- **Bind before auth:** The bind command (0x35:85) must be sent BEFORE authentication (0x35:86). Auth without bind returns `NeedBindInstallFirst (0x04)`.
- **XOR only for v19 packets:** v3 auth packets do NOT use XOR obfuscation. v19 (0x13) telemetry packets DO. Mixing this up corrupts auth error codes.
- **Packet replies keep connection alive:** Device disconnects if received packets are not echoed back with swapped src/dst.
- **watchAdvertisements() not available:** Chrome on some platforms doesn't support reading manufacturer data from BLE advertisements. Serial must be entered manually.

## BLE Connection Notes

- **GATT service:** `00000001-0000-1000-8000-00805f9b34fb`
- **Write char:** `00000002-0000-1000-8000-00805f9b34fb`
- **Notify char:** `00000003-0000-1000-8000-00805f9b34fb`
- **Manufacturer ID:** `0xB5B5`
- **EncPacket frame_type:** Must be `PROTOCOL (0x01)`, NOT `COMMAND (0x00)` for encrypted data
- **Write method:** Write-with-response for encrypted packets
- **Connection keepalive:** Reply to received packets (swap src/dst) to prevent disconnect
- **First GATT connect often fails** — retry after 1s
- **Device disconnects ~10s** after auth if no bind/successful auth
