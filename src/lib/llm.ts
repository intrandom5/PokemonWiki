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

type StreamChunk = {
    type: 'intent' | 'sql' | 'answer' | 'done' | 'error';
    content: string;
};

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function ensureApiKey() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
    }
}

type ChatCompletionResponse = {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
};

function extractJsonObject(text: string): string | null {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    return text.slice(start, end + 1);
}

function parseIntentJson(text: string): PokemonIntent | null {
    const jsonText = extractJsonObject(text);
    if (!jsonText) return null;

    try {
        const parsed = JSON.parse(jsonText) as { intent?: string };
        const intent = parsed.intent?.trim() as PokemonIntent | undefined;
        if (!intent) return null;

        const validIntents: PokemonIntent[] = ['POKEMON_INFO', 'POKEMON_COMPARE', 'TYPE_MATCHUP', 'RECOMMENDATION', 'UNKNOWN'];
        return validIntents.includes(intent) ? intent : null;
    } catch {
        return null;
    }
}

function parseEntitiesJson(text: string): string[] | null {
    const jsonText = extractJsonObject(text);
    if (!jsonText) return null;

    try {
        const parsed = JSON.parse(jsonText) as { entities?: unknown[] };
        if (!Array.isArray(parsed.entities)) return null;

        return parsed.entities
            .filter((value): value is string => typeof value === 'string')
            .map((name) => name.trim())
            .filter((name) => name.length > 0);
    } catch {
        return null;
    }
}

async function callOpenAI(prompt: string, temperature = 0, stream = false): Promise<Response> {
    ensureApiKey();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            stream,
        }),
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`OpenAI API 오류 (${response.status}): ${detail}`);
    }

    return response;
}

async function generateText(prompt: string, temperature = 0): Promise<string> {
    const response = await callOpenAI(prompt, temperature, false);
    const data = await response.json() as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/**
 * 질문의 의도(Intent)를 분류합니다.
 */
async function classifyQuestion(question: string): Promise<PokemonIntent> {
    const prompt = INTENT_CLASSIFICATION_PROMPT(question);
    const text = await generateText(prompt, 0);
    const parsedIntent = parseIntentJson(text);
    if (parsedIntent) return parsedIntent;

    const intent = text.replace(/["'`]/g, '').trim() as PokemonIntent;
    const validIntents: PokemonIntent[] = ['POKEMON_INFO', 'POKEMON_COMPARE', 'TYPE_MATCHUP', 'RECOMMENDATION', 'UNKNOWN'];

    return validIntents.includes(intent) ? intent : 'UNKNOWN';
}

/**
 * 0단계 A: 질문에서 포켓몬 이름 후보를 추출합니다.
 */
async function extractEntities(question: string): Promise<string[]> {
    const prompt = ENTITY_EXTRACTION_PROMPT(question);
    const text = await generateText(prompt, 0);
    const parsedEntities = parseEntitiesJson(text);
    if (parsedEntities) return parsedEntities.slice(0, 5);

    return text.split(',').map(s => s.trim()).filter(s => s.length > 0);
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
    let sql = await generateText(schemaPrompt, 0);

    // 응답에서 SQL 쿼리만 추출 (코드 블록 등이 있을 수 있음)
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
async function generateAnswer(question: string, sql: string, results: unknown[]): Promise<string> {
    const answerPrompt = ANSWER_GENERATION_PROMPT(question, sql, results);
    return generateText(answerPrompt, 0.3);
}

async function* streamGeneratedAnswer(prompt: string): AsyncGenerator<string> {
    const response = await callOpenAI(prompt, 0.3, true);
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;

            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            try {
                const json = JSON.parse(data) as {
                    choices?: Array<{
                        delta?: { content?: string };
                    }>;
                };
                const delta = json.choices?.[0]?.delta?.content;
                if (delta) {
                    yield delta;
                }
            } catch {
                // 부분 청크 파싱 실패는 무시하고 다음 라인 처리
            }
        }
    }
}

/**
 * 메인 인터페이스: 질문을 분석하고 최종 답변을 반환합니다.
 */
export async function askPokemonWiki(question: string) {
    const db = getDatabase();
    let currentSQL = '';
    let lastError = '';
    const MAX_RETRIES = 2;

    try {
        // 0-1. 의도 분류
        console.log(`[OpenAI] 의도 분류 중: "${question}"`);
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
            console.log(`[OpenAI] 타입 상성 계산 중: "${question}"`);

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

                const response = await generateText(matchupPrompt, 0.3);
                answers.push(response);
            }

            return {
                answer: answers.join('\n\n'),
                sql: typeQuery,
                results: typeResults,
                intent
            };
        }

        // 0-2. 엔티티 추출 및 검증
        console.log(`[OpenAI] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[OpenAI] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated, intent);
                console.log(`[SQL] ${currentSQL}`);

                // 2. DB 실행
                const results = db.prepare(currentSQL).all();
                console.log(`[Result] ${results.length}건 조회됨`);

                // 3. 답변 생성
                console.log(`[OpenAI] 답변 생성 중...`);
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

        return {
            answer: "질문을 분석하는 과정에서 응답을 생성하지 못했습니다.",
            sql: currentSQL,
            results: []
        };
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
export async function* askPokemonWikiStream(question: string): AsyncGenerator<StreamChunk> {
    const db = getDatabase();
    let currentSQL = '';
    let lastError = '';
    const MAX_RETRIES = 2;

    try {
        // 0-1. 의도 분류
        console.log(`[OpenAI] 의도 분류 중: "${question}"`);
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
            console.log(`[OpenAI] 타입 상성 계산 중 (스트리밍): "${question}"`);

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

            for (let index = 0; index < typeResults.length; index++) {
                const result = typeResults[index];
                const types = result.types.split(',');
                const multipliers = calculateWeaknesses(types);
                const formatted = formatWeaknesses(multipliers);

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

                for await (const token of streamGeneratedAnswer(matchupPrompt)) {
                    yield { type: 'answer', content: token };
                }

                if (index < typeResults.length - 1) {
                    yield { type: 'answer', content: '\n\n' };
                }
            }

            yield { type: 'done', content: '' };
            return;
        }

        // 0-2. 엔티티 추출 및 검증
        console.log(`[OpenAI] 엔티티 추출 중: "${question}"`);
        const extracted = await extractEntities(question);
        const validated = await validateEntities(extracted);
        console.log(`[Entities] 추출: [${extracted}], 검증됨: [${validated}]`);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // 1. SQL 생성 (검증된 엔티티 전달)
                console.log(`[OpenAI] SQL 생성 중 (시도 ${attempt}/${MAX_RETRIES}): "${question}"`);
                currentSQL = await generateSQL(question, currentSQL, lastError, validated, intent);
                console.log(`[SQL] ${currentSQL}`);

                // 2. DB 실행
                const results = db.prepare(currentSQL).all();
                console.log(`[Result] ${results.length}건 조회됨`);

                // SQL 정보 전송
                yield { type: 'sql', content: currentSQL };

                // 3. 답변 스트리밍 생성
                const answerPrompt = ANSWER_GENERATION_PROMPT(question, currentSQL, results);

                console.log(`[OpenAI] 스트리밍 답변 생성 중...`);
                for await (const token of streamGeneratedAnswer(answerPrompt)) {
                    yield { type: 'answer', content: token };
                }

                yield { type: 'done', content: '' };
                return;

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

        yield { type: 'error', content: '질문을 분석하는 과정에서 응답을 생성하지 못했습니다.' };
        return;
    } catch (error: any) {
        console.error('LLM 처리 과정 중 오류:', error);
        yield { type: 'error', content: "질문을 분석하는 과정에서 오류가 발생했습니다." };
    }
}
