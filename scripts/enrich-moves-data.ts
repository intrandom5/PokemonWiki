import Database from 'better-sqlite3';

const db = new Database('data/pokemon.db');

interface PokeAPIMoveDetail {
    id: number;
    flavor_text_entries: Array<{
        flavor_text: string;
        language: { name: string };
    }>;
    priority: number;
    target: { name: string };
    effect_chance: number | null;
}

async function fetchPokeAPI<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API 오류: ${res.status}`);
    return res.json();
}

async function enrichMovesData() {
    console.log('🛠️ moves 테이블 스키마 업데이트 중...');

    // 컬럼 추가 (이미 존재할 수 있으므로 try-catch 또는 safe하게 처리)
    const columns = [
        'ALTER TABLE moves ADD COLUMN description TEXT',
        'ALTER TABLE moves ADD COLUMN priority INTEGER DEFAULT 0',
        'ALTER TABLE moves ADD COLUMN target TEXT',
        'ALTER TABLE moves ADD COLUMN effect_chance INTEGER'
    ];

    for (const sql of columns) {
        try {
            db.prepare(sql).run();
        } catch (e: any) {
            // 컬럼이 이미 존재하면 에러 무시
            if (!e.message.includes('duplicate column')) {
                console.log(`ℹ️ ${e.message}`);
            }
        }
    }

    console.log('⚔️ 기술 상세 정보 수집 및 업데이트 중...');

    const moves = db.prepare('SELECT id FROM moves').all() as { id: number }[];
    const updateMove = db.prepare(`
        UPDATE moves 
        SET description = ?, priority = ?, target = ?, effect_chance = ?
        WHERE id = ?
    `);

    let processed = 0;
    for (const { id } of moves) {
        try {
            const data = await fetchPokeAPI<PokeAPIMoveDetail>(`https://pokeapi.co/api/v2/move/${id}`);

            // 한국어 설명 찾기 (없으면 영어, 개행문자 정리)
            let desc = data.flavor_text_entries.find(e => e.language.name === 'ko')?.flavor_text;
            if (!desc) {
                desc = data.flavor_text_entries.find(e => e.language.name === 'en')?.flavor_text;
            }
            desc = desc ? desc.replace(/\n/g, ' ') : null;

            updateMove.run(
                desc,
                data.priority,
                data.target.name,
                data.effect_chance,
                id
            );

            processed++;
            if (processed % 50 === 0) {
                console.log(`✅ ${processed}/${moves.length} 기술 업데이트 완료`);
            }
        } catch (e) {
            console.error(`❌ 기술 ID ${id} 업데이트 실패:`, e);
        }
    }

    console.log(`✨ 기술 상세 정보 업데이트 완료! (${processed}/${moves.length})`);
}

async function main() {
    try {
        await enrichMovesData();
    } catch (error) {
        console.error('❌ 오류:', error);
    } finally {
        db.close();
    }
}

main();
