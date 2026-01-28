import Database from 'better-sqlite3';

const db = new Database('data/pokemon.db');

interface PokeAPIResource {
    url: string;
}

async function fetchPokeAPI<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API 오류: ${res.status}`);
    return res.json();
}

async function collectEvolutions() {
    console.log('🧬 진화 정보 재수집 중...');

    // PokeAPI에서 모든 진화 체인 가져오기
    const chainList = await fetchPokeAPI<{ count: number; results: PokeAPIResource[] }>('https://pokeapi.co/api/v2/evolution-chain?limit=1000');
    const chainUrls = chainList.results.map(r => r.url);

    console.log(`📊 총 ${chainUrls.length}개의 진화 체인 처리 예정`);

    const insertEvo = db.prepare(`
        INSERT INTO evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    let processed = 0;
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

            processed++;
            if (processed % 50 === 0) {
                console.log(`✅ ${processed}/${chainUrls.length} 진화 체인 처리 완료`);
            }
        } catch (e) {
            console.error(`❌ 진화 체인 처리 실패: ${url}`, e);
        }
    }

    console.log(`✨ 진화 정보 수집 완료! (${processed}/${chainUrls.length})`);
}

async function main() {
    try {
        await collectEvolutions();
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        db.close();
    }
}

main();
