import { Ollama } from 'ollama';
import { getDatabase } from './db';
import {
    ENTITY_EXTRACTION_PROMPT,
    SQL_GENERATION_PROMPT,
    ANSWER_GENERATION_PROMPT,
    INTENT_CLASSIFICATION_PROMPT,
    TYPE_MATCHUP_ANSWER_PROMPT
} from './prompts';
import { calculateWeaknesses, formatWeaknesses } from './typeMatchup';

export type PokemonIntent = 'POKEMON_INFO' | 'POKEMON_COMPARE' | 'TYPE_MATCHUP' | 'RECOMMENDATION' | 'UNKNOWN';

const ollama = new Ollama({ host: 'http://localhost:11434' });
const MODEL = 'gemma3'; // 사용자님이 지정하신 모델 (gemma2 또는 gemma3)

/**
 * 질문의 의도(Intent)를 분류합니다.
 */
async function classifyQuestion(question: string): Promise<PokemonIntent> {
    const prompt = INTENT_CLASSIFICATION_PROMPT(question);

    const response = await ollama.generate({
        model: MODEL,
        prompt: prompt,
        stream: false,
        options: { temperature: 0 }
    });

    const intent = response.response.trim() as PokemonIntent;
    const validIntents: PokemonIntent[] = ['POKEMON_INFO', 'POKEMON_COMPARE', 'TYPE_MATCHUP', 'RECOMMENDATION', 'UNKNOWN'];

    return validIntents.includes(intent) ? intent : 'UNKNOWN';
}

/**
 * 0단계 A: 질문에서 포켓몬 이름 후보를 추출합니다.
 */
async function extractEntities(question: string): Promise<string[]> {
    const prompt = ENTITY_EXTRACTION_PROMPT(question);

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
async function generateSQL(question: string, previousSQL?: string, previousError?: string, validatedEntities: string[] = [], intent: string = 'UNKNOWN'): Promise<string> {
    const entityContext = validatedEntities.length > 0
        ? `\n[참고: 질문과 관련된 포켓몬 이름 후보] ${validatedEntities.join(', ')}\n`
        : '';

    const errorFeedback = previousError ? `
[이전 시도 실패]
- 생성했던 SQL: ${previousSQL}
- 에러 메시지: ${previousError}
- 주의: 위 에러를 분석하여 올바른 SQLite 전용 SQL을 다시 생성하세요.
` : '';

    const schemaPrompt = SQL_GENERATION_PROMPT(question, entityContext, errorFeedback, intent);

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
    const answerPrompt = ANSWER_GENERATION_PROMPT(question, sql, results);

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
        // 0-1. 의도 분류
        console.log(`[Ollama] 의도 분류 중: "${question}"`);
        const intent = await classifyQuestion(question);
        console.log(`[Intent] ${intent}`);

        // 추천인 경우 별도 처리 (현재는 간단한 메시지 또는 placeholder)
        if (intent === 'RECOMMENDATION') {
            return {
                answer: "추천 기능은 현재 고도화 작업 중입니다. 곧 더 똑똑한 포켓몬 추천을 받아보실 수 있어요!",
                sql: "",
                results: [],
                intent
            };
        }

        if (intent === 'UNKNOWN') {
            return {
                answer: "죄송합니다. 포켓몬과 관련이 없거나 제가 현재 답변드리기 어려운 질문입니다.",
                sql: "",
                results: [],
                intent
            };
        }

        // TYPE_MATCHUP 처리
        if (intent === 'TYPE_MATCHUP') {
            console.log(`[Ollama] 타입 상성 계산 중: "${question}"`);

            // 엔티티 추출 및 검증
            const extracted = await extractEntities(question);
            const validated = await validateEntities(extracted);

            if (validated.length === 0) {
                return {
                    answer: "포켓몬 이름을 찾을 수 없습니다. 정확한 포켓몬 이름을 입력해주세요.",
                    sql: "",
                    results: [],
                    intent
                };
            }

            // 첫 번째 포켓몬의 타입 조회
            const pokemonName = validated[0];
            const typeQuery = `
                SELECT p.name_ko, p.form_name, GROUP_CONCAT(t.name_ko) AS types
                FROM pokemon p
                JOIN pokemon_types pt ON p.id = pt.pokemon_id
                JOIN types t ON pt.type_id = t.id
                WHERE p.name_ko = ?
                GROUP BY p.id, p.form_name
            `;

            const typeResults = db.prepare(typeQuery).all(pokemonName) as Array<{
                name_ko: string;
                form_name: string;
                types: string;
            }>;

            if (typeResults.length === 0) {
                return {
                    answer: `${pokemonName}의 정보를 찾을 수 없습니다.`,
                    sql: typeQuery,
                    results: [],
                    intent
                };
            }

            // 각 폼별로 상성 계산
            const answers: string[] = [];


            for (const result of typeResults) {
                const types = result.types.split(',');
                const multipliers = calculateWeaknesses(types);
                const formatted = formatWeaknesses(multipliers);

                // 데이터를 코드가 직접 조립 (할루시네이션 방지)
                const formName = result.form_name ? `${result.form_name} ` : '';
                const fullName = `${formName}${result.name_ko}`;

                let summary = `${fullName}의 타입은 ${types.join('/')}입니다.\n\n`;

                if (formatted.x4_weakness.length > 0) {
                    summary += `⚠️ **4배 데미지 (치명적 약점)**: ${formatted.x4_weakness.join(', ')}\n`;
                } else {
                    summary += `• 4배 데미지 약점: 없음\n`;
                }

                summary += `• 2배 데미지 (주요 약점): ${formatted.x2_weakness.join(', ') || '없음'}\n`;

                const resistances = [...formatted.x0_5_resistance, ...formatted.x0_25_resistance];
                summary += `• 저항 (데미지 반감): ${resistances.join(', ') || '없음'}\n`;

                if (formatted.x0_immunity.length > 0) {
                    summary += `• 효과 없음 (0배 데미지): ${formatted.x0_immunity.join(', ')}\n`;
                }

                const matchupPrompt = TYPE_MATCHUP_ANSWER_PROMPT(
                    fullName,
                    types,
                    summary
                );

                const response = await ollama.generate({
                    model: MODEL,
                    prompt: matchupPrompt,
                    stream: false,
                });

                answers.push(response.response);
            }

            return {
                answer: answers.join('\n\n'),
                sql: typeQuery,
                results: typeResults,
                intent
            };
        }

        // 0-2. 엔티티 추출 및 검증
        console.log(`[Ollama] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[Ollama] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated, intent);
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
                    results,
                    intent
                };
            } catch (error: any) {
                console.error(`[Attempt ${attempt}] LLM 처리 중 오류:`, error.message);
                lastError = error.message;

                if (attempt === MAX_RETRIES) {
                    return {
                        answer: `죄송합니다. ${MAX_RETRIES}번의 시도 끝에 질문을 분석하는 데 실패했습니다. (마지막 에러: ${error.message})`,
                        sql: currentSQL,
                        results: [],
                        intent
                    };
                }
                console.log(`[Retry] 에러를 바탕으로 다시 시도합니다...`);
            }
        }
    } catch (error: any) {
        console.error('LLM 처리 과정 중 오류:', error);
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
        // 0-1. 의도 분류
        console.log(`[Ollama] 의도 분류 중: "${question}"`);
        const intent = await classifyQuestion(question);
        console.log(`[Intent] ${intent}`);

        yield { type: 'intent', content: intent };

        if (intent === 'RECOMMENDATION') {
            yield { type: 'answer', content: "추천 기능은 현재 고도화 작업 중입니다. 곧 더 똑똑한 포켓몬 추천을 받아보실 수 있어요!" };
            yield { type: 'done', content: '' };
            return;
        }

        if (intent === 'UNKNOWN') {
            yield { type: 'answer', content: "죄송합니다. 포켓몬과 관련이 없거나 제가 현재 답변드리기 어려운 질문입니다." };
            yield { type: 'done', content: '' };
            return;
        }

        // TYPE_MATCHUP 처리
        if (intent === 'TYPE_MATCHUP') {
            console.log(`[Ollama] 타입 상성 계산 중 (스트리밍): "${question}"`);

            const extracted = await extractEntities(question);
            const validated = await validateEntities(extracted);

            if (validated.length === 0) {
                yield { type: 'answer', content: "포켓몬 이름을 찾을 수 없습니다. 정확한 포켓몬 이름을 입력해주세요." };
                yield { type: 'done', content: '' };
                return;
            }

            const pokemonName = validated[0];
            const typeQuery = `
                SELECT p.name_ko, p.form_name, GROUP_CONCAT(t.name_ko) AS types
                FROM pokemon p
                JOIN pokemon_types pt ON p.id = pt.pokemon_id
                JOIN types t ON pt.type_id = t.id
                WHERE p.name_ko = ?
                GROUP BY p.id, p.form_name
            `;

            const typeResults = db.prepare(typeQuery).all(pokemonName) as Array<{
                name_ko: string;
                form_name: string;
                types: string;
            }>;

            if (typeResults.length === 0) {
                yield { type: 'answer', content: `${pokemonName}의 정보를 찾을 수 없습니다.` };
                yield { type: 'done', content: '' };
                return;
            }

            yield { type: 'sql', content: typeQuery };

            for (const result of typeResults) {
                const types = result.types.split(',');
                const multipliers = calculateWeaknesses(types);
                const formatted = formatWeaknesses(multipliers);

                // 데이터를 코드가 직접 조립 (할루시네이션 방지)
                const formName = result.form_name ? `${result.form_name} ` : '';
                const fullName = `${formName}${result.name_ko}`;

                let summary = `${fullName}의 타입은 ${types.join('/')}입니다.\n\n`;

                if (formatted.x4_weakness.length > 0) {
                    summary += `⚠️ **4배 데미지 (치명적 약점)**: ${formatted.x4_weakness.join(', ')}\n`;
                } else {
                    summary += `• 4배 데미지 약점: 없음\n`;
                }

                summary += `• 2배 데미지 (주요 약점): ${formatted.x2_weakness.join(', ') || '없음'}\n`;

                const resistances = [...formatted.x0_5_resistance, ...formatted.x0_25_resistance];
                summary += `• 저항 (데미지 반감): ${resistances.join(', ') || '없음'}\n`;

                if (formatted.x0_immunity.length > 0) {
                    summary += `• 효과 없음 (0배 데미지): ${formatted.x0_immunity.join(', ')}\n`;
                }

                const matchupPrompt = TYPE_MATCHUP_ANSWER_PROMPT(
                    fullName,
                    types,
                    summary
                );

                const stream = await ollama.generate({
                    model: MODEL,
                    prompt: matchupPrompt,
                    stream: true,
                });

                for await (const chunk of stream) {
                    yield { type: 'answer', content: chunk.response };
                }

                if (typeResults.length > 1) {
                    yield { type: 'answer', content: '\n\n' };
                }
            }

            yield { type: 'done', content: '' };
            return;
        }

        // 0-2. 엔티티 추출 및 검증
        console.log(`[Ollama] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[Ollama] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated, intent);
                console.log(`[SQL] ${currentSQL}`);

                // 2. DB 실행
                const results = db.prepare(currentSQL).all();
                console.log(`[Result] ${results.length}건 조회됨`);

                // SQL 정보 전송
                yield { type: 'sql', content: currentSQL };

                // 3. 답변 스트리밍 생성
                const answerPrompt = ANSWER_GENERATION_PROMPT(question, currentSQL, results);

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
        console.error('LLM 처리 과정 중 오류:', error);
        yield { type: 'error', content: "질문을 분석하는 과정에서 오류가 발생했습니다." };
    }
}
