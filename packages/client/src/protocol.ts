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
 * [N bytes: data (JSON)]
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
  const dataJSON = JSON.stringify(data);
  const dataBytes = encodeUTF8(dataJSON);

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

  // Read data bytes and parse JSON
  const dataBytes = uint8View.slice(offset, offset + dataLength);
  const dataJSON = decodeUTF8(dataBytes);
  let data: any;
  try {
    data = JSON.parse(dataJSON);
  } catch (error) {
    data = {};
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
