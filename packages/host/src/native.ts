import { Buffer } from "node:buffer";

export function createNativeIo(onMessage: (msg: unknown) => void) {
  let buf = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const json = buf.subarray(4, 4 + len).toString("utf8");
      buf = buf.subarray(4 + len);
      try {
        onMessage(JSON.parse(json));
      } catch (error) {
        process.stderr.write(`native parse error: ${String(error)}\n`);
      }
    }
  });

  return {
    send(msg: unknown) {
      const json = Buffer.from(JSON.stringify(msg), "utf8");
      if (json.length > 1024 * 1024) {
        process.stderr.write(`native message too large: ${json.length}\n`);
        return;
      }
      const header = Buffer.alloc(4);
      header.writeUInt32LE(json.length, 0);
      process.stdout.write(header);
      process.stdout.write(json);
    },
  };
}
