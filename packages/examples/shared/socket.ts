import { createConnection, createServer, type Socket } from "node:net";

function frame(payload: Uint8Array): Buffer {
  const output = Buffer.allocUnsafe(4 + payload.byteLength);

  output.writeUInt32BE(payload.byteLength, 0);
  output.set(payload, 4);
  return output;
}

function receiveFrame(socket: Socket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);

    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onEnd = (): void => {
      if (buffered.byteLength === 0) return;
      cleanup();
      reject(new Error("socket ended before a complete frame arrived"));
    };
    const onData = (chunk: Buffer): void => {
      buffered = buffered.byteLength === 0 ? chunk : Buffer.concat([buffered, chunk]);
      if (buffered.byteLength < 4) return;

      const length = buffered.readUInt32BE(0);
      if (buffered.byteLength < length + 4) return;

      const payload = buffered.subarray(4, length + 4);

      cleanup();
      resolve(new Uint8Array(payload));
    };

    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

export async function socketRoundTrip(
  payload: Uint8Array,
  transform: (value: Uint8Array) => Uint8Array
): Promise<Uint8Array> {
  const server = createServer(async (socket) => {
    try {
      socket.end(frame(transform(await receiveFrame(socket))));
    } catch (error) {
      socket.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("TCP server did not expose a port");

  const client = createConnection({ host: "127.0.0.1", port: address.port });

  try {
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    client.write(frame(payload));
    return await receiveFrame(client);
  } finally {
    client.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
