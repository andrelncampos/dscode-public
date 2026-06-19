import { createWorker } from "tesseract.js";

const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp"]);

/**
 * Extract text from an image using local Tesseract.js OCR.
 *
 * The WASM binary (~30 MB) is downloaded on the first call and cached
 * in node_modules/.tesseract-cache thereafter.  Subsequent calls use
 * the cached binary without network access.
 *
 * @returns The recognized text, or `null` if OCR produced no text.
 * @throws  If the image MIME type is unsupported or OCR fails entirely.
 */
export async function recognizeTextFromDataUrl(dataUrl: string): Promise<string | null> {
  // Quick validation — only PNG, JPEG, WebP, and BMP are worth running OCR on.
  const mimeMatch = dataUrl.match(/^data:(image\/[a-z0-9+.]+);/);
  const mime = mimeMatch?.[1];
  if (!mime || !SUPPORTED_MIME_TYPES.has(mime)) {
    if (!mime) {
      throw new Error("Invalid data URL (no MIME type detected)");
    }
    throw new Error(`Unsupported image type for OCR: ${mime}`);
  }

  // Tesseract supports many languages; 'eng' covers the vast majority of
  // code / terminal / log screenshots the user is likely to paste.
  const worker = await createWorker("eng");

  try {
    const {
      data: { text },
    } = await worker.recognize(dataUrl);
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } finally {
    await worker.terminate();
  }
}
