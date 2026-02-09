import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET(request: NextRequest) {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    // 쿼리 파라미터
    const generations = searchParams.getAll('generation'); // 다중 세대 필터
    const types = searchParams.getAll('type'); // 복수 타입 필터
    const name = searchParams.get('name') || ''; // 이름 검색
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '30');
    const offset = (page - 1) * limit;

    console.log('[API] 요청 파라미터:', { generations, types, name, page, limit });

    try {
        let query = `
            SELECT DISTINCT 
                p.id,
                p.national_dex,
                p.name_ko,
                p.form_name,
                p.generation,
                p.image_url,
                GROUP_CONCAT(DISTINCT t.name_ko) AS types
            FROM pokemon p
            LEFT JOIN pokemon_types pt ON p.id = pt.pokemon_id
            LEFT JOIN types t ON pt.type_id = t.id
        `;

        const conditions: string[] = [];
        const params: any[] = [];

        // 세대 필터 (다중 세대 지원)
        if (generations.length > 0) {
            const genPlaceholders = generations.map(() => '?').join(', ');
            conditions.push(`p.generation IN (${genPlaceholders})`);
            params.push(...generations.map(g => parseInt(g)));
        }

        // 타입 필터 (복수 타입 선택 시 교합/AND 검색)
        if (types.length > 0) {
            const typePlaceholders = types.map(() => '?').join(', ');
            conditions.push(`p.id IN (
                SELECT pt2.pokemon_id 
                FROM pokemon_types pt2
                JOIN types t2 ON pt2.type_id = t2.id
                WHERE t2.name_ko IN (${typePlaceholders})
                GROUP BY pt2.pokemon_id
                HAVING COUNT(DISTINCT t2.id) = ?
            )`);
            params.push(...types, types.length);
        }

        // 이름 검색 (한글 또는 영어)
        if (name) {
            conditions.push(`(p.name_ko LIKE ? OR p.name_en LIKE ?)`);
            params.push(`%${name}%`, `%${name}%`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY p.id ORDER BY p.national_dex, p.id';
        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        console.log('[API] SQL:', query);
        console.log('[API] Params:', params);

        const rows = db.prepare(query).all(params);

        // 전체 카운트 (페이지네이션용, 필터 조건 반영)
        let countQuery = 'SELECT COUNT(DISTINCT p.id) as count FROM pokemon p LEFT JOIN pokemon_types pt ON p.id = pt.pokemon_id LEFT JOIN types t ON pt.type_id = t.id';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }

        // 카운트용 파라미터에서는 LIMIT, OFFSET 파라미터(마지막 2개)를 제외
        const countParams = params.slice(0, -2);
        const totalCount = db.prepare(countQuery).get(countParams) as { count: number };

        return NextResponse.json({
            data: rows,
            pagination: {
                page,
                limit,
                total: totalCount.count,
                totalPages: Math.ceil(totalCount.count / limit)
            }
        });
    } catch (error: any) {
        console.error('[API] 오류:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
