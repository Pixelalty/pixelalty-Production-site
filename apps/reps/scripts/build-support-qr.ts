import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const assets = [
  {
    file: "public/support/whatsapp-direct.png",
    url: "https://wa.me/12392870299?s=p",
  },
  {
    file: "public/support/whatsapp-updates.png",
    url: "https://whatsapp.com/channel/0029Vb9T6Y2DJ6GvZaXRnb2F",
  },
];

for (const asset of assets) {
  const target = resolve(asset.file);
  await mkdir(dirname(target), { recursive: true });
  await QRCode.toFile(target, asset.url, {
    errorCorrectionLevel: "H",
    margin: 3,
    width: 640,
    color: { dark: "#101722", light: "#ffffff" },
  });
  const png = PNG.sync.read(await readFile(target));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (decoded?.data !== asset.url)
    throw new Error(`QR verification failed for ${asset.file}`);
  console.log(`${asset.file}: ${decoded.data}`);
}
