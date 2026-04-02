"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NavTabs() {
  const pathname = usePathname();

  const tabs = [
    { href: "/", label: "포켓몬 위키" },
    { href: "/entry", label: "엔트리 꾸리기" },
  ];

  return (
    <nav className="flex justify-center gap-2 pt-6 pb-2">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-6 py-2 rounded-xl font-semibold text-sm transition-all ${
              isActive
                ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg"
                : "bg-slate-800/80 text-slate-400 border border-slate-600 hover:border-amber-500 hover:text-amber-400"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
