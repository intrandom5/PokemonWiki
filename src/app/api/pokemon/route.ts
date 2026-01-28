import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export async function GET(request: NextRequest) {
    const db = getDatabase();
    const { searchParams } = new URL(request.url);

    // 쿼리 파라미터
    const generation = searchParams.get('generation');
    const types = searchParams.getAll('type'); // 복수 타입 필터
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '30');
    const offset = (page - 1) * limit;

    console.log('[API] 요청 파라미터:', { generation, types, page, limit });

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

        // 세대 필터
        if (generation) {
            conditions.push('p.generation = ?');
            params.push(parseInt(generation));
        }

        // 타입 필터 (복수 타입 지원)
        if (types.length > 0) {
            const typePlaceholders = types.map(() => '?').join(', ');
            conditions.push(`p.id IN (
                SELECT pt2.pokemon_id FROM pokemon_types pt2
                JOIN types t2 ON pt2.type_id = t2.id
                WHERE t2.name_ko IN (${typePlaceholders})
            )`);
            params.push(...types);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY p.id ORDER BY p.national_dex, p.id';
        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        console.log('[API] SQL:', query);
        console.log('[API] Params:', params);

        const pokemon = db.prepare(query).all(params);

        // 전체 카운트 (페이지네이션용)
        const totalCount = db.prepare('SELECT COUNT(*) as count FROM pokemon').get() as { count: number };

        return NextResponse.json({
            data: pokemon,
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
