/** Strict MLS/TLS vector reader for draft-10 app_data_dictionary only.
 * KeyPackage/LeafNode framing is decoded by ts-mls, not this reader.
 */
class Reader {
  offset = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  take(length: number) {
    if (this.offset + length > this.bytes.length)
      throw new Error("Truncated component data");
    const data = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return data;
  }
  u16() {
    const data = this.take(2);
    return data[0] * 256 + data[1];
  }
  vector() {
    const first = this.take(1)[0];
    const prefix = first >>> 6;
    if (prefix === 3) throw new Error("Invalid MLS vector length");
    let length = first & 63;
    for (const byte of this.take((1 << prefix) - 1))
      length = length * 256 + byte;
    if ((prefix === 1 && length < 64) || (prefix === 2 && length < 16384))
      throw new Error("Noncanonical MLS vector length");
    return new Reader(this.take(length));
  }
  end() {
    if (this.offset !== this.bytes.length)
      throw new Error("Trailing component bytes");
  }
}

export function decodeDictionary(bytes: Uint8Array) {
  const reader = new Reader(bytes);
  const entries = reader.vector();
  reader.end();
  const result = new Map<number, Uint8Array>();
  let previous = -1;
  while (entries.offset < entries.bytes.length) {
    const id = entries.u16();
    if (id <= previous)
      throw new Error("Component ids must be sorted and unique");
    previous = id;
    result.set(id, entries.vector().bytes);
  }
  return result;
}

export function decodeComponentIds(bytes: Uint8Array) {
  const reader = new Reader(bytes);
  const entries = reader.vector();
  reader.end();
  const ids: number[] = [];
  while (entries.offset < entries.bytes.length) {
    const id = entries.u16();
    if (ids.length && id <= ids[ids.length - 1])
      throw new Error("Component support ids must be sorted and unique");
    ids.push(id);
  }
  return ids;
}
