/** #144: the app's own 404, reached when an invite code names no published event, a route is unknown, or a sign-in cannot be completed. */
export default function NotFound() {
  return (
    <div>
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
      </header>
      <main className="sheet">
        <div className="wrap" style={{ gridTemplateColumns: "minmax(0, 640px)", justifyContent: "center" }}>
          <div>
            <h1 className="title" data-testid="not-found-title">Page not found</h1>
            <p className="lead">Apologies. This page could not be found.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="btn primary" href="/demo" data-testid="not-found-demo">Try the demo</a>
              <a className="btn ghost" href="/" data-testid="not-found-home">Back to Tokuchu</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
