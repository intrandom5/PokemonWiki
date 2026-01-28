import { initializeDatabase } from '../src/lib/db';
import fs from 'fs';
import path from 'path';

// data 디렉토리 생성
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 data 디렉토리 생성 완료');
}

// 데이터베이스 초기화
console.log('🔧 데이터베이스 초기화 중...');
initializeDatabase();
console.log('✅ 데이터베이스 초기화 완료!');
