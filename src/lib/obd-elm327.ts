// Real ELM327 OBD-II client.
//
// Supports two transports the browser actually exposes:
//   1. Web Serial API (USB ELM327 cable + chipset on Chromium desktop)
//   2. Web Bluetooth API (BLE-based ELM327 clones — NOT classic SPP ELM327!)
//
// IMPORTANT REALITY CHECK:
//   * Most cheap "ELM327 Bluetooth" dongles use Bluetooth Classic SPP/RFCOMM,
//     which browsers cannot speak. Those will NOT pair from the web.
//     Only BLE variants (e.g. Vgate iCar Pro BLE, Veepeak BLE+) will work.
//   * Web Serial works on desktop Chrome/Edge/Opera. It does not exist on
//     iOS Safari, and on Android only via Chrome with a USB OTG cable.
//
// We implement standard ELM327 AT-command init then SAE J1979 mode 03
// (stored DTCs) and mode 07 (pending DTCs), then decode the bytes per
// SAE J2012.

export type Severity = "low" | "medium" | "high";

export interface DtcCode {
  code: string;       // e.g. P0420
  meaning: string;    // human-readable
  severity: Severity;
  system: string;     // Powertrain / Body / Chassis / Network
}

export type Transport = "serial" | "bluetooth";

export interface ObdConnection {
  transport: Transport;
  /** Free-text label of the device (port name, BLE name, etc.). */
  deviceLabel: string;
  /** Send a raw command (without trailing \r) and resolve with the response (without prompt). */
  send(cmd: string, timeoutMs?: number): Promise<string>;
  close(): Promise<void>;
}

export interface ScanResult {
  vin?: string;
  protocol?: string;
  voltage?: string;
  storedCodes: DtcCode[];
  pendingCodes: DtcCode[];
  raw: string[]; // raw AT log for audit
}

/* -------------------------------------------------------------------------- */
/*                          Capability detection                              */
/* -------------------------------------------------------------------------- */

export function isWebSerialSupported(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/* -------------------------------------------------------------------------- */
/*                              Serial transport                              */
/* -------------------------------------------------------------------------- */

export async function connectSerial(): Promise<ObdConnection> {
  if (!isWebSerialSupported()) {
    throw new Error(
      "Web Serial API is not available in this browser. Use Chrome/Edge on desktop with a USB ELM327 cable.",
    );
  }
  // @ts-expect-error - navigator.serial typings are not in default lib
  const port: any = await navigator.serial.requestPort();
  await port.open({ baudRate: 38400 });

  const decoder = new TextDecoderStream();
  const readableClosed = port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();

  const encoder = new TextEncoder();
  const writer = port.writable.getWriter();

  let buffer = "";
  let cancelled = false;

  const pump = (async () => {
    try {
      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) buffer += value;
      }
    } catch {
      /* ignore */
    }
  })();

  async function send(cmd: string, timeoutMs = 4000): Promise<string> {
    buffer = "";
    await writer.write(encoder.encode(cmd + "\r"));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (buffer.includes(">")) {
        const out = buffer.split(">")[0];
        return cleanResp(cmd, out);
      }
      await sleep(60);
    }
    throw new Error(`Timed out waiting for response to "${cmd}"`);
  }

  async function close() {
    cancelled = true;
    try { await writer.close(); } catch { /* */ }
    try { reader.cancel(); } catch { /* */ }
    try { await readableClosed.catch(() => {}); } catch { /* */ }
    try { await port.close(); } catch { /* */ }
    await pump.catch(() => {});
  }

  const info = port.getInfo?.() ?? {};
  const label =
    info.usbVendorId
      ? `USB ${info.usbVendorId.toString(16)}:${info.usbProductId?.toString(16)}`
      : "Serial port";

  return { transport: "serial", deviceLabel: label, send, close };
}

/* -------------------------------------------------------------------------- */
/*                            Bluetooth transport                             */
/* -------------------------------------------------------------------------- */

// Common UUIDs used by BLE ELM327 clones (Nordic UART-style services).
const BLE_CANDIDATES = [
  // Nordic UART
  { service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e", tx: "6e400002-b5a3-f393-e0a9-e50e24dcca9e", rx: "6e400003-b5a3-f393-e0a9-e50e24dcca9e" },
  // FFF0 family (very common on knockoff ELM327 BLE dongles)
  { service: "0000fff0-0000-1000-8000-00805f9b34fb", tx: "0000fff2-0000-1000-8000-00805f9b34fb", rx: "0000fff1-0000-1000-8000-00805f9b34fb" },
  // FFE0 family (HM-10 style)
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", tx: "0000ffe1-0000-1000-8000-00805f9b34fb", rx: "0000ffe1-0000-1000-8000-00805f9b34fb" },
];

export async function connectBluetooth(): Promise<ObdConnection> {
  if (!isWebBluetoothSupported()) {
    throw new Error(
      "Web Bluetooth is not available. Use Chrome/Edge on desktop or Android. iOS Safari does not support it.",
    );
  }
  // @ts-expect-error - navigator.bluetooth not in default lib
  const device: any = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_CANDIDATES.map((c) => c.service),
  });
  const server = await device.gatt!.connect();

  let txChar: any = null, rxChar: any = null;
  for (const cand of BLE_CANDIDATES) {
    try {
      const svc = await server.getPrimaryService(cand.service);
      txChar = await svc.getCharacteristic(cand.tx);
      rxChar = await svc.getCharacteristic(cand.rx);
      break;
    } catch { /* try next */ }
  }
  if (!txChar || !rxChar) {
    await server.disconnect();
    throw new Error("This Bluetooth device does not expose a known ELM327 BLE service. Most classic-Bluetooth ELM327 clones cannot be used from a browser.");
  }

  await rxChar.startNotifications();

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  rxChar.addEventListener("characteristicvaluechanged", (ev: any) => {
    const v = ev.target.value as DataView;
    buffer += decoder.decode(v);
  });

  async function send(cmd: string, timeoutMs = 4000): Promise<string> {
    buffer = "";
    const bytes = encoder.encode(cmd + "\r");
    // Many BLE ELM327 chunks max at 20 bytes per write
    for (let i = 0; i < bytes.length; i += 20) {
      await txChar.writeValueWithoutResponse(bytes.slice(i, i + 20));
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (buffer.includes(">")) {
        const out = buffer.split(">")[0];
        return cleanResp(cmd, out);
      }
      await sleep(60);
    }
    throw new Error(`Timed out waiting for response to "${cmd}"`);
  }

  async function close() {
    try { await rxChar.stopNotifications(); } catch { /* */ }
    try { server.disconnect(); } catch { /* */ }
  }

  return { transport: "bluetooth", deviceLabel: device.name ?? "BLE device", send, close };
}

/* -------------------------------------------------------------------------- */
/*                              Scan procedure                                */
/* -------------------------------------------------------------------------- */

export async function initAdapter(c: ObdConnection, log?: (s: string) => void): Promise<void> {
  // Standard ELM327 init sequence
  const seq = [
    "ATZ",     // reset
    "ATE0",    // echo off
    "ATL0",    // linefeeds off
    "ATS0",    // no spaces
    "ATH0",    // headers off
    "ATSP0",   // auto protocol
  ];
  for (const cmd of seq) {
    const r = await c.send(cmd, cmd === "ATZ" ? 6000 : 3000);
    log?.(`> ${cmd}\n${r}`);
  }
}

export async function readVoltage(c: ObdConnection): Promise<string | undefined> {
  try { return (await c.send("ATRV")).trim(); } catch { return undefined; }
}
export async function readProtocol(c: ObdConnection): Promise<string | undefined> {
  try { return (await c.send("ATDP")).trim(); } catch { return undefined; }
}
export async function readVIN(c: ObdConnection): Promise<string | undefined> {
  try {
    const r = await c.send("0902", 5000);
    // Parse multi-frame ISO15765 response, bytes after "49 02 01"
    const hex = r.replace(/\s|\r|\n|:/g, "").toUpperCase();
    const idx = hex.indexOf("490201");
    if (idx === -1) return undefined;
    const data = hex.slice(idx + 6);
    const bytes: number[] = [];
    for (let i = 0; i < data.length; i += 2) bytes.push(parseInt(data.slice(i, i + 2), 16));
    const vin = bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "")).join("").trim();
    return vin || undefined;
  } catch { return undefined; }
}

export async function readDtcs(c: ObdConnection, mode: "03" | "07"): Promise<DtcCode[]> {
  let resp: string;
  try { resp = await c.send(mode, 5000); } catch { return []; }
  // Strip whitespace & headers, keep only hex pairs
  const clean = resp.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!clean) return [];
  const expected = mode === "03" ? "43" : "47";
  const idx = clean.indexOf(expected);
  if (idx === -1) return [];
  let payload = clean.slice(idx + 2);
  // Some ECUs include count byte; if odd, drop a nibble.
  // Each DTC = 2 bytes = 4 hex chars
  const codes: DtcCode[] = [];
  for (let i = 0; i + 4 <= payload.length; i += 4) {
    const word = payload.slice(i, i + 4);
    if (word === "0000") continue;
    const decoded = decodeDtc(word);
    if (decoded) codes.push(decoded);
  }
  return codes;
}

export async function fullScan(
  c: ObdConnection,
  log?: (s: string) => void,
): Promise<ScanResult> {
  const raw: string[] = [];
  const cap = (s: string) => { raw.push(s); log?.(s); };

  await initAdapter(c, cap);
  const voltage = await readVoltage(c); if (voltage) cap(`Voltage: ${voltage}`);
  const protocol = await readProtocol(c); if (protocol) cap(`Protocol: ${protocol}`);
  const vin = await readVIN(c); if (vin) cap(`VIN: ${vin}`);
  const stored = await readDtcs(c, "03"); cap(`Stored DTCs: ${stored.length}`);
  const pending = await readDtcs(c, "07"); cap(`Pending DTCs: ${pending.length}`);

  return { voltage, protocol, vin, storedCodes: stored, pendingCodes: pending, raw };
}

/* -------------------------------------------------------------------------- */
/*                                DTC decoding                                */
/* -------------------------------------------------------------------------- */

function decodeDtc(hex4: string): DtcCode | null {
  if (hex4.length !== 4) return null;
  const b1 = parseInt(hex4.slice(0, 2), 16);
  const b2 = parseInt(hex4.slice(2, 4), 16);
  if (Number.isNaN(b1) || Number.isNaN(b2)) return null;
  const letterMap = ["P", "C", "B", "U"];
  const letter = letterMap[(b1 & 0xc0) >> 6];
  const d1 = (b1 & 0x30) >> 4;
  const d2 = b1 & 0x0f;
  const d3 = (b2 & 0xf0) >> 4;
  const d4 = b2 & 0x0f;
  const code = `${letter}${d1}${d2.toString(16).toUpperCase()}${d3.toString(16).toUpperCase()}${d4.toString(16).toUpperCase()}`;
  const known = KNOWN_CODES[code];
  return {
    code,
    meaning: known?.meaning ?? `Manufacturer-defined ${letter === "P" ? "powertrain" : letter === "C" ? "chassis" : letter === "B" ? "body" : "network"} code — consult vehicle service manual.`,
    severity: known?.severity ?? guessSeverity(letter),
    system: known?.system ?? systemFromLetter(letter),
  };
}

function systemFromLetter(l: string): string {
  return l === "P" ? "Powertrain" : l === "C" ? "Chassis" : l === "B" ? "Body" : "Network";
}
function guessSeverity(l: string): Severity {
  return l === "U" || l === "C" ? "high" : "medium";
}

// Common SAE-defined generic codes (subset). Extend freely.
const KNOWN_CODES: Record<string, Omit<DtcCode, "code">> = {
  P0100: { meaning: "Mass or Volume Air Flow Circuit Malfunction.", severity: "medium", system: "Fuel & Air" },
  P0101: { meaning: "MAF Sensor Range/Performance.", severity: "medium", system: "Fuel & Air" },
  P0128: { meaning: "Coolant Thermostat Temperature Below Regulating Temperature.", severity: "medium", system: "Cooling" },
  P0171: { meaning: "System Too Lean (Bank 1).", severity: "medium", system: "Fuel & Air" },
  P0172: { meaning: "System Too Rich (Bank 1).", severity: "medium", system: "Fuel & Air" },
  P0300: { meaning: "Random/Multiple Cylinder Misfire Detected.", severity: "high", system: "Ignition" },
  P0301: { meaning: "Cylinder 1 Misfire Detected.", severity: "high", system: "Ignition" },
  P0302: { meaning: "Cylinder 2 Misfire Detected.", severity: "high", system: "Ignition" },
  P0303: { meaning: "Cylinder 3 Misfire Detected.", severity: "high", system: "Ignition" },
  P0304: { meaning: "Cylinder 4 Misfire Detected.", severity: "high", system: "Ignition" },
  P0401: { meaning: "EGR Flow Insufficient.", severity: "medium", system: "Emissions" },
  P0420: { meaning: "Catalyst System Efficiency Below Threshold (Bank 1).", severity: "medium", system: "Emissions" },
  P0430: { meaning: "Catalyst System Efficiency Below Threshold (Bank 2).", severity: "medium", system: "Emissions" },
  P0442: { meaning: "EVAP System Small Leak Detected.", severity: "low", system: "Emissions" },
  P0455: { meaning: "EVAP System Large Leak — often a loose fuel cap.", severity: "low", system: "Emissions" },
  P0500: { meaning: "Vehicle Speed Sensor Malfunction.", severity: "medium", system: "Electrical" },
  P0507: { meaning: "Idle Air Control RPM Higher Than Expected.", severity: "low", system: "Fuel & Air" },
  P0606: { meaning: "ECM/PCM Processor Fault.", severity: "high", system: "Electrical" },
  P0700: { meaning: "Transmission Control System Malfunction.", severity: "high", system: "Transmission" },
  C1201: { meaning: "ABS Control System Malfunction.", severity: "high", system: "Brakes" },
  B1318: { meaning: "Battery Voltage Low.", severity: "medium", system: "Electrical" },
  U0100: { meaning: "Lost Communication With ECM/PCM.", severity: "high", system: "Network" },
};

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function cleanResp(cmd: string, raw: string): string {
  // strip the echoed command if present, plus the trailing prompt
  let r = raw.replace(/\r/g, "\n").trim();
  if (r.startsWith(cmd)) r = r.slice(cmd.length).trim();
  return r;
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
