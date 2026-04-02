import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { calculateWeaknesses, calculateOffensive } from '@/lib/typeMatchup';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ids = searchParams.getAll('id').map(Number).filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ pokemon: [], chart: {} });
  }

  const db = getDatabase();

  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT p.id, p.name_ko, p.image_url,
           GROUP_CONCAT(t.name_ko ORDER BY pt.slot) AS types
    FROM pokemon p
    LEFT JOIN pokemon_types pt ON p.id = pt.pokemon_id
    LEFT JOIN types t ON pt.type_id = t.id
    WHERE p.id IN (${placeholders})
    GROUP BY p.id
  `).all(ids) as { id: number; name_ko: string; image_url: string; types: string }[];

  // 입력된 id 순서대로 정렬
  const rowMap = new Map(rows.map(r => [r.id, r]));
  const ordered = ids.map(id => rowMap.get(id)).filter(Boolean) as typeof rows;

  const pokemon = ordered.map(r => {
    const types = r.types ? r.types.split(',') : [];
    const effectiveness = calculateWeaknesses(types);
    const offensiveEffectiveness = calculateOffensive(types);
    return {
      id: r.id,
      name_ko: r.name_ko,
      image_url: r.image_url,
      types,
      effectiveness,
      offensiveEffectiveness, // { 노말: 1, 불꽃: 2, ... } — 해당 포켓몬 타입으로 찌를 수 있는 배율
    };
  });

  return NextResponse.json({ pokemon });
}
