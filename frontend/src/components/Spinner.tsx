export default function Spinner({ size = 40 }: { size?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="spinner-ring"
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(2, size / 10),
      }}
    >
      <span className="sr-only">Loadingâ¦</span>
    </div>
  )
}

/*
  Styles live in index.css under .spinner-ring so they're
  shared across every Spinner instance without duplicating
  a <style> tag per mount.

  .spinner-ring {
    display: inline-block;
    border-radius: 9999px;
    border-style: solid;
    border-color: rgba(255,255,255,0.15);
    border-top-color: var(--color-accent, #7cc6ff);
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
*/
