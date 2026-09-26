import { useEffect, useState } from "react";
import { api, stem } from "./notus";
export function NoteSearch({
  query,
  open,
}: {
  query: string;
  open: (path: string) => void;
}) {
  const [results, setResults] = useState<{ path: string; snippet: string }[]>(
    [],
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const requestId = "search:" + crypto.randomUUID();
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      void (async () => {
        try {
          const found = await api.search(query, requestId);
          if (!cancelled) setResults(found);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void api.cancel(requestId).catch(() => {});
    };
  }, [query]);
  return (
    <div className="note-search-results" aria-label="Search results">
      {busy && <p role="status">Searching notes…</p>}
      {!busy && query.trim().length < 2 && (
        <p className="muted">Type at least two characters.</p>
      )}
      {!busy && query.trim().length >= 2 && !results.length && (
        <p className="muted">No matching notes.</p>
      )}
      {results.map((result) => (
        <button
          key={result.path}
          title={result.path}
          onClick={() => open(result.path)}
        >
          <span>{stem(result.path)}</span>
          <small>{result.snippet}</small>
        </button>
      ))}
    </div>
  );
}
