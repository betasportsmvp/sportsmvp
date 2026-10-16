"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function GroupTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  const tabs = [
    { href: base, label: "Today" },
    { href: `${base}/calendar`, label: "Calendar" },
    { href: `${base}/members`, label: "Group" },
  ];
  return (
    <nav className="tabs" aria-label="Group sections">
      {tabs.map((t) => {
        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
