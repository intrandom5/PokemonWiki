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

// 0. 스키마 초기화 및 업데이트
function initSchema() {
    console.log('🏗️ 데이터베이스 스키마 초기화 및 업데이트 중...');

    db.exec(`
        CREATE TABLE IF NOT EXISTS types (
            id INTEGER PRIMARY KEY,
            name_ko TEXT NOT NULL,
            name_en TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS moves (
            id INTEGER PRIMARY KEY,
            name_ko TEXT NOT NULL,
            name_en TEXT NOT NULL,
            type_id INTEGER,
            power INTEGER,
            accuracy INTEGER,
            pp INTEGER,
            damage_class TEXT,
            description TEXT,
            priority INTEGER DEFAULT 0,
            target TEXT,
            effect_chance INTEGER,
            FOREIGN KEY (type_id) REFERENCES types (id)
        );

        CREATE TABLE IF NOT EXISTS pokemon (
            id INTEGER PRIMARY KEY,
            national_dex INTEGER NOT NULL,
            name_ko TEXT NOT NULL,
            name_en TEXT NOT NULL,
            form_name TEXT,
            generation INTEGER NOT NULL,
            image_url TEXT,
            is_default INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS stats (
            pokemon_id INTEGER PRIMARY KEY,
            hp INTEGER NOT NULL,
            attack INTEGER NOT NULL,
            defense INTEGER NOT NULL,
            sp_attack INTEGER NOT NULL,
            sp_defense INTEGER NOT NULL,
            speed INTEGER NOT NULL,
            total INTEGER NOT NULL,
            FOREIGN KEY (pokemon_id) REFERENCES pokemon (id)
        );

        CREATE TABLE IF NOT EXISTS abilities (
            id INTEGER PRIMARY KEY,
            name_ko TEXT NOT NULL,
            name_en TEXT NOT NULL,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS pokemon_abilities (
            pokemon_id INTEGER,
            ability_id INTEGER,
            slot INTEGER,
            is_hidden INTEGER,
            PRIMARY KEY (pokemon_id, ability_id),
            FOREIGN KEY (pokemon_id) REFERENCES pokemon (id),
            FOREIGN KEY (ability_id) REFERENCES abilities (id)
        );

        CREATE TABLE IF NOT EXISTS pokemon_types (
            pokemon_id INTEGER,
            type_id INTEGER,
            slot INTEGER,
            PRIMARY KEY (pokemon_id, type_id),
            FOREIGN KEY (pokemon_id) REFERENCES pokemon (id),
            FOREIGN KEY (type_id) REFERENCES types (id)
        );

        CREATE TABLE IF NOT EXISTS pokemon_moves (
            pokemon_id INTEGER,
            move_id INTEGER,
            learn_method TEXT,
            level_learned INTEGER,
            PRIMARY KEY (pokemon_id, move_id, learn_method, level_learned),
            FOREIGN KEY (pokemon_id) REFERENCES pokemon (id),
            FOREIGN KEY (move_id) REFERENCES moves (id)
        );

        CREATE TABLE IF NOT EXISTS evolutions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_pokemon_id INTEGER,
            to_pokemon_id INTEGER,
            trigger TEXT,
            min_level INTEGER,
            item TEXT,
            condition TEXT
        );
    `);

    // 기존 테이블에 컬럼 추가 (필요한 경우)
    const columnsToAdd = [
        { table: 'moves', column: 'description', type: 'TEXT' },
        { table: 'moves', column: 'priority', type: 'INTEGER DEFAULT 0' },
        { table: 'moves', column: 'target', type: 'TEXT' },
        { table: 'moves', column: 'effect_chance', type: 'INTEGER' }
    ];

    for (const item of columnsToAdd) {
        try {
            db.prepare(`ALTER TABLE ${item.table} ADD COLUMN ${item.column} ${item.type}`).run();
        } catch (e: any) {
            // Already exists or other non-critical error
        }
    }
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

// 2. 특성 데이터 수집
async function collectAbilities() {
    console.log('🎯 특성 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: any[] }>('https://pokeapi.co/api/v2/ability?limit=1000');
    const insertAbility = db.prepare('INSERT OR REPLACE INTO abilities (id, name_ko, name_en, description) VALUES (?, ?, ?, ?)');

    let processed = 0;
    for (const abilityRef of data.results) {
        try {
            const ability = await fetchPokeAPI<any>(abilityRef.url);
            const nameKo = ability.names.find((n: any) => n.language.name === 'ko')?.name || ability.name;
            const descKo = ability.flavor_text_entries.find((e: any) => e.language.name === 'ko')?.flavor_text || '';
            insertAbility.run(ability.id, nameKo, ability.name, descKo.replace(/\n/g, ' '));
            processed++;
            if (processed % 100 === 0) console.log(`✅ ${processed}/${data.results.length} 특성 수집 완료`);
        } catch (e) { }
    }
}

// 3. 기술 데이터 수집
async function collectMoves() {
    console.log('⚔️ 기술 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: any[] }>('https://pokeapi.co/api/v2/move?limit=2000');
    const insertMove = db.prepare(`
        INSERT OR REPLACE INTO moves (id, name_ko, name_en, type_id, power, accuracy, pp, damage_class, description, priority, target, effect_chance) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let processed = 0;
    for (const moveRef of data.results) {
        try {
            const moveData = await fetchPokeAPI<any>(moveRef.url);
            const nameKo = moveData.names.find((n: any) => n.language.name === 'ko')?.name || moveData.name;
            const typeId = parseInt(moveData.type.url.split('/').filter(Boolean).pop()!);
            let desc = moveData.flavor_text_entries.find((e: any) => e.language.name === 'ko')?.flavor_text;
            if (!desc) desc = moveData.flavor_text_entries.find((e: any) => e.language.name === 'en')?.flavor_text;
            desc = desc ? desc.replace(/\n/g, ' ') : null;

            insertMove.run(
                moveData.id, nameKo, moveData.name, typeId,
                moveData.power || null, moveData.accuracy || null, moveData.pp || null,
                moveData.damage_class.name, desc, moveData.priority || 0,
                moveData.target.name, moveData.effect_chance || null
            );
            processed++;
            if (processed % 100 === 0) console.log(`✅ ${processed}/${data.results.length} 기술 수집 완료`);
        } catch (e) { }
    }
}

// 4. 포켓몬 & 종 정보 수집
async function collectPokemon() {
    console.log('🐾 포켓몬 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: any[] }>('https://pokeapi.co/api/v2/pokemon-species?limit=2000');

    const insertPokemon = db.prepare('INSERT OR REPLACE INTO pokemon (id, national_dex, name_ko, name_en, form_name, generation, image_url, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertStats = db.prepare('INSERT OR REPLACE INTO stats (pokemon_id, hp, attack, defense, sp_attack, sp_defense, speed, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insertPokeType = db.prepare('INSERT OR REPLACE INTO pokemon_types (pokemon_id, type_id, slot) VALUES (?, ?, ?)');
    const insertPokeMove = db.prepare('INSERT OR REPLACE INTO pokemon_moves (pokemon_id, move_id, learn_method, level_learned) VALUES (?, ?, ?, ?)');
    const insertPokeAbility = db.prepare('INSERT OR REPLACE INTO pokemon_abilities (pokemon_id, ability_id, is_hidden, slot) VALUES (?, ?, ?, ?)');

    const evolutionChains = new Set<string>();

    let processedSpecies = 0;
    for (const speciesRef of data.results) {
        try {
            const species = await fetchPokeAPI<PokeAPISpecies>(speciesRef.url);
            const nameKoBase = species.names.find(n => n.language.name === 'ko')?.name || species.name;
            const genNum = parseInt(species.generation.url.split('/').filter(Boolean).pop()!);
            evolutionChains.add(species.evolution_chain.url);

            for (const variety of species.varieties) {
                const pokemon = await fetchPokeAPI<any>(variety.pokemon.url);
                let formNameEn = !variety.is_default ? pokemon.name.replace(species.name + '-', '') : '';
                const formNameKo = FORM_NAME_MAP[formNameEn] || formNameEn;
                const imageUrl = pokemon.sprites.other?.['official-artwork']?.front_default;

                insertPokemon.run(pokemon.id, species.id, nameKoBase, species.name, formNameKo, genNum, imageUrl, variety.is_default ? 1 : 0);

                const stats = {
                    hp: pokemon.stats.find((s: any) => s.stat.name === 'hp')?.base_stat || 0,
                    atk: pokemon.stats.find((s: any) => s.stat.name === 'attack')?.base_stat || 0,
                    def: pokemon.stats.find((s: any) => s.stat.name === 'defense')?.base_stat || 0,
                    spa: pokemon.stats.find((s: any) => s.stat.name === 'special-attack')?.base_stat || 0,
                    spd: pokemon.stats.find((s: any) => s.stat.name === 'special-defense')?.base_stat || 0,
                    spe: pokemon.stats.find((s: any) => s.stat.name === 'speed')?.base_stat || 0,
                };
                insertStats.run(pokemon.id, stats.hp, stats.atk, stats.def, stats.spa, stats.spd, stats.spe, Object.values(stats).reduce((a, b) => a + b, 0));

                for (const t of pokemon.types) {
                    const typeId = parseInt(t.type.url.split('/').filter(Boolean).pop()!);
                    insertPokeType.run(pokemon.id, typeId, t.slot);
                }

                for (const ab of pokemon.abilities) {
                    const abilityId = parseInt(ab.ability.url.split('/').filter(Boolean).pop()!);
                    insertPokeAbility.run(pokemon.id, abilityId, ab.is_hidden ? 1 : 0, ab.slot);
                }

                for (const m of pokemon.moves) {
                    const moveId = parseInt(m.move.url.split('/').filter(Boolean).pop()!);
                    const detail = m.version_group_details[0];
                    if (detail) {
                        insertPokeMove.run(pokemon.id, moveId, detail.move_learn_method.name, detail.level_learned_at || null);
                    }
                }
            }
            processedSpecies++;
            if (processedSpecies % 100 === 0) console.log(`✅ ${processedSpecies}/${data.results.length} 포켓몬 종 수집 완료`);
        } catch (e) { }
    }
    return Array.from(evolutionChains);
}

// 5. 진화 정보 수집
async function collectEvolutions(chainUrls: string[]) {
    console.log('🧬 진화 정보 수집 중...');
    db.prepare('DELETE FROM evolutions').run();
    const insertEvo = db.prepare('INSERT INTO evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition) VALUES (?, ?, ?, ?, ?, ?)');

    for (const url of chainUrls) {
        try {
            const data = await fetchPokeAPI<any>(url);
            const processChain = (link: any) => {
                for (const next of link.evolves_to) {
                    const fromId = parseInt(link.species.url.split('/').filter(Boolean).pop()!);
                    const toId = parseInt(next.species.url.split('/').filter(Boolean).pop()!);
                    const detail = next.evolution_details[0];
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
                    if (detail?.relative_physical_stats !== null && detail?.relative_physical_stats !== undefined) conditions.push(`physical_stats:${detail.relative_physical_stats}`);
                    if (detail?.trade_species) conditions.push(`trade_species:${detail.trade_species.name}`);
                    if (detail?.turn_upside_down) conditions.push('upside_down:true');

                    insertEvo.run(fromId, toId, detail?.trigger?.name || 'unknown', detail?.min_level || null, detail?.item?.name || null, conditions.length > 0 ? conditions.join(',') : null);
                    processChain(next);
                }
            };
            processChain(data.chain);
        } catch (e) { }
    }
}

async function main() {
    try {
        console.log('🚀 전체 데이터 통합 수집 시작...');
        initSchema();
        await collectTypes();
        await collectAbilities();
        await collectMoves();
        const chains = await collectPokemon();
        await collectEvolutions(chains);
        console.log('✨ 모든 정보 수집 및 통합 완료!');
    } catch (error) {
        console.error('❌ 치명적 오류:', error);
    } finally {
        db.close();
    }
}

main();
