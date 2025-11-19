/**
 * Binary WebSocket Protocol Implementation
 *
 * Implements the ComputeSDK binary protocol for WebSocket communication.
 * Provides 50-90% size reduction compared to JSON protocol.
 *
 * Binary Message Format:
 * [1 byte: message type]
 * [2 bytes: channel length (uint16, big-endian)]
 * [N bytes: channel string (UTF-8)]
 * [2 bytes: msg type length (uint16, big-endian)]
 * [N bytes: msg type string (UTF-8)]
 * [4 bytes: data length (uint32, big-endian)]
 * [N bytes: data (key-value encoded for complex objects, raw bytes for binary data)]
 *
 * Key-Value Encoding Format:
 * [2 bytes: num_fields (uint16, big-endian)]
 * For each field:
 *   [2 bytes: key_length (uint16, big-endian)]
 *   [N bytes: key string (UTF-8)]
 *   [1 byte: value_type (0x01=string, 0x02=number, 0x03=boolean, 0x04=bytes)]
 *   [4 bytes: value_length (uint32, big-endian)]
 *   [N bytes: value data]
 */

// ============================================================================
// Message Type Constants
// ============================================================================

export enum MessageType {
  Subscribe = 0x01,
  Unsubscribe = 0x02,
  Data = 0x03,
  Error = 0x04,
  Connected = 0x05,
}

/**
 * Value types for binary key-value encoding
 */
enum ValueType {
  String = 0x01,
  Number = 0x02,
  Boolean = 0x03,
  Bytes = 0x04,
}

// ============================================================================
// Binary Message Structure
// ============================================================================

export interface BinaryMessage {
  type: MessageType;
  channel: string;
  msgType: string;
  data: any;
}

// ============================================================================
// Key-Value Encoding Functions
// ============================================================================

// Reusable encoder/decoder instances for better performance
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Get the size in bytes of a value
 */
function getValueSize(value: any): number {
  if (typeof value === 'string') {
    return textEncoder.encode(value).length;
  } else if (typeof value === 'number') {
    return 8; // float64
  } else if (typeof value === 'boolean') {
    return 1;
  } else if (value instanceof Uint8Array) {
    return value.length;
  }
  return 0;
}

/**
 * Encode a key-value object to binary format
 * Format:
 * [2 bytes: num_fields (uint16, big-endian)]
 * For each field:
 *   [2 bytes: key_length (uint16, big-endian)]
 *   [N bytes: key string (UTF-8)]
 *   [1 byte: value_type]
 *   [4 bytes: value_length (uint32, big-endian)]
 *   [N bytes: value data]
 */
function encodeKeyValue(data: Record<string, any>): Uint8Array {

  // Calculate total size
  let totalSize = 2; // num_fields
  const fields = Object.entries(data);

  for (const [key, value] of fields) {
    const keyBytes = textEncoder.encode(key);
    totalSize += 2; // key_length
    totalSize += keyBytes.length; // key
    totalSize += 1; // value_type
    totalSize += 4; // value_length
    totalSize += getValueSize(value); // value
  }

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // Write number of fields
  view.setUint16(offset, fields.length, false); // big-endian
  offset += 2;

  // Write each field
  for (const [key, value] of fields) {
    // Write key
    const keyBytes = textEncoder.encode(key);
    view.setUint16(offset, keyBytes.length, false);
    offset += 2;
    buffer.set(keyBytes, offset);
    offset += keyBytes.length;

    // Write value type and data
    if (typeof value === 'string') {
      buffer[offset] = ValueType.String;
      offset++;
      const valueBytes = textEncoder.encode(value);
      view.setUint32(offset, valueBytes.length, false);
      offset += 4;
      buffer.set(valueBytes, offset);
      offset += valueBytes.length;
    } else if (typeof value === 'number') {
      buffer[offset] = ValueType.Number;
      offset++;
      view.setUint32(offset, 8, false); // float64 is 8 bytes
      offset += 4;
      view.setFloat64(offset, value, false); // big-endian
      offset += 8;
    } else if (typeof value === 'boolean') {
      buffer[offset] = ValueType.Boolean;
      offset++;
      view.setUint32(offset, 1, false);
      offset += 4;
      buffer[offset] = value ? 0x01 : 0x00;
      offset++;
    } else if (value instanceof Uint8Array) {
      buffer[offset] = ValueType.Bytes;
      offset++;
      view.setUint32(offset, value.length, false);
      offset += 4;
      buffer.set(value, offset);
      offset += value.length;
    } else {
      throw new Error(`Unsupported value type for key ${key}: ${typeof value}`);
    }
  }

  return buffer;
}

/**
 * Decode binary key-value format to object
 */
function decodeKeyValue(data: Uint8Array): Record<string, any> {
  if (data.length < 2) {
    throw new Error('Data too short for key-value encoding');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result: Record<string, any> = {};
  let offset = 0;

  // Read number of fields
  const numFields = view.getUint16(offset, false); // big-endian
  offset += 2;

  // Read each field
  for (let i = 0; i < numFields; i++) {
    // Read key
    if (offset + 2 > data.length) {
      throw new Error(`Invalid key length at field ${i}`);
    }
    const keyLen = view.getUint16(offset, false);
    offset += 2;

    if (offset + keyLen > data.length) {
      throw new Error(`Key data truncated at field ${i}`);
    }
    const key = textDecoder.decode(data.slice(offset, offset + keyLen));
    offset += keyLen;

    // Read value type
    if (offset + 1 > data.length) {
      throw new Error(`Invalid value type at field ${i}`);
    }
    const valueType = data[offset];
    offset++;

    // Read value length
    if (offset + 4 > data.length) {
      throw new Error(`Invalid value length at field ${i}`);
    }
    const valueLen = view.getUint32(offset, false);
    offset += 4;

    // Read value data
    if (offset + valueLen > data.length) {
      throw new Error(`Value data truncated at field ${i}`);
    }
    const valueData = data.slice(offset, offset + valueLen);
    offset += valueLen;

    // Decode value based on type
    switch (valueType) {
      case ValueType.String:
        result[key] = textDecoder.decode(valueData);
        break;

      case ValueType.Number:
        if (valueData.length !== 8) {
          throw new Error(`Invalid number length for field ${key}`);
        }
        const valueView = new DataView(valueData.buffer, valueData.byteOffset);
        result[key] = valueView.getFloat64(0, false); // big-endian
        break;

      case ValueType.Boolean:
        if (valueData.length !== 1) {
          throw new Error(`Invalid boolean length for field ${key}`);
        }
        result[key] = valueData[0] !== 0x00;
        break;

      case ValueType.Bytes:
        result[key] = valueData;
        break;

      default:
        throw new Error(`Unknown value type 0x${valueType.toString(16)} for field ${key}`);
    }
  }

  return result;
}

// ============================================================================
// Encoding Functions
// ============================================================================

/**
 * Encode a WebSocket message to binary format
 * @param message - The message object to encode
 * @returns ArrayBuffer containing the encoded binary message
 */
export function encodeBinaryMessage(message: any): ArrayBuffer {
  // Determine message type based on message structure
  let messageType: MessageType;
  let channel = '';
  let msgType = '';
  let data: any = {};

  if (message.type === 'subscribe') {
    messageType = MessageType.Subscribe;
    channel = message.channel || '';
    msgType = 'subscribe';
    data = {};
  } else if (message.type === 'unsubscribe') {
    messageType = MessageType.Unsubscribe;
    channel = message.channel || '';
    msgType = 'unsubscribe';
    data = {};
  } else {
    // Generic data message
    messageType = MessageType.Data;
    channel = message.channel || '';
    msgType = message.type || '';
    data = message.data || message;
  }

  // Convert strings to UTF-8 bytes
  const channelBytes = encodeUTF8(channel);
  const msgTypeBytes = encodeUTF8(msgType);

  // Encode data field (if present)
  let dataBytes: Uint8Array;
  if (data === undefined || data === null) {
    dataBytes = new Uint8Array(0);
  } else if (typeof data === 'string') {
    dataBytes = encodeUTF8(data);
  } else if (data instanceof Uint8Array) {
    dataBytes = data;
  } else if (typeof data === 'object') {
    // Complex object - use key-value encoding
    dataBytes = encodeKeyValue(data);
  } else {
    throw new Error(`Unsupported data type: ${typeof data}`);
  }

  // Calculate total size
  const totalSize = 1 + 2 + channelBytes.length + 2 + msgTypeBytes.length + 4 + dataBytes.length;

  // Create buffer and view
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  // Write message type (1 byte)
  view.setUint8(offset, messageType);
  offset += 1;

  // Write channel length (2 bytes, big-endian)
  view.setUint16(offset, channelBytes.length, false);
  offset += 2;

  // Write channel bytes
  const uint8View = new Uint8Array(buffer);
  uint8View.set(channelBytes, offset);
  offset += channelBytes.length;

  // Write msg type length (2 bytes, big-endian)
  view.setUint16(offset, msgTypeBytes.length, false);
  offset += 2;

  // Write msg type bytes
  uint8View.set(msgTypeBytes, offset);
  offset += msgTypeBytes.length;

  // Write data length (4 bytes, big-endian)
  view.setUint32(offset, dataBytes.length, false);
  offset += 4;

  // Write data bytes
  uint8View.set(dataBytes, offset);

  return buffer;
}

// ============================================================================
// Decoding Functions
// ============================================================================

/**
 * Decode a binary WebSocket message
 * @param buffer - The binary data to decode (ArrayBuffer or Uint8Array)
 * @returns Decoded message object
 */
export function decodeBinaryMessage(buffer: ArrayBuffer | Uint8Array): any {
  // Convert to ArrayBuffer if needed
  const arrayBuffer = buffer instanceof Uint8Array ? buffer.buffer : buffer;
  const view = new DataView(arrayBuffer);
  const uint8View = new Uint8Array(arrayBuffer);
  let offset = 0;

  // Read message type (1 byte)
  const messageType = view.getUint8(offset);
  offset += 1;

  // Read channel length (2 bytes, big-endian)
  const channelLength = view.getUint16(offset, false);
  offset += 2;

  // Read channel string
  const channelBytes = uint8View.slice(offset, offset + channelLength);
  const channel = decodeUTF8(channelBytes);
  offset += channelLength;

  // Read msg type length (2 bytes, big-endian)
  const msgTypeLength = view.getUint16(offset, false);
  offset += 2;

  // Read msg type string
  const msgTypeBytes = uint8View.slice(offset, offset + msgTypeLength);
  const msgType = decodeUTF8(msgTypeBytes);
  offset += msgTypeLength;

  // Read data length (4 bytes, big-endian)
  const dataLength = view.getUint32(offset, false);
  offset += 4;

  // Read data bytes
  const dataBytes = uint8View.slice(offset, offset + dataLength);

  // Try to decode as key-value for message types that expect structured data
  const shouldTryKeyValue = ['terminal:input', 'terminal:resize', 'file:changed', 'terminal:output', 'signal', 'test'].includes(msgType);

  let data: any;
  if (dataBytes.length === 0) {
    // Empty data
    data = {};
  } else if (shouldTryKeyValue) {
    try {
      // Try to decode as key-value
      data = decodeKeyValue(dataBytes);
    } catch {
      // If key-value decode fails, fall back to raw bytes
      data = dataBytes;
    }
  } else {
    // For other message types, keep as raw bytes
    data = dataBytes;
  }

  // Construct message object based on message type
  if (messageType === MessageType.Subscribe || messageType === MessageType.Unsubscribe) {
    return {
      type: msgType,
      channel: channel,
    };
  }

  // For data messages, construct the standard message format
  return {
    type: msgType,
    channel: channel,
    data: data,
  };
}

// ============================================================================
// UTF-8 Encoding/Decoding Helpers
// ============================================================================

/**
 * Encode a string to UTF-8 bytes
 * @param str - The string to encode
 * @returns Uint8Array containing UTF-8 encoded bytes
 */
function encodeUTF8(str: string): Uint8Array {
  // Use TextEncoder if available (modern browsers and Node.js)
  if (typeof TextEncoder !== 'undefined') {
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }

  // Fallback for older environments
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      // UTF-16 surrogate pair
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

/**
 * Decode UTF-8 bytes to a string
 * @param bytes - The UTF-8 encoded bytes
 * @returns Decoded string
 */
function decodeUTF8(bytes: Uint8Array): string {
  // Use TextDecoder if available (modern browsers and Node.js)
  if (typeof TextDecoder !== 'undefined') {
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  // Fallback for older environments
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) {
      str += String.fromCharCode(c);
    } else if (c < 0xe0) {
      str += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (c < 0xf0) {
      str += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      const c2 = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const c3 = c2 - 0x10000;
      str += String.fromCharCode(0xd800 | (c3 >> 10), 0xdc00 | (c3 & 0x3ff));
    }
  }
  return str;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if data is binary (ArrayBuffer, Uint8Array, or Blob)
 * @param data - The data to check
 * @returns True if data is binary
 */
export function isBinaryData(data: any): boolean {
  return data instanceof ArrayBuffer || data instanceof Uint8Array || data instanceof Blob;
}

/**
 * Convert Blob to ArrayBuffer
 * @param blob - The Blob to convert
 * @returns Promise that resolves to ArrayBuffer
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (blob.arrayBuffer) {
    return blob.arrayBuffer();
  }

  // Fallback for older browsers
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
