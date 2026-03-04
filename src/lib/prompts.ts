/**
 * 질문 분류(Intent Classification)를 위한 프롬프트
 */
export const INTENT_CLASSIFICATION_PROMPT = (question: string) => `
너는 포켓몬 질문 분류기다.
아래 중 하나로 분류하고 JSON만 출력해라.

카테고리:
- POKEMON_INFO: 포켓몬 정보 조회
- POKEMON_COMPARE: 포켓몬 비교
- TYPE_MATCHUP: 타입 상성/약점/저항 질문
- RECOMMENDATION: 추천/파티 구성
- UNKNOWN: 위에 해당 없음

출력 형식(설명 금지):
{"intent":"POKEMON_INFO"}

질문: "${question}"`;

/**
 * 0단계 A: 질문에서 포켓몬 이름 후보를 추출하기 위한 프롬프트
 */
export const ENTITY_EXTRACTION_PROMPT = (question: string) => `
질문에서 포켓몬 이름(또는 이름 일부) 후보만 뽑아 JSON으로 출력해라.
- 포켓몬이 아닌 단어는 제외
- 최대 5개
- 중복 제거

출력 형식(설명 금지):
{"entities":["피카츄","파이리"]}

질문: "${question}"`;

/**
 * 1단계: 사용자의 질문을 SQL로 변환하기 위한 프롬프트
 */
export const SQL_GENERATION_PROMPT = (question: string, entityContext: string, errorFeedback: string, intent: string) => `
너는 SQLite 쿼리 생성기다.
질문과 의도에 맞는 SQL SELECT 하나만 출력해라.

의도: ${intent}
${entityContext}${errorFeedback}

테이블:
- pokemon (id, national_dex, name_ko, name_en, form_name, generation, image_url, is_default)
- types (id, name_ko, name_en)
- pokemon_types (pokemon_id, type_id, slot)
- stats (pokemon_id, hp, attack, defense, sp_attack, sp_defense, speed, total)
- moves (id, name_ko, name_en, type_id, power, accuracy, pp, damage_class)
- pokemon_moves (pokemon_id, move_id, learn_method, level_learned)
- evolutions (from_pokemon_id, to_pokemon_id, trigger, min_level, item, condition)
- abilities (id, name_ko, name_en, description)
- pokemon_abilities (pokemon_id, ability_id, is_hidden, slot)

규칙:
- SELECT만 허용 (설명/주석/코드블록 금지)
- TYPE_MATCHUP 의도면 타입 조회 쿼리 생성
- "특성"은 abilities/pokemon_abilities를 사용
- form_name이 있으면 폼 구분이 가능하도록 조회

질문: "${question}"`;

/**
 * 2단계: 실행 결과와 질문을 바탕으로 답변을 생성하기 위한 프롬프트
 */
export const ANSWER_GENERATION_PROMPT = (question: string, sql: string, results: unknown[]) => `
아래 DB 결과만 사용해 한국어로 간결하게 답변해라.
- 결과에 없는 정보 추측 금지
- form_name이 여러 값이면 폼별로 구분해서 답변
- 핵심만 2~6문장

[질문]
${question}

[실행된 SQL]
${sql}

[조회 결과]
${JSON.stringify(results, null, 2)}
`;

/**
 * 타입 상성 답변 생성을 위한 프롬프트
 */
export const TYPE_MATCHUP_ANSWER_PROMPT = (pokemonName: string, types: string[], summary: string) => `
아래 타입 상성 요약만 기반으로 한국어 답변을 작성해라.
- 요약의 사실을 빠짐없이 포함
- 4배 약점은 경고로 강조
- 요약에 없는 내용 추가 금지

타입 상성 요약:
${summary}
`;
