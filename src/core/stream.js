// Splits a chunked stdout stream into JSON objects, one per line (NDJSON).
export function createLineParser(onObject, onBadLine = () => {}) {
  let buffer = '';
  return function push(chunk) {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onObject(JSON.parse(line));
      } catch {
        onBadLine(line);
      }
    }
  };
}
