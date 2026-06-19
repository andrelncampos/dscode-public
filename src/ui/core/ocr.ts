import { createWorker } from "tesseract.js";

const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/bmp"]);

/**
 * Maximum characters of OCR text sent to the LLM.
 * Complex layouts (webpages, UIs) can produce thousands of noisy chars
 * that waste context-window tokens without helping the model.
 */
export const MAX_OCR_LENGTH = 2000;

/**
 * Truncate OCR text at a word boundary, appending "…" when truncated.
 */
function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const cutPoint = lastSpace > maxLength / 2 ? lastSpace : maxLength;
  return text.slice(0, cutPoint).trimEnd() + "…";
}

/**
 * Extract text from an image using local Tesseract.js OCR.
 *
 * The WASM binary (~30 MB) is downloaded on the first call and cached
 * in node_modules/.tesseract-cache thereafter.  Subsequent calls use
 * the cached binary without network access.
 *
 * The returned text is truncated at {@link MAX_OCR_LENGTH} characters
 * (word boundary) to avoid wasting context-window tokens on noisy
 * extractions from complex layouts.
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
    if (trimmed.length === 0) return null;
    return truncateAtWord(trimmed, MAX_OCR_LENGTH);
  } finally {
    await worker.terminate();
  }
}
