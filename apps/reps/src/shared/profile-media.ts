export const PROFILE_MAX_BYTES = 5 * 1024 * 1024;
export type ImageInfo = {
  mime: string;
  width: number;
  height: number;
  animated: boolean;
  frames: number;
};
const fail = () => {
  throw Error(
    "Choose a readable PNG, JPEG, WebP or GIF image. SVG, scripts and damaged files are not accepted.",
  );
};
// Bounded container parsing. We never execute image metadata or trust a file's
// extension, browser MIME, claimed dimensions or animation flag.
export function inspectProfileImage(
  bytes: Uint8Array,
  declared: string,
  filename: string,
): ImageInfo {
  if (!bytes.length || bytes.length > PROFILE_MAX_BYTES)
    throw Error("Images must be 5 MB or smaller.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, n: number) =>
    String.fromCharCode(...bytes.subarray(start, start + n));
  const u16 = (at: number, little = false) => {
    if (at + 2 > bytes.length) return fail();
    return view.getUint16(at, little);
  };
  const u32 = (at: number, little = false) => {
    if (at + 4 > bytes.length) return fail();
    return view.getUint32(at, little);
  };
  let info: ImageInfo;
  if (bytes[0] === 137 && text(1, 3) === "PNG" && text(4, 4) === "\r\n\x1a\n") {
    let at = 8,
      width = 0,
      height = 0,
      data = false,
      end = false,
      frames = 1;
    while (at + 12 <= bytes.length) {
      const n = u32(at),
        type = text(at + 4, 4);
      if (n > PROFILE_MAX_BYTES || at + n + 12 > bytes.length) return fail();
      // PNG CRC catches corruption, including header dimension tampering.
      let crc = 0xffffffff;
      for (let i = at + 4; i < at + 8 + n; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++)
          crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== u32(at + 8 + n)) return fail();
      if (type === "IHDR") {
        if (at !== 8 || n !== 13) return fail();
        width = u32(at + 8);
        height = u32(at + 12);
      }
      if (type === "acTL") frames = u32(at + 8);
      if (type === "IDAT") data = true;
      at += n + 12;
      if (type === "IEND") {
        end = true;
        break;
      }
    }
    if (!data || !end || at !== bytes.length) return fail();
    // APNG is intentionally rejected; the animated upload formats are GIF/WebP.
    if (frames !== 1) throw Error("For animation, use GIF or animated WebP.");
    info = { mime: "image/png", width, height, animated: false, frames: 1 };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2,
      width = 0,
      height = 0,
      scan = false,
      end = false;
    while (at < bytes.length) {
      if (bytes[at++] !== 0xff) return fail();
      while (bytes[at] === 0xff) at++;
      const marker = bytes[at++];
      if (marker === 0xd9) {
        end = true;
        break;
      }
      if (marker === 0x00 || marker === 0xd8) return fail();
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      const n = u16(at);
      if (n < 2 || at + n > bytes.length) return fail();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (n < 8) return fail();
        height = u16(at + 3);
        width = u16(at + 5);
      }
      at += n;
      if (marker === 0xda) {
        scan = true;
        while (at < bytes.length - 1) {
          if (
            bytes[at] === 0xff &&
            bytes[at + 1] !== 0x00 &&
            !(bytes[at + 1] >= 0xd0 && bytes[at + 1] <= 0xd7)
          )
            break;
          at += bytes[at] === 0xff ? 2 : 1;
        }
      }
    }
    if (!scan || !end || at !== bytes.length) return fail();
    info = { mime: "image/jpeg", width, height, animated: false, frames: 1 };
  } else if (["GIF87a", "GIF89a"].includes(text(0, 6))) {
    const width = u16(6, true),
      height = u16(8, true);
    let at = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0),
      frames = 0,
      end = false;
    const blocks = () => {
      while (at < bytes.length) {
        const n = bytes[at++];
        if (!n) return;
        if (at + n > bytes.length) return fail();
        at += n;
      }
      return fail();
    };
    while (at < bytes.length) {
      const tag = bytes[at++];
      if (tag === 0x3b) {
        end = true;
        break;
      }
      if (tag === 0x21) {
        at++;
        blocks();
      } else if (tag === 0x2c) {
        if (at + 9 > bytes.length) return fail();
        const w = u16(at + 4, true),
          h = u16(at + 6, true);
        if (
          w < 1 ||
          h < 1 ||
          u16(at, true) + w > width ||
          u16(at + 2, true) + h > height
        )
          return fail();
        const packed = bytes[at + 8];
        at += 9;
        if (packed & 128) at += 3 * 2 ** ((packed & 7) + 1);
        if (bytes[at] < 2 || bytes[at] > 8) return fail();
        at++;
        blocks();
        frames++;
      } else return fail();
    }
    if (!end || !frames || at !== bytes.length) return fail();
    info = { mime: "image/gif", width, height, animated: frames > 1, frames };
  } else if (
    text(0, 4) === "RIFF" &&
    text(8, 4) === "WEBP" &&
    u32(4, true) + 8 === bytes.length
  ) {
    let at = 12,
      width = 0,
      height = 0,
      frames = 0,
      animated = false,
      data = false;
    const u24 = (p: number) => {
      if (p + 3 > bytes.length) return fail();
      return bytes[p] + (bytes[p + 1] << 8) + (bytes[p + 2] << 16);
    };
    while (at + 8 <= bytes.length) {
      const tag = text(at, 4),
        n = u32(at + 4, true),
        p = at + 8;
      if (p + n > bytes.length || !n) return fail();
      if (tag === "VP8X") {
        if (n !== 10) return fail();
        animated = !!(bytes[p] & 2);
        width = u24(p + 4) + 1;
        height = u24(p + 7) + 1;
      } else if (tag === "VP8 ") {
        if (n < 10 || text(p + 3, 3) !== "\x9d\x01\x2a") return fail();
        width ||= u16(p + 6, true) & 0x3fff;
        height ||= u16(p + 8, true) & 0x3fff;
        data = true;
      } else if (tag === "VP8L") {
        if (n < 5 || bytes[p] !== 0x2f) return fail();
        const packed = u32(p + 1, true);
        width ||= (packed & 0x3fff) + 1;
        height ||= ((packed >>> 14) & 0x3fff) + 1;
        data = true;
      } else if (tag === "ANMF") {
        if (
          n < 24 ||
          !width ||
          !height ||
          u24(p) * 2 + u24(p + 6) + 1 > width ||
          u24(p + 3) * 2 + u24(p + 9) + 1 > height
        )
          return fail();
        let frameAt = p + 16,
          frameData = false;
        while (frameAt + 8 <= p + n) {
          const frameTag = text(frameAt, 4),
            frameSize = u32(frameAt + 4, true),
            q = frameAt + 8;
          if (
            q + frameSize > p + n ||
            !["ALPH", "VP8 ", "VP8L"].includes(frameTag)
          )
            return fail();
          if (frameTag === "VP8 ") {
            if (frameSize < 10 || text(q + 3, 3) !== "\x9d\x01\x2a")
              return fail();
            frameData = true;
          }
          if (frameTag === "VP8L") {
            if (frameSize < 5 || bytes[q] !== 0x2f) return fail();
            frameData = true;
          }
          frameAt = q + frameSize + (frameSize % 2);
        }
        if (frameAt !== p + n || !frameData) return fail();
        frames++;
        data = true;
      }
      at = p + n + (n % 2);
    }
    if (at !== bytes.length || !data || (animated && !frames)) return fail();
    info = {
      mime: "image/webp",
      width,
      height,
      animated: animated || frames > 0,
      frames: frames || 1,
    };
  } else return fail();
  const extensions: Record<string, RegExp> = {
    "image/png": /\.png$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/webp": /\.webp$/i,
    "image/gif": /\.gif$/i,
  };
  if (
    (declared && declared !== info.mime) ||
    !extensions[info.mime].test(filename)
  )
    return fail();
  if (
    info.width < 32 ||
    info.height < 32 ||
    info.width > 4096 ||
    info.height > 4096 ||
    info.width * info.height > 12000000
  )
    throw Error(
      "Use an image at least 32 × 32 pixels and no larger than 4096 × 4096 (12 megapixels).",
    );
  if (info.frames > 180 || info.width * info.height * info.frames > 100000000)
    throw Error(
      "This animation is too large. Use fewer frames or smaller dimensions.",
    );
  return info;
}
