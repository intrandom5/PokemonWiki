import { getDatabase } from '../src/lib/db';
import {
    PokeAPIPokemon,
    PokeAPISpecies,
    PokeAPITypeData,
    PokeAPIMove,
    PokeAPIType
} from '../src/types/pokemon';

const db = getDatabase();

// 한글 폼 이름 매핑
const FORM_NAME_MAP: Record<string, string> = {
    'alola': '알로라',
    'galar': '가라르',
    'hisui': '히스이',
    'paldea': '팔데아',
    'mega': '메가',
    'mega-x': '메가X',
    'mega-y': '메가Y',
    'mega-z': '메가Z',
    'gmax': '거다이맥스',
    'origin': '오리진',
    'therian': '영물',
    'unbound': '굴레를 벗어난',
};

// API 호출 헬퍼
async function fetchPokeAPI<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${url}`);
    return response.json() as Promise<T>;
}

// 1. 타입 데이터 수집
async function collectTypes() {
    console.log('📊 타입 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: PokeAPIType[] }>('https://pokeapi.co/api/v2/type?limit=100');
    const insertType = db.prepare('INSERT OR REPLACE INTO types (id, name_ko, name_en) VALUES (?, ?, ?)');

    for (const typeRef of data.results) {
        const typeData = await fetchPokeAPI<PokeAPITypeData>(typeRef.url);
        const nameKo = typeData.names.find(n => n.language.name === 'ko')?.name || typeData.name;
        insertType.run(typeData.id, nameKo, typeData.name);
    }
}

// 2. 기술 데이터 수집
async function collectMoves() {
    console.log('⚔️ 기술 데이터 수집 중... (약 1분 소요)');
    const data = await fetchPokeAPI<{ results: PokeAPIType[] }>('https://pokeapi.co/api/v2/move?limit=2000');
    const insertMove = db.prepare(`
    INSERT OR REPLACE INTO moves (id, name_ko, name_en, type_id, power, accuracy, pp, damage_class) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

    for (const moveRef of data.results) {
        try {
            const moveData = await fetchPokeAPI<PokeAPIMove>(moveRef.url);
            const nameKo = moveData.names.find(n => n.language.name === 'ko')?.name || moveData.name;
            const typeId = parseInt(moveData.type.url.split('/').filter(Boolean).pop()!);

            // 인자 개수 수정 (8개)
            insertMove.run(
                moveData.id,
                nameKo,
                moveData.name,
                typeId,
                moveData.power || null,
                moveData.accuracy || null,
                moveData.pp || null,
                moveData.damage_class.name
            );
        } catch (e) {
            console.error(`기술 수집 실패: ${moveRef.name}`);
        }
    }
}

// 3. 포켓몬 & 종 정보 수집
async function collectPokemon() {
    console.log('🐾 [테스트 모드] 이상해씨 & 식스테일 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: PokeAPIType[] }>('https://pokeapi.co/api/v2/pokemon-species?limit=2000');

    const insertPokemon = db.prepare(`
    INSERT OR REPLACE INTO pokemon (id, national_dex, name_ko, name_en, form_name, generation, image_url, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertStats = db.prepare(`
    INSERT OR REPLACE INTO stats (pokemon_id, hp, attack, defense, sp_attack, sp_defense, speed, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertPokeType = db.prepare(`INSERT OR REPLACE INTO pokemon_types (pokemon_id, type_id, slot) VALUES (?, ?, ?)`);
    const insertPokeMove = db.prepare(`INSERT OR REPLACE INTO pokemon_moves (pokemon_id, move_id, learn_method, level_learned) VALUES (?, ?, ?, ?)`);

    const evolutionChains = new Set<string>();

    for (const speciesRef of data.results) {
        try {
            const species = await fetchPokeAPI<PokeAPISpecies>(speciesRef.url);
            const nameKoBase = species.names.find(n => n.language.name === 'ko')?.name || species.name;
            const genNum = parseInt(species.generation.url.split('/').filter(Boolean).pop()!);
            evolutionChains.add(species.evolution_chain.url);

            for (const variety of species.varieties) {
                const pokemon = await fetchPokeAPI<PokeAPIPokemon>(variety.pokemon.url);

                // 폼 이름 추출 및 한글화
                let formNameEn = '';
                if (!variety.is_default) {
                    formNameEn = pokemon.name.replace(species.name + '-', '');
                }
                const formNameKo = FORM_NAME_MAP[formNameEn] || formNameEn;

                // 1. 포켓몬 기본 정보
                const imageUrl = pokemon.sprites.other?.['official-artwork']?.front_default;
                insertPokemon.run(pokemon.id, species.id, nameKoBase, species.name, formNameKo, genNum, imageUrl, variety.is_default ? 1 : 0);

                // 2. 능력치
                const stats = {
                    hp: pokemon.stats.find(s => s.stat.name === 'hp')?.base_stat || 0,
                    atk: pokemon.stats.find(s => s.stat.name === 'attack')?.base_stat || 0,
                    def: pokemon.stats.find(s => s.stat.name === 'defense')?.base_stat || 0,
                    spa: pokemon.stats.find(s => s.stat.name === 'special-attack')?.base_stat || 0,
                    spd: pokemon.stats.find(s => s.stat.name === 'special-defense')?.base_stat || 0,
                    spe: pokemon.stats.find(s => s.stat.name === 'speed')?.base_stat || 0,
                };
                const total = Object.values(stats).reduce((a, b) => a + b, 0);
                insertStats.run(pokemon.id, stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe, total);

                // 3. 타입
                for (const t of pokemon.types) {
                    const typeId = parseInt(t.type.url.split('/').filter(Boolean).pop()!);
                    insertPokeType.run(pokemon.id, typeId, t.slot);
                }

                // 4. 기술 (너무 많으므로 레벨업으로 배우는 기술 중 일부만 저장하거나 최적화 필요)
                // 여기서는 기술 ID와 방식만 저장 (중복 방지 위해 간단히)
                const levelUpMoves = pokemon.moves.filter(m =>
                    m.version_group_details.some(d => d.move_learn_method.name === 'level-up')
                );
                for (const m of levelUpMoves) {
                    const moveId = parseInt(m.move.url.split('/').filter(Boolean).pop()!);
                    const detail = m.version_group_details[0]; // 가장 최근 버전 기준
                    insertPokeMove.run(pokemon.id, moveId, 'level-up', detail.level_learned_at);
                }
            }
            console.log(`[${species.id}] ${nameKoBase} 수집 완료`);
        } catch (e) {
            console.error(`Error collecting ${speciesRef.name}:`, e);
        }
    }

    return Array.from(evolutionChains);
}

// 4. 진화 정보 수집 (간략화)
async function collectEvolutions(chainUrls: string[]) {
    console.log('🧬 진화 정보 수집 중...');
    const insertEvo = db.prepare(`
    INSERT INTO evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

    for (const url of chainUrls) {
        try {
            const data = await fetchPokeAPI<any>(url);
            let current = data.chain;

            const processChain = (link: any) => {
                for (const next of link.evolves_to) {
                    const fromId = parseInt(link.species.url.split('/').filter(Boolean).pop()!);
                    const toId = parseInt(next.species.url.split('/').filter(Boolean).pop()!);
                    const detail = next.evolution_details[0];

                    // 진화 조건 수집
                    const conditions: string[] = [];
                    if (detail?.min_happiness) conditions.push(`friendship:${detail.min_happiness}`);
                    if (detail?.time_of_day) conditions.push(`time:${detail.time_of_day}`);
                    if (detail?.location) conditions.push(`location:${detail.location.name}`);
                    if (detail?.held_item) conditions.push(`held_item:${detail.held_item.name}`);
                    if (detail?.known_move) conditions.push(`known_move:${detail.known_move.name}`);
                    if (detail?.known_move_type) conditions.push(`known_move_type:${detail.known_move_type.name}`);
                    if (detail?.min_beauty) conditions.push(`beauty:${detail.min_beauty}`);
                    if (detail?.min_affection) conditions.push(`affection:${detail.min_affection}`);
                    if (detail?.needs_overworld_rain) conditions.push('rain:true');
                    if (detail?.party_species) conditions.push(`party_species:${detail.party_species.name}`);
                    if (detail?.party_type) conditions.push(`party_type:${detail.party_type.name}`);
                    if (detail?.relative_physical_stats !== null && detail?.relative_physical_stats !== undefined) {
                        conditions.push(`physical_stats:${detail.relative_physical_stats}`);
                    }
                    if (detail?.trade_species) conditions.push(`trade_species:${detail.trade_species.name}`);
                    if (detail?.turn_upside_down) conditions.push('upside_down:true');

                    insertEvo.run(
                        fromId,
                        toId,
                        detail?.trigger?.name || 'unknown',
                        detail?.min_level || null,
                        detail?.item?.name || null,
                        conditions.length > 0 ? conditions.join(',') : null
                    );
                    processChain(next);
                }
            };
            processChain(current);
        } catch (e) { }
    }
}

async function main() {
    try {
        console.log('🚀 전체 데이터 수집 시작 (전체 완료까지 약 30분 예상)...');
        // await collectTypes();
        // await collectMoves();
        const chains = await collectPokemon();
        await collectEvolutions(chains);
        console.log('✨ 모든 장부 수집 및 저장 완료!');
    } catch (error) {
        console.error('❌ 치명적 오류:', error);
    } finally {
        db.close();
    }
}

main();
