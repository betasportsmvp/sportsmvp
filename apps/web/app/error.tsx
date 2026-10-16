"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p className="muted">Please try again. If it keeps happening, sign out and back in.</p>
      <button type="button" onClick={reset}>Try again</button>
    </main>
  );
}
