import { crc32, deflateSync } from 'node:zlib';
/** A valid two-frame APNG, generated without external fixtures or an animation dependency. */
export function animatedPngFixture(): Buffer {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0);
  const control = (sequence: number) => {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(sequence, 0);
    b.writeUInt32BE(2, 4);
    b.writeUInt32BE(2, 8);
    b.writeUInt16BE(1, 20);
    b.writeUInt16BE(10, 22);
    return b;
  };
  const frame = (red: number, blue: number) =>
    deflateSync(
      Buffer.from([
        0,
        red,
        0,
        blue,
        255,
        red,
        0,
        blue,
        255,
        0,
        red,
        0,
        blue,
        255,
        red,
        0,
        blue,
        255,
      ]),
    );
  const sequence = Buffer.alloc(4);
  sequence.writeUInt32BE(2);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('acTL', actl),
    chunk('fcTL', control(0)),
    chunk('IDAT', frame(255, 0)),
    chunk('fcTL', control(1)),
    chunk('fdAT', Buffer.concat([sequence, frame(0, 255)])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
