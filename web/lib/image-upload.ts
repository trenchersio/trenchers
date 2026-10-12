/**
 * Turns an uploaded picture into a small square image stored inside the coin itself (a data: URI), so a launcher
 * never needs a link or outside hosting. The coin contract accepts up to 2,048 characters for its image, so the
 * picture is cropped to a square and shrunk, trying sizes and qualities until it fits.
 */
export const MAX_IMAGE_CHARS = 2048;

export async function imageToDataUri(file: File, maxChars = MAX_IMAGE_CHARS): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("That file isn't an image. Use a PNG, JPG, GIF or WebP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB. Pick a smaller one.");
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("That image couldn't be opened. Try a PNG or JPG."); });
  const side = Math.min(bmp.width, bmp.height), sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  const formats = webp ? ["image/webp", "image/jpeg"] : ["image/jpeg"];
  for (const size of [128, 112, 96, 80, 72, 64, 56, 48, 40, 32]) {
    canvas.width = canvas.height = size;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#0B0D0C"; ctx.fillRect(0, 0, size, size); // transparent areas become the site's black, not white
    ctx.drawImage(bmp, sx, sy, side, side, 0, 0, size, size);
    for (const fmt of formats) for (const q of [0.85, 0.7, 0.55, 0.4, 0.3]) {
      const uri = canvas.toDataURL(fmt, q);
      if (uri.length <= maxChars) { bmp.close?.(); return uri; }
    }
  }
  bmp.close?.();
  throw new Error("That image is too detailed to fit. Try a simpler logo.");
}
