import { getDatabase } from '../src/lib/db';

const db = getDatabase();

interface PokeAPIAbility {
    id: number;
    name: string;
    names: Array<{ name: string; language: { name: string } }>;
    flavor_text_entries: Array<{ flavor_text: string; language: { name: string } }>;
}

interface PokeAPIPokemonAbility {
    ability: { name: string; url: string };
    is_hidden: boolean;
    slot: number;
}

async function fetchPokeAPI<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${url}`);
    return response.json() as Promise<T>;
}

// 1. 특성 목록 수집
async function collectAbilities() {
    console.log('🎯 특성 데이터 수집 중...');
    const data = await fetchPokeAPI<{ results: Array<{ name: string; url: string }> }>(
        'https://pokeapi.co/api/v2/ability?limit=400'
    );

    const insertAbility = db.prepare(`
        INSERT OR REPLACE INTO abilities (id, name_ko, name_en, description) 
        VALUES (?, ?, ?, ?)
    `);

    for (const abilityRef of data.results) {
        try {
            const ability = await fetchPokeAPI<PokeAPIAbility>(abilityRef.url);
            const nameKo = ability.names.find(n => n.language.name === 'ko')?.name || ability.name;
            const descKo = ability.flavor_text_entries.find(e => e.language.name === 'ko')?.flavor_text || '';

            insertAbility.run(ability.id, nameKo, ability.name, descKo.replace(/\n/g, ' '));
        } catch (e) {
            console.error(`특성 수집 실패: ${abilityRef.name}`);
        }
    }
    console.log('✅ 특성 목록 수집 완료');
}

// 2. 기존 포켓몬의 특성 연결 정보만 수집
async function collectPokemonAbilities() {
    console.log('🔗 포켓몬-특성 연결 정보 수집 중...');

    // 이미 DB에 있는 포켓몬 ID 목록 가져오기
    const pokemonIds = db.prepare('SELECT id FROM pokemon').all() as Array<{ id: number }>;
    console.log(`총 ${pokemonIds.length}마리의 포켓몬에 대해 특성 정보 수집`);

    const insertPokemonAbility = db.prepare(`
        INSERT OR REPLACE INTO pokemon_abilities (pokemon_id, ability_id, is_hidden, slot) 
        VALUES (?, ?, ?, ?)
    `);

    let count = 0;
    for (const { id } of pokemonIds) {
        try {
            const pokemon = await fetchPokeAPI<{ abilities: PokeAPIPokemonAbility[] }>(
                `https://pokeapi.co/api/v2/pokemon/${id}/`
            );

            for (const ab of pokemon.abilities) {
                const abilityId = parseInt(ab.ability.url.split('/').filter(Boolean).pop()!);
                insertPokemonAbility.run(id, abilityId, ab.is_hidden ? 1 : 0, ab.slot);
            }

            count++;
            if (count % 100 === 0) {
                console.log(`[${count}/${pokemonIds.length}] 진행 중...`);
            }
        } catch (e) {
            console.error(`포켓몬 ${id} 특성 수집 실패`);
        }
    }
    console.log('✅ 포켓몬-특성 연결 완료');
}

async function main() {
    try {
        console.log('🚀 특성 정보 수집 시작...');
        await collectAbilities();
        await collectPokemonAbilities();
        console.log('✨ 특성 수집 완료!');
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        db.close();
    }
}

main();
