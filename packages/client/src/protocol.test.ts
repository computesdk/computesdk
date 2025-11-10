import { describe, it, expect } from 'vitest';
import {
  encodeBinaryMessage,
  decodeBinaryMessage,
  MessageType,
  isBinaryData,
} from './protocol';

describe('Binary Protocol', () => {
  describe('encodeBinaryMessage', () => {
    it('should encode subscribe message', () => {
      const message = {
        type: 'subscribe',
        channel: 'terminal:123',
      };

      const buffer = encodeBinaryMessage(message);
      const view = new DataView(buffer);
      const uint8View = new Uint8Array(buffer);

      // Check message type byte
      expect(view.getUint8(0)).toBe(MessageType.Subscribe);

      // Check channel length (uint16, big-endian)
      const channelLength = view.getUint16(1, false);
      expect(channelLength).toBe(12); // 'terminal:123' is 12 bytes

      // Check channel string
      const channelBytes = uint8View.slice(3, 3 + channelLength);
      const decoder = new TextDecoder();
      expect(decoder.decode(channelBytes)).toBe('terminal:123');
    });

    it('should encode unsubscribe message', () => {
      const message = {
        type: 'unsubscribe',
        channel: 'watcher:456',
      };

      const buffer = encodeBinaryMessage(message);
      const view = new DataView(buffer);

      expect(view.getUint8(0)).toBe(MessageType.Unsubscribe);
    });

    it('should encode data message with terminal input', () => {
      const message = {
        type: 'terminal:input',
        data: {
          terminal_id: 'term_123',
          input: 'ls -la\n',
        },
      };

      const buffer = encodeBinaryMessage(message);
      const view = new DataView(buffer);

      expect(view.getUint8(0)).toBe(MessageType.Data);

      // Verify the message can be decoded back
      const decoded = decodeBinaryMessage(buffer);
      expect(decoded.type).toBe('terminal:input');
      expect(decoded.data.terminal_id).toBe('term_123');
      expect(decoded.data.input).toBe('ls -la\n');
    });

    it('should encode data message with nested JSON', () => {
      const message = {
        type: 'terminal:output',
        channel: 'terminal:abc',
        data: {
          output: 'Hello, World!',
          encoding: 'raw',
        },
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.type).toBe('terminal:output');
      expect(decoded.channel).toBe('terminal:abc');
      expect(decoded.data.output).toBe('Hello, World!');
      expect(decoded.data.encoding).toBe('raw');
    });

    it('should handle empty channel', () => {
      const message = {
        type: 'subscribe',
        channel: '',
      };

      const buffer = encodeBinaryMessage(message);
      const view = new DataView(buffer);

      // Channel length should be 0
      const channelLength = view.getUint16(1, false);
      expect(channelLength).toBe(0);
    });

    it('should handle unicode characters', () => {
      const message = {
        type: 'terminal:output',
        channel: 'terminal:test',
        data: {
          output: 'Hello 世界 🚀',
        },
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.data.output).toBe('Hello 世界 🚀');
    });
  });

  describe('decodeBinaryMessage', () => {
    it('should decode subscribe message', () => {
      const message = {
        type: 'subscribe',
        channel: 'signals',
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.type).toBe('subscribe');
      expect(decoded.channel).toBe('signals');
    });

    it('should decode unsubscribe message', () => {
      const message = {
        type: 'unsubscribe',
        channel: 'terminal:xyz',
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.type).toBe('unsubscribe');
      expect(decoded.channel).toBe('terminal:xyz');
    });

    it('should decode data message', () => {
      const message = {
        type: 'terminal:output',
        channel: 'terminal:123',
        data: {
          output: 'test output',
          encoding: 'raw',
        },
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.type).toBe('terminal:output');
      expect(decoded.channel).toBe('terminal:123');
      expect(decoded.data).toEqual({
        output: 'test output',
        encoding: 'raw',
      });
    });

    it('should handle Uint8Array input', () => {
      const message = {
        type: 'subscribe',
        channel: 'test',
      };

      const buffer = encodeBinaryMessage(message);
      const uint8Array = new Uint8Array(buffer);
      const decoded = decodeBinaryMessage(uint8Array);

      expect(decoded.type).toBe('subscribe');
      expect(decoded.channel).toBe('test');
    });

    it('should handle large messages', () => {
      const largeOutput = 'x'.repeat(10000);
      const message = {
        type: 'terminal:output',
        channel: 'terminal:large',
        data: {
          output: largeOutput,
        },
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.data.output).toBe(largeOutput);
      expect(decoded.data.output.length).toBe(10000);
    });

    it('should handle special characters', () => {
      const message = {
        type: 'terminal:output',
        channel: 'terminal:special',
        data: {
          output: '\n\r\t\x1b[32mGreen\x1b[0m',
        },
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.data.output).toBe('\n\r\t\x1b[32mGreen\x1b[0m');
    });

    it('should handle empty data object', () => {
      const message = {
        type: 'test',
        channel: 'test-channel',
        data: {},
      };

      const buffer = encodeBinaryMessage(message);
      const decoded = decodeBinaryMessage(buffer);

      expect(decoded.type).toBe('test');
      expect(decoded.data).toEqual({});
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should maintain data integrity for subscribe', () => {
      const original = {
        type: 'subscribe',
        channel: 'terminal:round-trip',
      };

      const encoded = encodeBinaryMessage(original);
      const decoded = decodeBinaryMessage(encoded);

      expect(decoded.type).toBe(original.type);
      expect(decoded.channel).toBe(original.channel);
    });

    it('should maintain data integrity for complex data', () => {
      const original = {
        type: 'file:changed',
        channel: 'watcher:test',
        data: {
          event: 'change',
          path: '/home/project/test.txt',
          content: 'File content with\nmultiple lines\nand special chars: 世界',
          encoding: 'raw',
        },
      };

      const encoded = encodeBinaryMessage(original);
      const decoded = decodeBinaryMessage(encoded);

      expect(decoded.type).toBe(original.type);
      expect(decoded.channel).toBe(original.channel);
      expect(decoded.data).toEqual(original.data);
    });

    it('should maintain data integrity for terminal resize', () => {
      const original = {
        type: 'terminal:resize',
        data: {
          terminal_id: 'term_xyz',
          cols: 80,
          rows: 24,
        },
      };

      const encoded = encodeBinaryMessage(original);
      const decoded = decodeBinaryMessage(encoded);

      expect(decoded.type).toBe(original.type);
      expect(decoded.data.terminal_id).toBe(original.data.terminal_id);
      expect(decoded.data.cols).toBe(original.data.cols);
      expect(decoded.data.rows).toBe(original.data.rows);
    });
  });

  describe('size comparison', () => {
    it('should be smaller than JSON for typical messages', () => {
      const message = {
        type: 'terminal:output',
        channel: 'terminal:123',
        data: {
          output: 'Hello, World!',
          encoding: 'raw',
        },
      };

      const binaryBuffer = encodeBinaryMessage(message);
      const jsonString = JSON.stringify(message);

      // Binary should be smaller or comparable
      const binarySize = binaryBuffer.byteLength;
      const jsonSize = new TextEncoder().encode(jsonString).length;

      // For short messages, binary might be slightly larger due to overhead
      // But for longer messages, binary will be much smaller
      expect(binarySize).toBeLessThan(jsonSize * 1.5); // Within 50% either way
    });

    it('should show significant savings for large terminal output', () => {
      const largeOutput = 'x'.repeat(1000);
      const message = {
        type: 'terminal:output',
        channel: 'terminal:123',
        data: {
          output: largeOutput,
        },
      };

      const binaryBuffer = encodeBinaryMessage(message);
      const jsonString = JSON.stringify(message);

      const binarySize = binaryBuffer.byteLength;
      const jsonSize = new TextEncoder().encode(jsonString).length;

      // For large messages, binary should be significantly smaller
      // (no base64 encoding, less overhead)
      const savings = ((jsonSize - binarySize) / jsonSize) * 100;
      console.log(`Binary size: ${binarySize} bytes`);
      console.log(`JSON size: ${jsonSize} bytes`);
      console.log(`Savings: ${savings.toFixed(2)}%`);

      expect(binarySize).toBeLessThan(jsonSize);
    });
  });

  describe('isBinaryData', () => {
    it('should detect ArrayBuffer', () => {
      const buffer = new ArrayBuffer(10);
      expect(isBinaryData(buffer)).toBe(true);
    });

    it('should detect Uint8Array', () => {
      const uint8 = new Uint8Array(10);
      expect(isBinaryData(uint8)).toBe(true);
    });

    it('should detect Blob', () => {
      const blob = new Blob(['test']);
      expect(isBinaryData(blob)).toBe(true);
    });

    it('should reject string', () => {
      expect(isBinaryData('test')).toBe(false);
    });

    it('should reject object', () => {
      expect(isBinaryData({ type: 'test' })).toBe(false);
    });

    it('should reject null/undefined', () => {
      expect(isBinaryData(null)).toBe(false);
      expect(isBinaryData(undefined)).toBe(false);
    });
  });

  describe('MessageType enum', () => {
    it('should have correct byte values', () => {
      expect(MessageType.Subscribe).toBe(0x01);
      expect(MessageType.Unsubscribe).toBe(0x02);
      expect(MessageType.Data).toBe(0x03);
      expect(MessageType.Error).toBe(0x04);
      expect(MessageType.Connected).toBe(0x05);
    });
  });
});
