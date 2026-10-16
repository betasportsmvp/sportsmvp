import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Not found</h1>
      <p className="muted">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <p><Link href="/groups">Go to your groups</Link></p>
    </main>
  );
}
