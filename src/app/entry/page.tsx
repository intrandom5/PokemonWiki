"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

const TYPES = [
  "노말", "불꽃", "물", "풀", "전기", "얼음",
  "격투", "독", "땅", "비행", "에스퍼", "벌레",
  "바위", "고스트", "드래곤", "악", "강철", "페어리"
];

const GENERATIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface Pokemon {
  id: number;
  national_dex: number;
  name_ko: string;
  form_name: string;
  generation: number;
  image_url: string;
  types: string;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ChartPokemon {
  id: number;
  name_ko: string;
  image_url: string;
  types: string[];
  effectiveness: Record<string, number>;
  offensiveEffectiveness: Record<string, number>;
}

const MAX_ENTRY = 6;

function effectivenessCell(val: number) {
  if (val === 4)   return { label: "4×", bg: "bg-red-600 text-white font-bold" };
  if (val === 2)   return { label: "2×", bg: "bg-orange-500 text-white font-semibold" };
  if (val === 0.5) return { label: "½", bg: "bg-teal-600 text-white" };
  if (val === 0.25)return { label: "¼", bg: "bg-blue-600 text-white" };
  if (val === 0)   return { label: "0", bg: "bg-slate-700 text-slate-400" };
  return { label: "—", bg: "bg-transparent text-slate-700" };
}

export default function EntryPage() {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [page, setPage] = useState(1);
  const [nameSearch, setNameSearch] = useState("");
  const [selectedGenerations, setSelectedGenerations] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalOnly, setFinalOnly] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [entry, setEntry] = useState<Pokemon[]>([]);
  const [chart, setChart] = useState<ChartPokemon[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [chartTab, setChartTab] = useState<"defense" | "offense">("defense");

  const loadPokemon = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "60");
      if (nameSearch) params.set("name", nameSearch);
      for (const gen of selectedGenerations)
        params.append("generation", gen.toString());
      for (const type of selectedTypes)
        params.append("type", type);
      if (finalOnly) params.set("final_only", "1");

      const res = await fetch(`/api/pokemon?${params}`);
      const json = await res.json();
      setPokemon(json.data);
      setPagination(json.pagination);
    } finally {
      setLoading(false);
    }
  }, [page, nameSearch, selectedGenerations, selectedTypes, finalOnly]);

  useEffect(() => {
    loadPokemon();
  }, [loadPokemon]);

  // 엔트리 변경 시 상성 차트 갱신
  useEffect(() => {
    if (entry.length === 0) {
      setChart([]);
      return;
    }
    const params = new URLSearchParams();
    for (const p of entry) params.append("id", p.id.toString());
    fetch(`/api/type-chart?${params}`)
      .then(r => r.json())
      .then(data => setChart(data.pokemon ?? []));
  }, [entry]);

  const handleGenerationChange = (gen: number) => {
    setPage(1);
    setSelectedGenerations((prev) =>
      prev.includes(gen) ? prev.filter((g) => g !== gen) : [...prev, gen]
    );
  };

  const handleTypeChange = (type: string) => {
    setPage(1);
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleRandom = async () => {
    const slots = MAX_ENTRY - entry.length;
    if (slots <= 0) return;
    setRandomLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "9999");
      params.set("page", "1");
      if (nameSearch) params.set("name", nameSearch);
      for (const gen of selectedGenerations) params.append("generation", gen.toString());
      for (const type of selectedTypes) params.append("type", type);
      if (finalOnly) params.set("final_only", "1");

      const res = await fetch(`/api/pokemon?${params}`);
      const json = await res.json();
      const pool: Pokemon[] = (json.data as Pokemon[]).filter(
        (p) => !entry.some((e) => e.id === p.id)
      );

      // Fisher-Yates 셔플 후 앞에서 slots개 추출
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const picked = pool.slice(0, slots);
      setEntry((prev) => [...prev, ...picked]);
    } finally {
      setRandomLoading(false);
    }
  };

  const addToEntry = (p: Pokemon) => {
    if (entry.length >= MAX_ENTRY) return;
    if (entry.some((e) => e.id === p.id)) return;
    setEntry((prev) => [...prev, p]);
  };

  const removeFromEntry = (id: number) => {
    setEntry((prev) => prev.filter((p) => p.id !== id));
  };

  const getTypes = (typesStr: string): string[] => {
    try {
      return JSON.parse(typesStr);
    } catch {
      return typesStr ? typesStr.split(",") : [];
    }
  };

  // 타입별 파티 공격 커버리지 (해당 타입 상대로 몇 마리가 약점을 찌를 수 있는지)
  const offensiveSummary = (defendingType: string) => {
    if (chart.length === 0) return null;
    let superEffective = 0;
    for (const p of chart) {
      if ((p.offensiveEffectiveness[defendingType] ?? 1) >= 2) superEffective++;
    }
    return superEffective;
  };

  // 타입별 파티 취약도 집계 (저항/무효 포켓몬이 있으면 보완된 것으로 처리)
  const partySummary = (attackType: string) => {
    if (chart.length === 0) return null;
    let weak = 0, resist = 0, immune = 0;
    for (const p of chart) {
      const v = p.effectiveness[attackType] ?? 1;
      if (v >= 2) weak++;
      else if (v === 0) immune++;
      else if (v < 1) resist++;
    }
    // 저항하거나 무효인 포켓몬이 한 마리라도 있으면 약점 아님
    const covered = resist > 0 || immune > 0;
    return { weak, resist, immune, covered };
  };

  return (
    <main className="min-h-screen pb-20">
      {/* 헤더 */}
      <header className="text-center py-10">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 bg-clip-text text-transparent mb-2">
          엔트리 꾸리기
        </h1>
        <p className="text-slate-400">포켓몬을 최대 6마리까지 선택해 팀을 구성하세요</p>
      </header>

      {/* 엔트리 슬롯 */}
      <section className="max-w-3xl mx-auto px-4 mb-6">
        <div className="bg-slate-800/60 backdrop-blur border border-slate-600 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold text-lg">
              내 엔트리
              <span className="ml-2 text-slate-400 text-sm font-normal">
                ({entry.length}/{MAX_ENTRY})
              </span>
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end gap-0.5">
                <button
                  onClick={handleRandom}
                  disabled={entry.length >= MAX_ENTRY || randomLoading}
                  className="px-4 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-white text-sm font-semibold transition-all"
                >
                  {randomLoading ? "선택 중..." : "랜덤 선택"}
                </button>
                <span className="text-slate-500 text-xs">현재 필터 내에서 랜덤으로 선택됩니다</span>
              </div>
              {entry.length > 0 && (
                <button
                  onClick={() => setEntry([])}
                  className="text-xs text-slate-400 hover:text-red-400 transition-colors"
                >
                  전체 제거
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-6 gap-3">
            {Array.from({ length: MAX_ENTRY }).map((_, i) => {
              const p = entry[i];
              return (
                <div
                  key={i}
                  className={`aspect-square rounded-xl flex flex-col items-center justify-center relative border-2 transition-all ${
                    p
                      ? "border-amber-500/60 bg-slate-700/60"
                      : "border-slate-600/50 border-dashed bg-slate-800/40"
                  }`}
                >
                  {p ? (
                    <>
                      <Image
                        src={p.image_url}
                        alt={p.name_ko}
                        width={56}
                        height={56}
                        className="object-contain"
                        unoptimized
                      />
                      <span className="text-xs text-slate-300 text-center leading-tight px-1 truncate w-full text-center">
                        {p.name_ko}
                      </span>
                      <button
                        onClick={() => removeFromEntry(p.id)}
                        className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500/80 hover:bg-red-500 text-white text-xs flex items-center justify-center leading-none"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="text-slate-600 text-2xl">+</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 타입 상성 표 */}
      {chart.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 mb-8">
          <div className="bg-slate-800/60 backdrop-blur border border-slate-600 rounded-2xl p-5">
            {/* 헤더: 탭 + 더보기 */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex gap-1">
                {([
                  { key: "defense", label: "방어 상성" },
                  { key: "offense", label: "공격 상성" },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setChartTab(key)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                      chartTab === key
                        ? "bg-amber-500 text-white"
                        : "bg-slate-700 text-slate-400 border border-slate-600 hover:text-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowDetails((v) => !v)}
                className="text-xs px-3 py-1 rounded-lg bg-slate-700 text-slate-300 hover:text-white hover:bg-slate-600 border border-slate-600 transition-all"
              >
                {showDetails ? "개별 상성 접기 ▲" : "개별 상성 보기 ▼"}
              </button>
            </div>

            <p className="text-slate-400 text-xs mb-4">
              {chartTab === "defense"
                ? "상대가 해당 타입 기술을 사용했을 때 내 파티가 받는 배율. 저항/무효 포켓몬이 한 마리라도 있으면 보완된 것으로 처리합니다."
                : "내 파티가 STAB으로 해당 타입 상대에게 줄 수 있는 최대 배율. 한 마리라도 약점을 찌를 수 있으면 커버 가능으로 표시합니다."}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse" style={{ minWidth: "900px" }}>
                <thead>
                  <tr>
                    <th className="text-left text-slate-400 font-normal py-2 pr-3 w-24 sticky left-0 bg-slate-800/90">
                      {showDetails ? "포켓몬" : ""}
                    </th>
                    {TYPES.map((t) => (
                      <th key={t} className="px-1 py-2 text-center">
                        <span className={`type-${t} inline-block px-1.5 py-0.5 rounded text-xs font-medium`}>
                          {t}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {showDetails && chart.map((p) => (
                    <tr key={p.id} className="border-t border-slate-700/50">
                      <td className="py-2 pr-3 sticky left-0 bg-slate-800/90">
                        <div className="flex items-center gap-1.5">
                          <Image
                            src={p.image_url}
                            alt={p.name_ko}
                            width={28}
                            height={28}
                            className="object-contain flex-shrink-0"
                            unoptimized
                          />
                          <span className="text-white text-xs truncate">{p.name_ko}</span>
                        </div>
                      </td>
                      {TYPES.map((t) => {
                        const val = chartTab === "defense"
                          ? (p.effectiveness[t] ?? 1)
                          : (p.offensiveEffectiveness[t] ?? 1);
                        const { label, bg } = effectivenessCell(val);
                        return (
                          <td key={t} className="px-1 py-2 text-center">
                            <span className={`inline-block w-7 h-6 leading-6 rounded text-xs ${bg}`}>
                              {label}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* 요약 행 */}
                  <tr className={showDetails ? "border-t-2 border-slate-500" : ""}>
                    <td className="py-2 pr-3 sticky left-0 bg-slate-800/90">
                      <span className="text-slate-300 text-xs font-semibold">
                        {chartTab === "defense" ? "파티 취약도" : "파티 커버리지"}
                      </span>
                    </td>
                    {TYPES.map((t) => {
                      let display: React.ReactNode = null;
                      if (chartTab === "defense") {
                        const s = partySummary(t);
                        if (!s) return <td key={t} />;
                        const { weak, covered } = s;
                        if (weak >= 1 && !covered) {
                          display = (
                            <span className={`inline-block w-8 h-6 leading-6 rounded text-xs font-bold ${
                              weak >= 3 ? "bg-red-600 text-white" : weak === 2 ? "bg-orange-500 text-white" : "bg-yellow-600 text-white"
                            }`}>
                              {weak}마리
                            </span>
                          );
                        } else {
                          display = <span className="text-slate-600 text-xs">—</span>;
                        }
                      } else {
                        const count = offensiveSummary(t);
                        if (count === null) return <td key={t} />;
                        if (count >= 1) {
                          display = (
                            <span className={`inline-block w-8 h-6 leading-6 rounded text-xs font-bold ${
                              count >= 3 ? "bg-emerald-500 text-white" : count === 2 ? "bg-teal-600 text-white" : "bg-teal-800 text-white"
                            }`}>
                              {count}마리
                            </span>
                          );
                        } else {
                          display = <span className="text-slate-600 text-xs">—</span>;
                        }
                      }
                      return (
                        <td key={t} className="px-1 py-2 text-center">
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-slate-700">
              {showDetails && (
                <>
                  <span className="text-slate-400 text-xs self-center">배율:</span>
                  {[
                    { label: "4×", bg: "bg-red-600", text: "4배" },
                    { label: "2×", bg: "bg-orange-500", text: "2배" },
                    { label: "½",  bg: "bg-teal-600", text: "½배" },
                    { label: "¼",  bg: "bg-blue-600", text: "¼배" },
                    { label: "0",  bg: "bg-slate-700", text: "무효" },
                  ].map(({ label, bg, text }) => (
                    <div key={label} className="flex items-center gap-1">
                      <span className={`inline-block w-6 h-5 leading-5 rounded text-xs text-center text-white ${bg}`}>{label}</span>
                      <span className="text-slate-400 text-xs">{text}</span>
                    </div>
                  ))}
                  <span className="text-slate-600 text-xs self-center mx-1">|</span>
                </>
              )}
              {chartTab === "defense" ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 text-xs">파티 취약도 숫자 = 저항/무효 포켓몬을 제외하고 남은 약점 포켓몬 수</span>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: "3+", bg: "bg-red-600" },
                      { label: "2",  bg: "bg-orange-500" },
                      { label: "1",  bg: "bg-yellow-600" },
                    ].map(({ label, bg }) => (
                      <span key={label} className={`inline-block px-1.5 h-5 leading-5 rounded text-xs text-center text-white ${bg}`}>{label}</span>
                    ))}
                    <span className="text-slate-400 text-xs">숫자가 클수록 취약</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 text-xs">파티 커버리지 숫자 = STAB으로 약점을 찌를 수 있는 포켓몬 수</span>
                  <div className="flex items-center gap-1.5">
                    {[
                      { label: "3+", bg: "bg-emerald-500" },
                      { label: "2",  bg: "bg-teal-600" },
                      { label: "1",  bg: "bg-teal-800" },
                    ].map(({ label, bg }) => (
                      <span key={label} className={`inline-block px-1.5 h-5 leading-5 rounded text-xs text-center text-white ${bg}`}>{label}</span>
                    ))}
                    <span className="text-slate-400 text-xs">숫자가 클수록 커버 잘 됨</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 검색 및 필터 */}
      <section className="max-w-5xl mx-auto px-4 mb-6 space-y-4">
        {/* 이름 검색 + 최종 진화체 옵션 */}
        <div className="flex gap-2">
          <input
            type="text"
            value={nameSearch}
            onChange={(e) => {
              setNameSearch(e.target.value);
              setPage(1);
            }}
            placeholder="포켓몬 이름으로 검색..."
            className="flex-1 px-4 py-3 bg-slate-800/80 border border-slate-600 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
          />
          <label className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border border-slate-600 rounded-xl cursor-pointer hover:border-amber-500/60 transition-all select-none">
            <input
              type="checkbox"
              checked={finalOnly}
              onChange={(e) => { setFinalOnly(e.target.checked); setPage(1); }}
              className="w-4 h-4 accent-amber-500 cursor-pointer"
            />
            <span className="text-slate-300 text-sm whitespace-nowrap">최종 진화체만</span>
          </label>
          {(nameSearch || selectedGenerations.length > 0 || selectedTypes.length > 0 || finalOnly) && (
            <button
              onClick={() => {
                setNameSearch("");
                setSelectedGenerations([]);
                setSelectedTypes([]);
                setFinalOnly(false);
                setPage(1);
              }}
              className="px-4 py-3 bg-slate-700 border border-slate-600 rounded-xl text-slate-300 hover:text-white hover:border-slate-400 transition-all text-sm"
            >
              초기화
            </button>
          )}
        </div>

        {/* 세대 필터 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSelectedGenerations([]); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedGenerations.length === 0
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-slate-400 hover:text-white border border-slate-600"
            }`}
          >
            전체
          </button>
          {GENERATIONS.map((gen) => (
            <button
              key={gen}
              onClick={() => handleGenerationChange(gen)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all gen-${gen} ${
                selectedGenerations.includes(gen)
                  ? "opacity-100 ring-2 ring-white/40"
                  : "opacity-60 hover:opacity-90"
              }`}
            >
              {gen}세대
            </button>
          ))}
        </div>

        {/* 타입 필터 */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setSelectedTypes([]); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              selectedTypes.length === 0
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-slate-400 hover:text-white border border-slate-600"
            }`}
          >
            전체
          </button>
          {TYPES.map((type) => (
            <button
              key={type}
              onClick={() => handleTypeChange(type)}
              className={`type-${type} px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                selectedTypes.includes(type)
                  ? "opacity-100 ring-2 ring-white/40"
                  : "opacity-60 hover:opacity-90"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </section>

      {/* 포켓몬 목록 */}
      <section className="max-w-5xl mx-auto px-4">
        {loading ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {Array.from({ length: 60 }).map((_, i) => (
              <div key={i} className="aspect-square bg-slate-800/60 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {pokemon.map((p) => {
                const types = getTypes(p.types);
                const inEntry = entry.some((e) => e.id === p.id);
                const entryFull = entry.length >= MAX_ENTRY;
                return (
                  <button
                    key={p.id}
                    onClick={() => addToEntry(p)}
                    disabled={inEntry || entryFull}
                    className={`flex flex-col items-center p-2 rounded-xl border transition-all text-left ${
                      inEntry
                        ? "border-amber-500 bg-amber-500/10 opacity-60 cursor-not-allowed"
                        : entryFull
                        ? "border-slate-700 bg-slate-800/40 opacity-40 cursor-not-allowed"
                        : "border-slate-700 bg-slate-800/60 hover:border-amber-500/60 hover:bg-slate-700/60 cursor-pointer"
                    }`}
                  >
                    <div className="relative w-full aspect-square">
                      <Image
                        src={p.image_url}
                        alt={p.name_ko}
                        fill
                        className="object-contain"
                        unoptimized
                      />
                      {inEntry && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-amber-400 text-xl font-bold">✓</span>
                        </div>
                      )}
                    </div>
                    <span className="text-slate-400 text-xs mt-1">No.{p.national_dex}</span>
                    <span className="text-white text-xs font-medium text-center leading-tight">
                      {p.name_ko}
                      {p.form_name && (
                        <span className="text-slate-400 text-xs block">{p.form_name}</span>
                      )}
                    </span>
                    <div className="flex gap-1 mt-1 flex-wrap justify-center">
                      {types.map((t) => (
                        <span key={t} className={`type-${t} text-xs px-1.5 py-0.5 rounded`}>
                          {t}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 페이지네이션 */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-8">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 bg-slate-800 border border-slate-600 rounded-xl text-slate-300 hover:text-white hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  이전
                </button>
                <span className="text-slate-400 text-sm">
                  {page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                  className="px-4 py-2 bg-slate-800 border border-slate-600 rounded-xl text-slate-300 hover:text-white hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
