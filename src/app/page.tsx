"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";

// 타입 목록
const TYPES = [
  "노말", "불꽃", "물", "풀", "전기", "얼음",
  "격투", "독", "땅", "비행", "에스퍼", "벌레",
  "바위", "고스트", "드래곤", "악", "강철", "페어리"
];

// 세대 목록
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

interface PokemonDetail {
  id: number;
  national_dex: number;
  name_ko: string;
  name_en: string;
  form_name: string;
  image_url: string;
  types: Array<{ name_ko: string; name_en: string }>;
  stats: {
    hp: number;
    attack: number;
    defense: number;
    sp_attack: number;
    sp_defense: number;
    speed: number;
    total: number;
  };
  abilities: Array<{ name_ko: string; description: string; is_hidden: number }>;
  moves: Array<{ name_ko: string; level_learned: number; type_name: string; power: number }>;
  evolutions: Array<{ from_name: string; to_name: string; trigger: string; min_level: number }>;
}

export default function Home() {
  const [pokemon, setPokemon] = useState<Pokemon[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

  // 필터 상태
  const [selectedGeneration, setSelectedGeneration] = useState<number | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // 검색 상태
  const [searchQuery, setSearchQuery] = useState("");
  const [chatAnswer, setChatAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // 모달 상태
  const [selectedPokemon, setSelectedPokemon] = useState<PokemonDetail | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // 포켓몬 목록 로드
  const loadPokemon = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "24");
      params.set("page", page.toString());

      if (selectedGeneration) {
        params.set("generation", selectedGeneration.toString());
      }
      if (selectedType) {
        params.set("type", selectedType);
      }

      const res = await fetch(`/api/pokemon?${params.toString()}`);
      const data = await res.json();

      setPokemon(data.data || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error("로드 실패:", error);
    } finally {
      setLoading(false);
    }
  }, [page, selectedGeneration, selectedType]);

  useEffect(() => {
    loadPokemon();
  }, [loadPokemon]);

  // 필터 변경 시 페이지 리셋
  const handleGenerationChange = (gen: number | null) => {
    setSelectedGeneration(gen);
    setPage(1);
  };

  const handleTypeChange = (type: string | null) => {
    setSelectedType(type);
    setPage(1);
  };

  // 포켓몬 카드 클릭 - 상세 정보 모달
  const handleCardClick = async (pokemonId: number) => {
    setModalLoading(true);
    setSelectedPokemon(null);
    try {
      const res = await fetch(`/api/pokemon/${pokemonId}`);
      const data = await res.json();
      setSelectedPokemon(data);
    } catch (error) {
      console.error("상세 정보 로드 실패:", error);
    } finally {
      setModalLoading(false);
    }
  };

  const closeModal = () => {
    setSelectedPokemon(null);
  };

  // AI 검색 (스트리밍)
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setChatLoading(true);
    setChatAnswer("");

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: searchQuery }),
      });

      if (!res.body) {
        throw new Error("스트림을 읽을 수 없습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);
            if (chunk.type === "answer") {
              answer += chunk.content;
              setChatAnswer(answer);
            } else if (chunk.type === "error") {
              setChatAnswer("오류: " + chunk.content);
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }

      if (!answer) {
        setChatAnswer("답변을 생성할 수 없습니다.");
      }
    } catch (error) {
      setChatAnswer("오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <main className="min-h-screen pb-20">
      {/* 헤더 */}
      <header className="text-center py-12">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 bg-clip-text text-transparent mb-4">
          포켓몬 위키
        </h1>
        <p className="text-slate-400 text-lg">
          AI가 답변하는 포켓몬 백과사전
        </p>
      </header>

      {/* 검색창 */}
      <section className="max-w-2xl mx-auto px-4 mb-8">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="궁금한 포켓몬 정보를 물어보세요... (예: 피카츄의 타입이 뭐야?)"
            className="search-input w-full px-6 py-4 bg-slate-800/80 backdrop-blur border border-slate-600 rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:border-amber-500 transition-all"
          />
          <button
            onClick={handleSearch}
            disabled={chatLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 rounded-xl text-white font-semibold transition-all disabled:opacity-50"
          >
            {chatLoading ? "검색 중..." : "검색"}
          </button>
        </div>

        {/* AI 답변 */}
        {chatAnswer && (
          <div className="mt-4 p-6 bg-slate-800/60 backdrop-blur border border-slate-600 rounded-2xl">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-amber-400 text-xl">🤖</span>
              <span className="text-amber-400 font-semibold">AI 답변</span>
            </div>
            <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">
              {chatAnswer}
            </p>
          </div>
        )}
      </section>

      {/* 필터 섹션 */}
      <section className="max-w-6xl mx-auto px-4 mb-8">
        {/* 세대 필터 */}
        <div className="mb-6">
          <h3 className="text-slate-400 text-sm mb-3 font-medium">세대 필터</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleGenerationChange(null)}
              className={`filter-btn px-4 py-2 rounded-lg font-medium transition-all ${selectedGeneration === null
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
            >
              전체
            </button>
            {GENERATIONS.map((gen) => (
              <button
                key={gen}
                onClick={() => handleGenerationChange(gen)}
                className={`filter-btn px-4 py-2 rounded-lg font-medium transition-all ${selectedGeneration === gen
                  ? "bg-amber-500 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
              >
                {gen}세대
              </button>
            ))}
          </div>
        </div>

        {/* 타입 필터 */}
        <div>
          <h3 className="text-slate-400 text-sm mb-3 font-medium">타입 필터</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleTypeChange(null)}
              className={`filter-btn px-4 py-2 rounded-lg font-medium transition-all ${selectedType === null
                ? "bg-amber-500 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                }`}
            >
              전체
            </button>
            {TYPES.map((type) => (
              <button
                key={type}
                onClick={() => handleTypeChange(type)}
                className={`filter-btn px-4 py-2 rounded-lg font-medium transition-all ${selectedType === type
                  ? `type-${type} text-white`
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 포켓몬 그리드 */}
      <section className="max-w-6xl mx-auto px-4">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...Array(24)].map((_, i) => (
              <div
                key={i}
                className="loading-pulse bg-slate-800 rounded-2xl aspect-square"
              />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {pokemon.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handleCardClick(p.id)}
                  className="pokemon-card bg-slate-800/80 backdrop-blur border border-slate-700 rounded-2xl p-4 cursor-pointer"
                >
                  <div className="relative aspect-square mb-3">
                    {p.image_url ? (
                      <Image
                        src={p.image_url}
                        alt={p.name_ko}
                        fill
                        className="object-contain"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-700 rounded-xl">
                        <span className="text-4xl text-slate-500">?</span>
                      </div>
                    )}
                  </div>
                  <div className="text-center">
                    <p className="text-slate-500 text-xs mb-1">
                      No.{p.national_dex}
                    </p>
                    <h3 className="text-white font-semibold text-sm">
                      {p.name_ko}
                      {p.form_name && (
                        <span className="text-slate-400 text-xs ml-1">
                          ({p.form_name})
                        </span>
                      )}
                    </h3>
                    <div className="flex justify-center gap-1 mt-2">
                      {p.types?.split(",").map((type) => (
                        <span
                          key={type}
                          className={`type-${type.trim()} px-2 py-0.5 rounded text-xs font-medium`}
                        >
                          {type.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 페이지네이션 */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-10">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-white transition-all"
                >
                  이전
                </button>
                <span className="text-slate-400">
                  {page} / {pagination.totalPages} 페이지
                </span>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(pagination.totalPages, p + 1))
                  }
                  disabled={page === pagination.totalPages}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded-lg text-white transition-all"
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* 포켓몬 상세 모달 */}
      {(selectedPokemon || modalLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="relative bg-slate-900 border border-slate-600 rounded-3xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기 버튼 */}
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-slate-700 hover:bg-slate-600 rounded-full text-white text-xl transition-all z-10"
            >
              ×
            </button>

            {modalLoading ? (
              <div className="p-12 text-center">
                <div className="loading-pulse text-slate-400">로딩 중...</div>
              </div>
            ) : selectedPokemon && (
              <div className="p-6">
                {/* 헤더 */}
                <div className="flex flex-col md:flex-row gap-6 mb-8">
                  <div className="relative w-48 h-48 mx-auto md:mx-0 flex-shrink-0">
                    {selectedPokemon.image_url ? (
                      <Image
                        src={selectedPokemon.image_url}
                        alt={selectedPokemon.name_ko}
                        fill
                        className="object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-700 rounded-xl">
                        <span className="text-6xl text-slate-500">?</span>
                      </div>
                    )}
                  </div>
                  <div className="text-center md:text-left">
                    <p className="text-slate-500 text-sm">No.{selectedPokemon.national_dex}</p>
                    <h2 className="text-3xl font-bold text-white mb-2">
                      {selectedPokemon.name_ko}
                      {selectedPokemon.form_name && (
                        <span className="text-slate-400 text-lg ml-2">({selectedPokemon.form_name})</span>
                      )}
                    </h2>
                    <p className="text-slate-400 mb-3">{selectedPokemon.name_en}</p>
                    <div className="flex justify-center md:justify-start gap-2">
                      {selectedPokemon.types?.map((t) => (
                        <span key={t.name_ko} className={`type-${t.name_ko} px-3 py-1 rounded-lg font-medium`}>
                          {t.name_ko}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 종족값 */}
                <div className="mb-8">
                  <h3 className="text-amber-400 font-semibold mb-4 text-lg">📊 종족값</h3>
                  {selectedPokemon.stats && (
                    <div className="space-y-2">
                      {[
                        { label: 'HP', value: selectedPokemon.stats.hp, color: 'bg-red-500' },
                        { label: '공격', value: selectedPokemon.stats.attack, color: 'bg-orange-500' },
                        { label: '방어', value: selectedPokemon.stats.defense, color: 'bg-yellow-500' },
                        { label: '특공', value: selectedPokemon.stats.sp_attack, color: 'bg-blue-500' },
                        { label: '특방', value: selectedPokemon.stats.sp_defense, color: 'bg-green-500' },
                        { label: '스피드', value: selectedPokemon.stats.speed, color: 'bg-pink-500' },
                      ].map((stat) => (
                        <div key={stat.label} className="flex items-center gap-3">
                          <span className="w-16 text-slate-400 text-sm">{stat.label}</span>
                          <div className="flex-1 bg-slate-700 rounded-full h-3">
                            <div
                              className={`${stat.color} h-3 rounded-full transition-all`}
                              style={{ width: `${Math.min(100, (stat.value / 255) * 100)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-white font-medium">{stat.value}</span>
                        </div>
                      ))}
                      <div className="flex items-center gap-3 pt-2 border-t border-slate-700">
                        <span className="w-16 text-amber-400 text-sm font-semibold">합계</span>
                        <span className="text-amber-400 font-bold text-lg">{selectedPokemon.stats.total}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 특성 */}
                <div className="mb-8">
                  <h3 className="text-amber-400 font-semibold mb-4 text-lg">✨ 특성</h3>
                  <div className="space-y-2">
                    {selectedPokemon.abilities?.map((ability, i) => (
                      <div key={i} className="bg-slate-800 rounded-xl p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{ability.name_ko}</span>
                          {ability.is_hidden && (
                            <span className="text-xs bg-purple-600 px-2 py-0.5 rounded">숨겨진 특성</span>
                          )}
                        </div>
                        {ability.description && (
                          <p className="text-slate-400 text-sm mt-1">{ability.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 진화 */}
                {selectedPokemon.evolutions && selectedPokemon.evolutions.length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-amber-400 font-semibold mb-4 text-lg">🔄 진화</h3>
                    <div className="space-y-2">
                      {selectedPokemon.evolutions.map((evo: any, i: number) => {
                        // 진화 조건 텍스트 생성
                        const getEvolutionCondition = () => {
                          const conditions: string[] = [];

                          if (evo.min_level) {
                            conditions.push(`Lv.${evo.min_level}`);
                          }
                          if (evo.item) {
                            // 아이템 이름 한글화 (간단한 매핑)
                            const itemNames: Record<string, string> = {
                              'thunder-stone': '천둥의 돌',
                              'fire-stone': '불꽃의 돌',
                              'water-stone': '물의 돌',
                              'leaf-stone': '리프의 돌',
                              'moon-stone': '달의 돌',
                              'sun-stone': '태양의 돌',
                              'shiny-stone': '빛의 돌',
                              'dusk-stone': '어둠의 돌',
                              'dawn-stone': '각성의 돌',
                              'ice-stone': '얼음의 돌',
                              'linking-cord': '연결의 끈',
                              'metal-coat': '금속코트',
                              'kings-rock': '왕의 징표석',
                              'dragon-scale': '용의 비늘',
                              'upgrade': '업그레이드',
                              'dubious-disc': '괴상한 패치',
                              'protector': '프로텍터',
                              'electirizer': '에레키부스터',
                              'magmarizer': '마그마부스터',
                              'razor-fang': '예리한 이빨',
                              'razor-claw': '예리한 손톱',
                              'prism-scale': '고운비늘',
                              'reaper-cloth': '영계의 천',
                              'deep-sea-tooth': '심해의 이빨',
                              'deep-sea-scale': '심해의 비늘',
                              'oval-stone': '타원형의 돌',
                            };
                            conditions.push(itemNames[evo.item] || evo.item);
                          }
                          if (evo.trigger === 'trade') {
                            conditions.push('교환');
                          }
                          if (evo.trigger === 'level-up' && !evo.min_level && !evo.item) {
                            if (evo.condition?.includes('high-friendship') || evo.condition?.includes('friendship')) {
                              conditions.push('친밀도');
                            }
                          }
                          if (evo.condition) {
                            if (evo.condition.includes('day')) conditions.push('낮');
                            if (evo.condition.includes('night')) conditions.push('밤');
                            if (evo.condition.includes('rain')) conditions.push('비');
                            if (evo.condition.includes('friendship') && !conditions.includes('친밀도')) {
                              conditions.push('친밀도');
                            }
                          }

                          return conditions.length > 0 ? conditions.join(' + ') : '';
                        };

                        const condition = getEvolutionCondition();

                        return (
                          <div key={i} className="bg-slate-800 rounded-xl p-3 flex items-center gap-3 flex-wrap">
                            <span className="text-white">{evo.from_name || '?'}</span>
                            <span className="text-amber-400">→</span>
                            <span className="text-white font-semibold">{evo.to_name || '?'}</span>
                            {condition && (
                              <span className="text-cyan-400 text-sm bg-slate-700 px-2 py-0.5 rounded">
                                {condition}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 배우는 기술 */}
                {selectedPokemon.moves && selectedPokemon.moves.length > 0 && (
                  <div>
                    <h3 className="text-amber-400 font-semibold mb-4 text-lg">⚔️ 배우는 기술 (레벨업)</h3>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {selectedPokemon.moves.map((move, i) => (
                        <div key={i} className="bg-slate-800 rounded-lg p-2 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-white">{move.name_ko}</span>
                            <span className="text-slate-500">Lv.{move.level_learned}</span>
                          </div>
                          {move.type_name && (
                            <span className={`type-${move.type_name} px-2 py-0.5 rounded text-xs mt-1 inline-block`}>
                              {move.type_name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
