import Database from 'better-sqlite3';

const db = new Database('data/pokemon.db');

interface PokeAPIMove {
    move: { url: string };
    version_group_details: Array<{
        move_learn_method: { name: string };
        level_learned_at: number;
    }>;
}

async function fetchPokeAPI<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API 오류: ${res.status}`);
    return res.json();
}

async function recollectMoves() {
    console.log('⚔️ 포켓몬별 기술 정보 재수집 중...');

    // DB에서 모든 포켓몬 ID 가져오기
    const pokemonList = db.prepare('SELECT id FROM pokemon ORDER BY id').all() as { id: number }[];
    console.log(`📊 총 ${pokemonList.length}개 포켓몬의 기술 수집 예정`);

    const insertPokeMove = db.prepare(`
        INSERT OR REPLACE INTO pokemon_moves (pokemon_id, move_id, learn_method, level_learned)
        VALUES (?, ?, ?, ?)
    `);

    let processed = 0;
    for (const { id } of pokemonList) {
        try {
            const pokemon = await fetchPokeAPI<any>(`https://pokeapi.co/api/v2/pokemon/${id}`);

            for (const m of pokemon.moves) {
                const moveId = parseInt(m.move.url.split('/').filter(Boolean).pop()!);
                // 가장 최근 버전 그룹의 정보 사용
                const detail = m.version_group_details[0];
                if (detail) {
                    const learnMethod = detail.move_learn_method.name;
                    const levelLearned = detail.level_learned_at || null;
                    insertPokeMove.run(id, moveId, learnMethod, levelLearned);
                }
            }

            processed++;
            if (processed % 50 === 0) {
                console.log(`✅ ${processed}/${pokemonList.length} 포켓몬 처리 완료`);
            }
        } catch (e) {
            console.error(`❌ 포켓몬 ID ${id} 처리 실패:`, e);
        }
    }

    console.log(`✨ 기술 정보 재수집 완료! (${processed}/${pokemonList.length})`);
}

async function main() {
    try {
        await recollectMoves();

        // 수집 결과 확인
        const stats = db.prepare(`
            SELECT learn_method, COUNT(*) as count 
            FROM pokemon_moves 
            GROUP BY learn_method
        `).all();

        console.log('\n📊 수집된 기술 습득 방식 통계:');
        console.table(stats);
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        db.close();
    }
}

main();
