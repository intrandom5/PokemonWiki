import { Ollama } from 'ollama';
import { getDatabase } from './db';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL = 'gemma3'; // 사용자님이 지정하신 모델 (gemma2 또는 gemma3)

/**
 * 0단계 A: 질문에서 포켓몬 이름 후보를 추출합니다.
 */
async function extractEntities(question: string): Promise<string[]> {
    const prompt = `
당신은 포켓몬 언어 모델입니다. 사용자의 질문에서 포켓몬의 이름(또는 이름의 일부)만 추출하여 쉼표(,)로 구분된 목록으로 출력하세요.
포켓몬 이름이 아닌 단어는 무시하세요.

질문: "피카츄와 파이리의 공격력을 비교해줘"
추출: 피카츄, 파이리

질문: "갸라도스 타입의 약점이 뭐야?"
추출: 갸라도스

질문: "알로라 식스테일의 특성이 뭐야?"
추출: 식스테일, 알로라

질문: "${question}"
추출:`;

    const response = await ollama.generate({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: { temperature: 0 }
    });

    return response.response.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * 0단계 B: 추출된 후보군을 DB에서 검색하여 실제 이름을 확인합니다.
 */
async function validateEntities(entities: string[]): Promise<string[]> {
    const db = getDatabase();
    const validated: string[] = [];

    for (const entity of entities) {
        // 정확히 일치하거나, 포함하는 이름 검색 (LIKE)
        const rows = db.prepare(`
            SELECT DISTINCT name_ko 
            FROM pokemon 
            WHERE name_ko LIKE ? OR name_ko LIKE ?
            LIMIT 3
        `).all(`%${entity}%`, `%${entity.replace(/알로라|가라르|히스이|팔데아/g, '').trim()}%`) as { name_ko: string }[];

        rows.forEach(row => {
            if (!validated.includes(row.name_ko)) {
                validated.push(row.name_ko);
            }
        });
    }

    return validated;
}

/**
 * 1단계: 사용자의 질문을 SQL로 변환합니다.
 */
async function generateSQL(question: string, previousSQL?: string, previousError?: string, validatedEntities: string[] = []): Promise<string> {
    const entityContext = validatedEntities.length > 0
        ? `\n[참고: 질문과 관련된 포켓몬 이름 후보] ${validatedEntities.join(', ')}\n`
        : '';

    const errorFeedback = previousError ? `
[이전 시도 실패]
- 생성했던 SQL: ${previousSQL}
- 에러 메시지: ${previousError}
- 주의: 위 에러를 분석하여 올바른 SQLite 전용 SQL을 다시 생성하세요.
` : '';

    const schemaPrompt = `
당신은 SQLite 전문가입니다. 아래의 테이블 스키마와 제공된 포켓몬 이름을 바탕으로 사용자의 질문에 답할 수 있는 SQL 쿼리(SELECT)만 생성하세요.
${entityContext}${errorFeedback}
[테이블 스키마 - 정확히 이 테이블과 컬럼만 존재합니다]
1. pokemon (id, national_dex, name_ko, name_en, form_name, generation, image_url, is_default)
   - form_name: 리전폼 이름 (알로라, 가라르 등). 빈 문자열이면 기본 폼.
2. types (id, name_ko, name_en)
3. pokemon_types (pokemon_id, type_id, slot)
4. stats (pokemon_id, hp, attack, defense, sp_attack, sp_defense, speed, total) - 포켓몬 능력치/종족값 정보
5. moves (id, name_ko, name_en, type_id, power, accuracy, pp, damage_class)
6. pokemon_moves (pokemon_id, move_id, learn_method, level_learned)
7. evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition)
8. abilities (id, name_ko, name_en, description) - 포켓몬 특성 정보
9. pokemon_abilities (pokemon_id, ability_id, is_hidden, slot) - 포켓몬이 가진 특성 연결

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

-- 포켓몬 특성 조회 (is_hidden=1이면 숨겨진 특성):
SELECT p.name_ko, p.form_name, a.name_ko AS ability_name, pa.is_hidden
FROM pokemon p
JOIN pokemon_abilities pa ON p.id = pa.pokemon_id
JOIN abilities a ON pa.ability_id = a.id
WHERE p.name_ko = '번치코';

[주의사항]
- SELECT 쿼리만 출력. 설명/주석 금지.
- 위에 명시된 테이블만 사용하세요. forms 같은 테이블은 존재하지 않습니다.
- "특성"을 물어보면 abilities 테이블을 사용하세요. stats(능력치)와 혼동하지 마세요.
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
        throw new Error('비정상적인 쿼리가 생성되었습니다. SELECT 쿼리만 가능합니다.');
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
    let currentSQL = '';
    let lastError = '';
    const MAX_RETRIES = 3;

    try {
        // 0. 엔티티 추출 및 검증
        console.log(`[Ollama] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[Ollama] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated);
                console.log(`[SQL] ${currentSQL}`);

                // 2. DB 실행
                const results = db.prepare(currentSQL).all();
                console.log(`[Result] ${results.length}건 조회됨`);

                // 3. 답변 생성
                console.log(`[Ollama] 답변 생성 중...`);
                const answer = await generateAnswer(question, currentSQL, results);

                return {
                    answer,
                    sql: currentSQL,
                    results
                };
            } catch (error: any) {
                console.error(`[Attempt ${attempt}] LLM 처리 중 오류:`, error.message);
                lastError = error.message;

                if (attempt === MAX_RETRIES) {
                    return {
                        answer: `죄송합니다. ${MAX_RETRIES}번의 시도 끝에 질문을 분석하는 데 실패했습니다. (마지막 에러: ${error.message})`,
                        sql: currentSQL,
                        results: []
                    };
                }
                console.log(`[Retry] 에러를 바탕으로 다시 시도합니다...`);
            }
        }
    } catch (error: any) {
        console.error('엔티티 처리 중 오류:', error);
        return {
            answer: "질문을 분석하는 과정에서 오류가 발생했습니다.",
            sql: "",
            results: []
        };
    }
}

/**
 * 스트리밍 버전: 답변을 실시간으로 생성합니다.
 */
export async function* askPokemonWikiStream(question: string) {
    const db = getDatabase();
    let currentSQL = '';
    let lastError = '';
    const MAX_RETRIES = 3;

    try {
        // 0. 엔티티 추출 및 검증
        console.log(`[Ollama] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[Ollama] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated);
                console.log(`[SQL] ${currentSQL}`);

                // 2. DB 실행
                const results = db.prepare(currentSQL).all();
                console.log(`[Result] ${results.length}건 조회됨`);

                // SQL 정보 먼저 전송
                yield { type: 'sql', content: currentSQL };

                // 3. 답변 스트리밍 생성
                const answerPrompt = `
당신은 포켓몬 전문가입니다. 아래의 데이터베이스 조회 결과를 바탕으로 사용자의 질문에 친절하게 한국어로 답변해 주세요.

[질문]
${question}

[실행된 SQL]
${currentSQL}

[조회 결과]
${JSON.stringify(results, null, 2)}

[답변 가이드]
- 질문에 대한 **정확한 팩트**만 간결하게 답변하세요.
- **리전 폼 구분 필수**: 조회 결과에 form_name이 다른 행이 여러 개 있으면, 반드시 각 폼을 구분하여 설명하세요.
- form_name이 비어있으면 "일반" 또는 "기본 폼"으로 표현하세요.
- 답변은 한국어로, 핵심 위주로 작성하세요.
`;

                console.log(`[Ollama] 스트리밍 답변 생성 중...`);
                const stream = await ollama.generate({
                    model: MODEL,
                    prompt: answerPrompt,
                    stream: true,
                });

                for await (const chunk of stream) {
                    yield { type: 'answer', content: chunk.response };
                }

                yield { type: 'done', content: '' };
                return; // 성공 시 종료

            } catch (error: any) {
                console.error(`[Attempt ${attempt}] LLM 처리 중 오류:`, error.message);
                lastError = error.message;

                if (attempt === MAX_RETRIES) {
                    yield { type: 'error', content: `최대 재시도 횟수를 초과했습니다. (에러: ${error.message})` };
                    return;
                }
                console.log(`[Retry] 에러를 바탕으로 다시 시도합니다...`);
            }
        }
    } catch (error: any) {
        console.error('엔티티 처리 중 오류:', error);
        yield { type: 'error', content: "질문을 분석하는 과정에서 오류가 발생했습니다." };
    }
}
