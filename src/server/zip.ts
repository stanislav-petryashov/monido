// A minimal zip writer: stored entries (no compression), enough for the CSV export.
import { crc32 } from 'node:zlib'

interface ZipFile { name: string; data: Uint8Array }

/** 1980-01-01 00:00 in MS-DOS format: the entries carry no meaningful time. */
const DOS_TIME = 0
const DOS_DATE = (1 << 5) | 1
/** Bit 11: the names are UTF-8. */
const UTF8_NAMES = 0x0800
const VERSION = 20

/**
 * The files as one zip archive, each stored as is with its CRC-32 (`zlib.crc32`). No zip64: every file and the
 * whole archive stay under 4 GB, and there are fewer than 65 535 files.
 */
export function zipStore(files: ZipFile[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const size = file.data.byteLength

    const local = new Uint8Array(30 + name.length + size)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, VERSION, true)
    l.setUint16(6, UTF8_NAMES, true)
    l.setUint16(8, 0, true) // stored
    l.setUint16(10, DOS_TIME, true)
    l.setUint16(12, DOS_DATE, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, size, true)
    l.setUint32(22, size, true)
    l.setUint16(26, name.length, true)
    l.setUint16(28, 0, true)
    local.set(name, 30)
    local.set(file.data, 30 + name.length)

    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, VERSION, true)
    c.setUint16(6, VERSION, true)
    c.setUint16(8, UTF8_NAMES, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, DOS_TIME, true)
    c.setUint16(14, DOS_DATE, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, size, true)
    c.setUint32(24, size, true)
    c.setUint16(28, name.length, true)
    // extra, comment, disk, internal and external attributes stay 0
    c.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const directorySize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, directorySize, true)
  e.setUint32(16, offset, true)

  const out = new Uint8Array(offset + directorySize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length }
  return out
}
