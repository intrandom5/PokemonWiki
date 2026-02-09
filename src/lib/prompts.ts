/**
 * 질문 분류(Intent Classification)를 위한 프롬프트
 */
export const INTENT_CLASSIFICATION_PROMPT = (question: string) => `
사용자의 포켓몬 관련 질문을 아래 카테고리 중 하나로 분류하세요. 
출력은 반드시 카테고리 이름만 하세요. (설명 금지)

[카테고리]
- POKEMON_INFO: 포켓몬의 타입, 종족값, 진화, 기술, 특성 등 단일/복수 포켓몬의 기본 정보 조회
- POKEMON_COMPARE: 두 포켓몬 이상의 능력치나 특징을 비교 (누가 더 높은지, 누가 더 빠른지 등)
- TYPE_MATCHUP: 약점, 저항, 상성 배율 등 타입 간의 상성 관계 질문
- RECOMMENDATION: 특정 상황이나 컨셉에 맞는 포켓몬 추천 또는 파티 구성 제안
- UNKNOWN: 위의 카테고리에 해당하지 않거나 판단이 불가능한 경우

[예시]
질문: "피카츄의 타입이 뭐야?"
분류: POKEMON_INFO

질문: "갸라도스와 밀로틱 중 누가 더 방어력이 높아?"
분류: POKEMON_COMPARE

질문: "리자몽의 약점이 뭐야?"
분류: TYPE_MATCHUP

질문: "비파티에 어울리는 포켓몬 알려줘"
분류: RECOMMENDATION

질문: "${question}"
분류:`;

/**
 * 0단계 A: 질문에서 포켓몬 이름 후보를 추출하기 위한 프롬프트
 */
export const ENTITY_EXTRACTION_PROMPT = (question: string) => `
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

/**
 * 1단계: 사용자의 질문을 SQL로 변환하기 위한 프롬프트
 */
export const SQL_GENERATION_PROMPT = (question: string, entityContext: string, errorFeedback: string, intent: string) => `
당신은 SQLite 전문가입니다. 아래의 테이블 스키마와 제공된 포켓몬 이름, 그리고 질문의 의도(\${intent})를 바탕으로 사용자의 질문에 답할 수 있는 SQL 쿼리(SELECT)만 생성하세요.

의도: ${intent}
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

[의도별 가이드]
- POKEMON_INFO: 해당 포켓몬의 특정 컬럼이나 연결된 정보를 조회하세요.
- POKEMON_COMPARE: 여러 포켓몬을 JOIN하여 조회하거나, UNION ALL을 사용하여 결과를 합치세요. 필요하다면 ORDER BY와 LIMIT을 사용해 순위를 매기세요.
- TYPE_MATCHUP: 현재 DB에는 상성표가 없으므로, 해당 포켓몬의 '타입'을 조회하는 쿼리를 생성하세요. 상성 계산은 나중에 수행됩니다.

[예시 쿼리]
-- 포켓몬 타입 조회 (폼별로 구분):
SELECT p.name_ko, p.form_name, GROUP_CONCAT(t.name_ko) AS types
FROM pokemon p
JOIN pokemon_types pt ON p.id = pt.pokemon_id
JOIN types t ON pt.type_id = t.id
WHERE p.name_ko = '식스테일'
GROUP BY p.id, p.form_name;

-- 스피드 비교 (쁘사이저 vs 헤라크로스):
SELECT p.name_ko, p.form_name, s.speed
FROM pokemon p
JOIN stats s ON p.id = s.pokemon_id
WHERE p.name_ko IN ('쁘사이저', '헤라크로스');

[주의사항]
- SELECT 쿼리만 출력. 설명/주석 금지.
- "특성"을 물어보면 abilities 테이블을 사용하세요. stats(능력치)와 혼동하지 마세요.
- 별칭(alias)을 쓸 때 FROM/JOIN에서 정의한 별칭만 SELECT에서 사용하세요.

질문: "${question}"
SQL:`;

/**
 * 2단계: 실행 결과와 질문을 바탕으로 답변을 생성하기 위한 프롬프트
 */
export const ANSWER_GENERATION_PROMPT = (question: string, sql: string, results: any[]) => `
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

/**
 * 타입 상성 답변 생성을 위한 프롬프트
 */
export const TYPE_MATCHUP_ANSWER_PROMPT = (pokemonName: string, types: string[], summary: string) => `
당신은 포켓몬 전문가입니다. 아래의 [타입 상성 요약] 데이터를 바탕으로 사용자에게 친절하게 한국어로 답변해 주세요.

[타입 상성 요약]
${summary}

[답변 가이드]
1. [타입 상성 요약]에 있는 정보를 **하나도 빠짐없이** 답변에 포함하세요.
2. 4배 약점이 있다면 주의사항으로 강조해 주세요.
3. 절대 요약 내용에 없는 정보를 임의로 추가하지 마세요. (자신의 지식 사용 금지)

답변:
`;
