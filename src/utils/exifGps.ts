/**
 * Minimal EXIF GPS extractor for JPEG data.
 * Parses TIFF headers and navigates IFD structures to extract GPS coordinates.
 */

interface RationalValue {
  numerator: number;
  denominator: number;
}

interface GPSData {
  lat: number;
  lng: number;
}

/**
 * Parse a rational value from buffer at given offset with specified byte order.
 * RATIONAL = two uint32s (numerator / denominator)
 */
function readRational(buffer: Buffer, offset: number, littleEndian: boolean): RationalValue {
  const numerator = littleEndian
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset);
  const denominator = littleEndian
    ? buffer.readUInt32LE(offset + 4)
    : buffer.readUInt32BE(offset + 4);
  return { numerator, denominator };
}

/**
 * Rational to decimal conversion with zero-denominator safety
 */
function rationalToDecimal(rational: RationalValue): number {
  if (rational.denominator === 0) return 0;
  return rational.numerator / rational.denominator;
}

/**
 * Read uint16 at offset with specified byte order
 */
function readUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

/**
 * Read uint32 at offset with specified byte order
 */
function readUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

/**
 * Read a string value (ASCII null-terminated) from buffer at offset
 */
function readString(buffer: Buffer, offset: number, length: number): string {
  return buffer.toString('ascii', offset, offset + length).replace(/\0/g, '');
}

/**
 * Parse an IFD (Image File Directory) and look for a specific tag.
 * Returns the tag data offset and value.
 */
interface TagEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
}

function parseIFD(
  buffer: Buffer,
  ifdOffset: number,
  littleEndian: boolean,
  searchTag: number
): TagEntry | null {
  if (ifdOffset + 2 > buffer.length) return null;

  const entryCount = readUInt16(buffer, ifdOffset, littleEndian);
  const startOffset = ifdOffset + 2;

  for (let i = 0; i < entryCount; i++) {
    const entryOffset = startOffset + i * 12;
    if (entryOffset + 12 > buffer.length) break;

    const tag = readUInt16(buffer, entryOffset, littleEndian);
    const type = readUInt16(buffer, entryOffset + 2, littleEndian);
    const count = readUInt32(buffer, entryOffset + 4, littleEndian);
    const valueOffset = readUInt32(buffer, entryOffset + 8, littleEndian);

    if (tag === searchTag) {
      return { tag, type, count, valueOffset };
    }
  }

  return null;
}

/**
 * Convert DMS (Degrees, Minutes, Seconds) to decimal degrees
 */
function dmsToDecimal(dms: [number, number, number]): number {
  const [degrees, minutes, seconds] = dms;
  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * Extract GPS coordinates from JPEG EXIF data.
 * Returns { lat, lng } or null if no valid GPS data found.
 */
export function extractGpsFromExif(buffer: Buffer): GPSData | null {
  try {
    // Find EXIF APP1 marker (0xFFE1)
    let exifStart = -1;
    for (let i = 2; i < buffer.length - 2; i++) {
      if (buffer[i] === 0xff && buffer[i + 1] === 0xe1) {
        exifStart = i + 2; // Skip the 0xFFE1 marker
        break;
      }
    }

    if (exifStart < 0) return null;

    // EXIF header: "Exif\0\0" (6 bytes)
    if (exifStart + 6 > buffer.length || buffer.toString('ascii', exifStart, exifStart + 4) !== 'Exif') {
      return null;
    }

    const tiffStart = exifStart + 6;
    if (tiffStart + 2 > buffer.length) return null;

    // Parse TIFF header to determine byte order
    const byteOrderMarker = buffer.toString('ascii', tiffStart, tiffStart + 2);
    const littleEndian = byteOrderMarker === 'II';

    if (byteOrderMarker !== 'II' && byteOrderMarker !== 'MM') {
      return null;
    }

    // Verify TIFF magic number (0x002A or 0x2A00)
    const magic = readUInt16(buffer, tiffStart + 2, littleEndian);
    if (magic !== 0x002a) return null;

    // Read offset to first IFD (IFD0)
    const ifd0Offset = tiffStart + readUInt32(buffer, tiffStart + 4, littleEndian);

    // Find GPS IFD pointer in IFD0 (tag 0x8825 = GPSInfo)
    const gpsIfdTag = parseIFD(buffer, ifd0Offset, littleEndian, 0x8825);
    if (!gpsIfdTag) return null;

    // GPS IFD pointer is stored at valueOffset
    const gpsIfdOffset = tiffStart + gpsIfdTag.valueOffset;

    // Now parse GPS IFD to extract coordinates
    let gpsLatRef: string | null = null;
    let gpsLatRationals: RationalValue[] = [];
    let gpsLngRef: string | null = null;
    let gpsLngRationals: RationalValue[] = [];

    // Parse GPS IFD
    if (gpsIfdOffset + 2 > buffer.length) return null;
    const gpsEntryCount = readUInt16(buffer, gpsIfdOffset, littleEndian);
    const gpsStartOffset = gpsIfdOffset + 2;

    for (let i = 0; i < gpsEntryCount; i++) {
      const entryOffset = gpsStartOffset + i * 12;
      if (entryOffset + 12 > buffer.length) break;

      const tag = readUInt16(buffer, entryOffset, littleEndian);
      const type = readUInt16(buffer, entryOffset + 2, littleEndian);
      const count = readUInt32(buffer, entryOffset + 4, littleEndian);
      const valueOffset = readUInt32(buffer, entryOffset + 8, littleEndian);

      // GPSLatitudeRef (0x0001) — N/S
      if (tag === 0x0001 && type === 2) { // ASCII
        gpsLatRef = readString(buffer, tiffStart + valueOffset, count);
      }
      // GPSLatitude (0x0002) — [degrees, minutes, seconds]
      else if (tag === 0x0002 && type === 5 && count === 3) { // RATIONAL
        gpsLatRationals = [];
        const dataOffset = tiffStart + valueOffset;
        for (let j = 0; j < 3; j++) {
          gpsLatRationals.push(readRational(buffer, dataOffset + j * 8, littleEndian));
        }
      }
      // GPSLongitudeRef (0x0003) — E/W
      else if (tag === 0x0003 && type === 2) { // ASCII
        gpsLngRef = readString(buffer, tiffStart + valueOffset, count);
      }
      // GPSLongitude (0x0004) — [degrees, minutes, seconds]
      else if (tag === 0x0004 && type === 5 && count === 3) { // RATIONAL
        gpsLngRationals = [];
        const dataOffset = tiffStart + valueOffset;
        for (let j = 0; j < 3; j++) {
          gpsLngRationals.push(readRational(buffer, dataOffset + j * 8, littleEndian));
        }
      }
    }

    // Convert to decimal degrees
    if (gpsLatRationals.length === 3 && gpsLngRationals.length === 3) {
      const latDms: [number, number, number] = [
        rationalToDecimal(gpsLatRationals[0]),
        rationalToDecimal(gpsLatRationals[1]),
        rationalToDecimal(gpsLatRationals[2]),
      ];
      const lngDms: [number, number, number] = [
        rationalToDecimal(gpsLngRationals[0]),
        rationalToDecimal(gpsLngRationals[1]),
        rationalToDecimal(gpsLngRationals[2]),
      ];

      let lat = dmsToDecimal(latDms);
      let lng = dmsToDecimal(lngDms);

      // Apply reference (N/S, E/W)
      if (gpsLatRef === 'S') lat = -lat;
      if (gpsLngRef === 'W') lng = -lng;

      return { lat, lng };
    }

    return null;
  } catch (error) {
    // Silently fail on any parse errors
    return null;
  }
}
