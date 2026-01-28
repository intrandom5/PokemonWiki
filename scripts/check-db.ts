import { getDatabase } from '../src/lib/db';

const db = getDatabase();

console.log('--- 수집된 포켓몬 목록 ---');
const pokemon = db.prepare('SELECT id, name_ko, form_name, generation FROM pokemon').all();
console.table(pokemon);

console.log('\n--- 수집된 타입 목록 ---');
const types = db.prepare('SELECT * FROM types').all();
console.table(types);

console.log('\n--- 수집된 기술 수 ---');
const moveCount = db.prepare('SELECT COUNT(*) as count FROM moves').get() as { count: number };
console.log(`총 ${moveCount.count}개의 기술이 저장됨`);

db.close();
