## WebFetch

Fetches content from a URL (documentation pages, API responses, etc.) and returns it as text.

Usage:
- Use WebFetch when you need to read documentation, API references, or any web resource during a coding session.
- HTML content is automatically stripped of tags and converted to readable text. JSON and XML responses are returned as-is.
- Local and private network addresses (localhost, 127.0.0.1, 192.168.x.x, etc.) are blocked for security.
- Only http and https protocols are supported. 15-second timeout.
- Output is capped at 50,000 characters by default (configurable with `maxChars`).

Typical use cases:
- Read framework or library documentation
- Fetch API endpoint responses to understand data structures
- Inspect changelogs or release notes
- Retrieve configuration examples from public sources

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "description": "The URL to fetch (must be http or https)",
      "type": "string"
    },
    "method": {
      "description": "HTTP method to use (default: GET). Use GET for documentation, POST/PUT for APIs with a body.",
      "type": "string",
      "enum": ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]
    },
    "headers": {
      "description": "Optional JSON object with request headers (e.g., {\"Authorization\": \"Bearer token\"})",
      "type": "object"
    },
    "body": {
      "description": "Optional request body for POST/PUT/PATCH requests",
      "type": "string"
    },
    "maxChars": {
      "description": "Maximum characters to return (default: 50000). Useful for trimming large responses.",
      "type": "number"
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false
}
```
