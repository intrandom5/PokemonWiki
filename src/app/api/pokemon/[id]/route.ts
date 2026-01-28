import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

interface Params {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
    const db = getDatabase();
    const { id } = await params;
    const pokemonId = parseInt(id);

    try {
        // 기본 정보
        const pokemon = db.prepare(`
            SELECT 
                p.id, p.national_dex, p.name_ko, p.name_en, p.form_name, 
                p.generation, p.image_url, p.is_default
            FROM pokemon p
            WHERE p.id = ?
        `).get(pokemonId) as any;

        if (!pokemon) {
            return NextResponse.json({ error: '포켓몬을 찾을 수 없습니다.' }, { status: 404 });
        }

        // 타입
        const types = db.prepare(`
            SELECT t.name_ko, t.name_en
            FROM pokemon_types pt
            JOIN types t ON pt.type_id = t.id
            WHERE pt.pokemon_id = ?
            ORDER BY pt.slot
        `).all(pokemonId);

        // 능력치
        const stats = db.prepare(`
            SELECT hp, attack, defense, sp_attack, sp_defense, speed, total
            FROM stats WHERE pokemon_id = ?
        `).get(pokemonId);

        // 특성
        const abilities = db.prepare(`
            SELECT a.name_ko, a.name_en, a.description, pa.is_hidden
            FROM pokemon_abilities pa
            JOIN abilities a ON pa.ability_id = a.id
            WHERE pa.pokemon_id = ?
        `).all(pokemonId);

        // 배우는 기술 (습득 방식별로 분류)
        const allMoves = db.prepare(`
            SELECT m.name_ko, m.power, m.accuracy, m.pp, m.damage_class, 
                   pm.level_learned, pm.learn_method, t.name_ko as type_name
            FROM pokemon_moves pm
            JOIN moves m ON pm.move_id = m.id
            LEFT JOIN types t ON m.type_id = t.id
            WHERE pm.pokemon_id = ?
            ORDER BY pm.learn_method, pm.level_learned, m.name_ko
        `).all(pokemonId) as any[];

        // 습득 방식별로 그룹화
        const movesByMethod: Record<string, any[]> = {
            'level-up': [],
            'machine': [],
            'egg': [],
            'tutor': [],
            'other': []
        };

        for (const move of allMoves) {
            const method = move.learn_method;
            if (movesByMethod[method]) {
                movesByMethod[method].push(move);
            } else {
                movesByMethod['other'].push(move);
            }
        }

        // 진화 정보 - 전체 진화 체인 가져오기
        // 1. 먼저 진화 체인의 시작점(1단계)을 찾습니다
        const findRootQuery = `
            WITH RECURSIVE chain AS (
                SELECT from_pokemon_id as pokemon_id, from_pokemon_id, to_pokemon_id
                FROM evolutions WHERE to_pokemon_id = ?
                UNION ALL
                SELECT e.from_pokemon_id, e.from_pokemon_id, e.to_pokemon_id
                FROM evolutions e
                JOIN chain c ON e.to_pokemon_id = c.from_pokemon_id
            )
            SELECT pokemon_id FROM chain
            UNION SELECT ? as pokemon_id
            ORDER BY pokemon_id ASC LIMIT 1
        `;
        const rootResult = db.prepare(findRootQuery).get(pokemon.national_dex, pokemon.national_dex) as { pokemon_id: number } | undefined;
        const rootDex = rootResult?.pokemon_id || pokemon.national_dex;

        // 2. 시작점부터 모든 진화 단계 가져오기
        const evolutions = db.prepare(`
            WITH RECURSIVE evo_chain AS (
                SELECT from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition, 1 as step
                FROM evolutions WHERE from_pokemon_id = ?
                UNION ALL
                SELECT e.from_pokemon_id, e.to_pokemon_id, e.trigger, e.min_level, e.item, e.condition, ec.step + 1
                FROM evolutions e
                JOIN evo_chain ec ON e.from_pokemon_id = ec.to_pokemon_id
            )
            SELECT DISTINCT
                p_from.name_ko as from_name,
                p_from.national_dex as from_dex,
                p_to.name_ko as to_name,
                p_to.national_dex as to_dex,
                p_to.image_url as to_image,
                ec.trigger, ec.min_level, ec.item, ec.condition, ec.step
            FROM evo_chain ec
            LEFT JOIN pokemon p_from ON ec.from_pokemon_id = p_from.national_dex AND p_from.is_default = 1
            LEFT JOIN pokemon p_to ON ec.to_pokemon_id = p_to.national_dex AND p_to.is_default = 1
            ORDER BY ec.step, ec.from_pokemon_id
        `).all(rootDex);

        return NextResponse.json({
            ...pokemon,
            types,
            stats,
            abilities,
            moves: movesByMethod,
            evolutions
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
