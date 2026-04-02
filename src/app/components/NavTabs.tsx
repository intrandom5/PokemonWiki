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
    <div>
      {/* 몬스터볼 상단 빨간 띠 */}
      <div className="h-1.5 bg-gradient-to-r from-red-800 via-red-600 to-red-800" />
      {/* 몬스터볼 중앙 검은 띠 */}
      <div className="h-0.5 bg-black" />

      <nav className="flex justify-center gap-2 py-3 bg-zinc-900/80 backdrop-blur border-b border-zinc-800">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-6 py-2 rounded-lg font-semibold text-sm transition-all ${
                isActive
                  ? "bg-red-600 text-white shadow-lg shadow-red-900/40"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
