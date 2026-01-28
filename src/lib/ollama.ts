import { Ollama } from 'ollama';
import { getDatabase } from './db';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL = 'gemma3'; // 사용자님이 지정하신 모델 (gemma2 또는 gemma3)

/**
 * 1단계: 사용자의 질문을 SQL로 변환합니다.
 */
async function generateSQL(question: string): Promise<string> {
    const schemaPrompt = `
당신은 SQLite 전문가입니다. 아래의 테이블 스키마를 바탕으로 사용자의 질문에 답할 수 있는 SQL 쿼리(SELECT)만 생성하세요.

[테이블 스키마 - 정확히 이 테이블과 컬럼만 존재합니다]
1. pokemon (id, national_dex, name_ko, name_en, form_name, generation, image_url, is_default)
   - form_name: 리전폼 이름 (알로라, 가라르 등). 빈 문자열이면 기본 폼.
2. types (id, name_ko, name_en)
3. pokemon_types (pokemon_id, type_id, slot)
4. stats (pokemon_id, hp, attack, defense, sp_attack, sp_defense, speed, total)
5. moves (id, name_ko, name_en, type_id, power, accuracy, pp, damage_class)
6. pokemon_moves (pokemon_id, move_id, learn_method, level_learned)
7. evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition)

[예시 쿼리]
-- 포켓몬 타입 조회 (폼별로 구분):
SELECT p.name_ko, p.form_name, GROUP_CONCAT(t.name_ko) AS types
FROM pokemon p
JOIN pokemon_types pt ON p.id = pt.pokemon_id
JOIN types t ON pt.type_id = t.id
WHERE p.name_ko = '식스테일'
GROUP BY p.id, p.form_name;

-- 스피드 가장 높은 포켓몬:
SELECT p.name_ko, p.form_name, s.speed
FROM pokemon p
JOIN stats s ON p.id = s.pokemon_id
ORDER BY s.speed DESC LIMIT 1;

[주의사항]
- SELECT 쿼리만 출력. 설명/주석 금지.
- 위에 명시된 테이블만 사용하세요. forms 같은 테이블은 존재하지 않습니다.
- 별칭(alias)을 쓸 때 FROM/JOIN에서 정의한 별칭만 SELECT에서 사용하세요.

질문: "${question}"
SQL:`;

    const response = await ollama.generate({
        model: MODEL,
        prompt: schemaPrompt,
        stream: false,
        options: {
            temperature: 0, // SQL 생성이므로 정확도를 위해 0으로 설정
        }
    });

    // 응답에서 SQL 쿼리만 추출 (코드 블록 등이 있을 수 있음)
    let sql = response.response.trim();
    sql = sql.replace(/```sql|```/g, '').trim();

    // 보안을 위해 SELECT 문인지 한 번 더 확인
    if (!sql.toUpperCase().startsWith('SELECT')) {
        throw new Error('비정상적인 쿼리가 생성되었습니다.');
    }

    return sql;
}

/**
 * 2단계: 실행 결과와 질문을 바탕으로 답변을 생성합니다.
 */
async function generateAnswer(question: string, sql: string, results: any[]): Promise<string> {
    const answerPrompt = `
당신은 포켓몬 전문가입니다. 아래의 데이터베이스 조회 결과를 바탕으로 사용자의 질문에 친절하게 한국어로 답변해 주세요.

[질문]
${question}

[실행된 SQL]
${sql}

[조회 결과]
${JSON.stringify(results, null, 2)}

[답변 가이드]
- 질문에 대한 **정확한 팩트**만 간결하게 답변하세요.
- **리전 폼 구분 필수**: 조회 결과에 form_name이 다른 행이 여러 개 있으면, 반드시 각 폼을 구분하여 설명하세요.
  - 예: "질문: 질뻐기의 타입이 뭐야? / 답변: 일반 질뻐기는 독 타입이고, 알로라 질뻐기는 독/악 타입입니다."
  - form_name이 비어있으면 "일반" 또는 "기본 폼"으로 표현하세요.
- 타입 상성은 확실하지 않으면 언급하지 마세요.
- 답변은 한국어로, 핵심 위주로 작성하세요.
`;

    const response = await ollama.generate({
        model: MODEL,
        prompt: answerPrompt,
        stream: false,
    });

    return response.response;
}

/**
 * 메인 인터페이스: 질문을 분석하고 최종 답변을 반환합니다.
 */
export async function askPokemonWiki(question: string) {
    const db = getDatabase();

    try {
        // 1. SQL 생성
        console.log(`[Ollama] SQL 생성 중: "${question}"`);
        const sql = await generateSQL(question);
        console.log(`[SQL] ${sql}`);

        // 2. DB 실행
        const results = db.prepare(sql).all();
        console.log(`[Result] ${results.length}건 조회됨`);

        // 3. 답변 생성
        console.log(`[Ollama] 답변 생성 중...`);
        const answer = await generateAnswer(question, sql, results);

        return {
            answer,
            sql,
            results
        };
    } catch (error: any) {
        console.error('LLM 처리 중 오류:', error);
        return {
            answer: "죄송합니다. 질문을 분석하는 중에 오류가 발생했습니다. (에러: " + error.message + ")",
            sql: "",
            results: []
        };
    }
}
