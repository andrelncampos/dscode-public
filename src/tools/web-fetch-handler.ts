import type { ToolExecutionContext, ToolExecutionResult } from "./executor";

const MAX_OUTPUT_CHARS = 50000;
const DEFAULT_TIMEOUT_MS = 15000;

type WebFetchResult = {
  url: string;
  status: number;
  headers: Record<string, string>;
  content: string;
  truncated: boolean;
  content_type: string;
};

export async function handleWebFetchTool(
  args: Record<string, unknown>,
  _context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) {
    return {
      ok: false,
      name: "WebFetch",
      error: 'Missing required "url" string.',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      ok: false,
      name: "WebFetch",
      error: `Invalid URL: "${url}". Provide a valid http or https URL.`,
    };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      ok: false,
      name: "WebFetch",
      error: `Unsupported protocol "${parsedUrl.protocol}". Only http and https are allowed.`,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (isBlockedHostname(hostname)) {
    return {
      ok: false,
      name: "WebFetch",
      error: `Cannot fetch URL with hostname "${hostname}". Local and private addresses are not allowed.`,
    };
  }

  const method = typeof args.method === "string" ? args.method.trim().toUpperCase() : "GET";
  if (!isValidMethod(method)) {
    return {
      ok: false,
      name: "WebFetch",
      error: `Invalid HTTP method "${method}". Use GET, POST, PUT, DELETE, PATCH, or HEAD.`,
    };
  }

  const extraHeaders: Record<string, string> = {};
  if (args.headers) {
    if (typeof args.headers !== "object" || Array.isArray(args.headers)) {
      return {
        ok: false,
        name: "WebFetch",
        error: '"headers" must be a JSON object mapping header names to values.',
      };
    }
    for (const [key, value] of Object.entries(args.headers as Record<string, unknown>)) {
      if (typeof value === "string") {
        extraHeaders[key] = value;
      }
    }
  }

  const body = typeof args.body === "string" ? args.body : undefined;

  const maxChars =
    typeof args.maxChars === "number" && args.maxChars > 0
      ? Math.min(args.maxChars, MAX_OUTPUT_CHARS)
      : MAX_OUTPUT_CHARS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(parsedUrl.toString(), {
      method,
      headers: {
        Accept: "text/html, application/json, text/plain, application/xml, */*",
        "User-Agent": "DsCode/1.0",
        ...extraHeaders,
      },
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const rawBody = await response.text();
    const contentType = response.headers.get("content-type") ?? "unknown";
    const content = cleanContent(rawBody, contentType);

    const truncated = content.length > maxChars;
    const result: WebFetchResult = {
      url: parsedUrl.toString(),
      status: response.status,
      headers: responseHeaders,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
      content_type: contentType,
    };

    return {
      ok: true,
      name: "WebFetch",
      output: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        name: "WebFetch",
        error: `Request to "${url}" timed out after ${DEFAULT_TIMEOUT_MS / 1000} seconds.`,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      name: "WebFetch",
      error: `Failed to fetch "${url}": ${message}`,
    };
  }
}

function isBlockedHostname(hostname: string): boolean {
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"];
  if (blocked.includes(hostname)) return true;
  // Block link-local and private IP ranges
  if (/^169\.254\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^127\./.test(hostname)) return true;
  return false;
}

function isValidMethod(method: string): boolean {
  const validMethods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]);
  return validMethods.has(method.toUpperCase());
}

function cleanContent(raw: string, contentType: string): string {
  if (!raw) return "";

  // HTML: strip tags and decode entities
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return cleanHtml(raw);
  }

  // JSON: pass through (already readable)
  if (contentType.includes("application/json")) {
    return raw;
  }

  // XML: pass through
  if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
    return raw;
  }

  // Text: pass through
  if (contentType.includes("text/")) {
    return raw;
  }

  // Unknown: try to detect HTML, otherwise return as-is (truncated)
  if (raw.trim().startsWith("<") || raw.trim().startsWith("<!")) {
    return cleanHtml(raw);
  }

  return raw;
}

function cleanHtml(html: string): string {
  // Remove script and style elements with their content
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  // Replace block-level elements with newlines to preserve paragraph separation
  cleaned = cleaned.replace(/<\s*(br|hr)\s*\/?\s*>/gi, "\n");
  cleaned = cleaned.replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|article|section|header|footer|nav|main|aside)\s*>/gi, "\n");
  cleaned = cleaned.replace(
    /<\s*(p|div|h[1-6]|li|tr|td|th|article|section|header|footer|nav|main|aside)[^>]*>/gi,
    "\n"
  );

  // Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, num) => String.fromCharCode(Number(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Collapse whitespace
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/^[ \t]+/gm, "");
  cleaned = cleaned.trim();

  return cleaned;
}
