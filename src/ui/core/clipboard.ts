import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ClipboardImage = {
  dataUrl: string;
  mimeType: string;
};

export type FilePathKind = "image" | "text" | "unsupported" | "not-found";

const PNG_MIME = "image/png";
const IMAGE_MIME_BY_EXT = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

/** Extensions that can be read as plain text and inserted into the buffer. */
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".log",
  ".json",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".scala",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".sass",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".env",
  ".gitignore",
  ".editorconfig",
  ".dockerignore",
  ".c",
  ".cpp",
  ".cc",
  ".cxx",
  ".h",
  ".hpp",
  ".hh",
  ".vue",
  ".svelte",
  ".astro",
  ".svg",
  ".prisma",
  ".tf",
  ".hcl",
  ".lua",
  ".r",
  ".php",
  ".makefile",
  ".cmake",
  ".patch",
  ".diff",
]);

/** Maximum file size for text files (100 KB). */
const MAX_TEXT_FILE_BYTES = 100_000;

function bufferToDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function isImageFilePath(value: string): boolean {
  return IMAGE_MIME_BY_EXT.has(path.extname(value.trim()).toLowerCase());
}

function mimeTypeForPath(value: string): string {
  return IMAGE_MIME_BY_EXT.get(path.extname(value.trim()).toLowerCase()) ?? PNG_MIME;
}

/**
 * Check whether a string looks like an absolute file path that exists on disk.
 * Handles Windows (`C:\\...`, `\\\\server\\...`) and Unix (`/...`) paths.
 */
function looksLikeAbsolutePath(value: string): boolean {
  const trimmed = value.trim();
  // Windows: drive letter + colon + backslash (e.g. C:\...)
  if (/^[A-Za-z]:[/\\]/.test(trimmed)) return true;
  // Windows UNC: \\server\share
  if (trimmed.startsWith("\\\\")) return true;
  // Unix: starts with /
  if (trimmed.startsWith("/")) return true;
  return false;
}

/**
 * Classify a file path: image, text, unsupported type, or file not found.
 */
function classifyFilePath(filePath: string): FilePathKind {
  if (!fs.existsSync(filePath)) return "not-found";
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return "not-found";
  }
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_MIME_BY_EXT.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return "unsupported";
}

/**
 * Try to read a text file from disk.
 * @returns The file content, or an error message string if something went wrong.
 */
function readTextFileContent(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_TEXT_FILE_BYTES) {
      const kb = Math.round(stat.size / 1024);
      return `[Arquivo muito grande para leitura automática: ${kb} KB (limite: ${MAX_TEXT_FILE_BYTES / 1000} KB). Use /image-upload para imagens.]`;
    }
    const buffer = fs.readFileSync(filePath, "utf8");
    if (buffer.length === 0) return "";
    return buffer;
  } catch {
    return "[Erro ao ler o arquivo.]";
  }
}

export type FilePathResult =
  | { kind: "image"; image: ClipboardImage }
  | { kind: "text"; content: string }
  | { kind: "unsupported"; message: string }
  | { kind: "not-found"; message: string };

/**
 * Detect and process a pasted string that looks like an absolute file path.
 *
 * Drag-and-drop of a file into Windows Terminal pastes the file path as text.
 * This function checks whether the pasted string is a file path, classifies
 * it, and returns the appropriate result.
 *
 * @returns A {@link FilePathResult} if the input is a file path, or `null`
 *          if it's regular text (should be handled as a normal paste).
 */
export function detectAndReadFilePath(input: string): FilePathResult | null {
  const trimmed = input.trim();
  if (!looksLikeAbsolutePath(trimmed)) return null;

  const kind = classifyFilePath(trimmed);
  switch (kind) {
    case "image": {
      const image = readImageFile(trimmed);
      if (!image) return { kind: "not-found", message: `Imagem não pôde ser lida: ${trimmed}` };
      return { kind: "image", image };
    }
    case "text": {
      const content = readTextFileContent(trimmed);
      return { kind: "text", content };
    }
    case "unsupported": {
      const ext = path.extname(trimmed).toLowerCase() || "sem extensão";
      return {
        kind: "unsupported",
        message: `Tipo de arquivo não suportado (${ext}). Formatos aceitos: imagens (.png, .jpg, .webp) e texto/código (.txt, .ts, .py, .json, ...).`,
      };
    }
    case "not-found": {
      return { kind: "not-found", message: `Arquivo não encontrado ou sem permissão de leitura: ${trimmed}` };
    }
  }
}

function tryRun(command: string, args: string[]): Buffer | null {
  try {
    const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout || result.stdout.length === 0) {
      return null;
    }
    return result.stdout;
  } catch {
    return null;
  }
}

function tryRunStatus(command: string, args: string[]): boolean {
  try {
    const result = spawnSync(command, args, { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function readImageFile(filePath: string): ClipboardImage | null {
  try {
    if (!isImageFilePath(filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    if (buffer.length === 0) {
      return null;
    }
    const mimeType = mimeTypeForPath(filePath);
    return { dataUrl: bufferToDataUrl(buffer, mimeType), mimeType };
  } catch {
    return null;
  }
}

function readMacClipboardImage(): ClipboardImage | null {
  const pngpaste = tryRun("pngpaste", ["-"]);
  if (pngpaste && pngpaste.length > 0) {
    return { dataUrl: bufferToDataUrl(pngpaste, PNG_MIME), mimeType: PNG_MIME };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-clipboard-"));
  const screenshotPath = path.join(tempDir, "clipboard.png");
  try {
    const saved = tryRunStatus("osascript", [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file "${screenshotPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ]);

    if (saved) {
      const image = readImageFile(screenshotPath);
      if (image) {
        return image;
      }
    }

    const fileUrl = tryRun("osascript", ["-e", "get POSIX path of (the clipboard as «class furl»)"]);
    const filePath = fileUrl?.toString("utf8").trim();
    if (filePath) {
      return readImageFile(filePath);
    }

    return null;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
}

export function readClipboardImage(): ClipboardImage | null {
  if (process.platform === "darwin") {
    return readMacClipboardImage();
  }

  if (process.platform === "linux") {
    const xclip = tryRun("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]);
    if (xclip && xclip.length > 0) {
      return { dataUrl: bufferToDataUrl(xclip, PNG_MIME), mimeType: PNG_MIME };
    }
    const wlPaste = tryRun("wl-paste", ["--type", "image/png"]);
    if (wlPaste && wlPaste.length > 0) {
      return { dataUrl: bufferToDataUrl(wlPaste, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }

  if (process.platform === "win32") {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "$img = [System.Windows.Forms.Clipboard]::GetImage();" +
      "if ($img) { $ms = New-Object System.IO.MemoryStream;" +
      "$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png);" +
      "[Console]::OpenStandardOutput().Write($ms.ToArray(), 0, $ms.Length); }";
    const out = tryRun("powershell", ["-NoProfile", "-STA", "-Command", script]);
    if (out && out.length > 0) {
      return { dataUrl: bufferToDataUrl(out, PNG_MIME), mimeType: PNG_MIME };
    }
    return null;
  }

  return null;
}

export async function readClipboardImageAsync(): Promise<ClipboardImage | null> {
  const { promise, resolve, reject } = Promise.withResolvers<ClipboardImage | null>();
  // Use setImmediate to avoid blocking the event loop
  setImmediate(() => {
    try {
      const result = readClipboardImage();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
  return promise;
}
