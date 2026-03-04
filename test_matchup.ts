import { askPokemonWiki } from './src/lib/llm';

async function testTypeMatchup() {
    const testCases = [
        "글라이온의 약점이 뭐야?",
        "입치트의 약점은?",
        "망나뇽 약점 알려줘",
        "질뻐기의 약점이 뭐야?",
        "이상해꽃의 약점이 뭐야?",
        "리자몽의 타입 상성은 어떻게 돼?",
        "따라큐의 약점은?"
    ];

    for (const question of testCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`질문: ${question}`);
        console.log('='.repeat(60));

        try {
            const result = await askPokemonWiki(question);
            if (result) {
                console.log(`\n[Intent]: ${result.intent}`);
                console.log(`\n[Answer]:\n${result.answer}`);
            } else {
                console.log('\n결과가 없습니다.');
            }
        } catch (error) {
            console.error(`Error: ${error}`);
        }
    }
}

testTypeMatchup().catch(console.error);
