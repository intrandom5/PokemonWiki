import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_FILE = 'pokemon.db';

function resolveDatabasePath(): string {
  if (process.env.DATABASE_PATH) {
    return process.env.DATABASE_PATH;
  }

  const candidates = [
    path.join(process.cwd(), 'data', DB_FILE),
    path.join('/var/task', 'data', DB_FILE),
    path.join(__dirname, '..', '..', '..', 'data', DB_FILE),
    path.join(__dirname, '..', '..', 'data', DB_FILE),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `데이터베이스 파일을 찾을 수 없습니다. checked=${candidates.join(', ')} cwd=${process.cwd()}`
  );
}

// 데이터베이스 연결
let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = resolveDatabasePath();
    const readOnly = process.env.DB_READONLY === '1' || process.env.VERCEL === '1';

    db = new Database(dbPath, {
      readonly: readOnly,
      fileMustExist: true,
    });

    if (!readOnly) {
      db.pragma('journal_mode = WAL'); // 로컬 성능 최적화
    }
  }
  return db;
}

// 데이터베이스 초기화 (테이블 생성)
export function initializeDatabase() {
  const db = getDatabase();

  // 포켓몬 기본 정보 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS pokemon (
      id INTEGER PRIMARY KEY,
      national_dex INTEGER NOT NULL,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      form_name TEXT,
      generation INTEGER NOT NULL,
      image_url TEXT,
      is_default BOOLEAN DEFAULT 1
    );
  `);

  // 타입 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS types (
      id INTEGER PRIMARY KEY,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL
    );
  `);

  // 포켓몬-타입 연결 테이블 (다대다)
  db.exec(`
    CREATE TABLE IF NOT EXISTS pokemon_types (
      pokemon_id INTEGER,
      type_id INTEGER,
      slot INTEGER,
      PRIMARY KEY (pokemon_id, type_id),
      FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
      FOREIGN KEY (type_id) REFERENCES types(id)
    );
  `);

  // 능력치 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      pokemon_id INTEGER PRIMARY KEY,
      hp INTEGER,
      attack INTEGER,
      defense INTEGER,
      sp_attack INTEGER,
      sp_defense INTEGER,
      speed INTEGER,
      total INTEGER,
      FOREIGN KEY (pokemon_id) REFERENCES pokemon(id)
    );
  `);

  // 기술 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS moves (
      id INTEGER PRIMARY KEY,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      type_id INTEGER,
      power INTEGER,
      accuracy INTEGER,
      pp INTEGER,
      damage_class TEXT,
      FOREIGN KEY (type_id) REFERENCES types(id)
    );
  `);

  // 포켓몬-기술 연결 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS pokemon_moves (
      pokemon_id INTEGER,
      move_id INTEGER,
      learn_method TEXT,
      level_learned INTEGER,
      PRIMARY KEY (pokemon_id, move_id, learn_method),
      FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
      FOREIGN KEY (move_id) REFERENCES moves(id)
    );
  `);

  // 진화 정보 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS evolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_pokemon_id INTEGER,
      to_pokemon_id INTEGER,
      trigger TEXT,
      min_level INTEGER,
      item TEXT,
      condition TEXT,
      FOREIGN KEY (from_pokemon_id) REFERENCES pokemon(id),
      FOREIGN KEY (to_pokemon_id) REFERENCES pokemon(id)
    );
  `);

  // 특성 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS abilities (
      id INTEGER PRIMARY KEY,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description TEXT
    );
  `);

  // 포켓몬-특성 연결 테이블
  db.exec(`
    CREATE TABLE IF NOT EXISTS pokemon_abilities (
      pokemon_id INTEGER,
      ability_id INTEGER,
      is_hidden BOOLEAN,
      slot INTEGER,
      PRIMARY KEY (pokemon_id, ability_id),
      FOREIGN KEY (pokemon_id) REFERENCES pokemon(id),
      FOREIGN KEY (ability_id) REFERENCES abilities(id)
    );
  `);

  // 인덱스 생성 (검색 성능 향상)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pokemon_name_ko ON pokemon(name_ko);
    CREATE INDEX IF NOT EXISTS idx_pokemon_generation ON pokemon(generation);
    CREATE INDEX IF NOT EXISTS idx_pokemon_national_dex ON pokemon(national_dex);
  `);

  console.log('✅ 데이터베이스 테이블 생성 완료');
}

// 데이터베이스 닫기
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
