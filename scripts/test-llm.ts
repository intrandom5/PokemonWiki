import { askPokemonWiki } from '../src/lib/ollama';

async function test() {
    const questions = [
        "이상해씨의 스피드 스탯은 몇이야?",
        "대검귀의 타입이 뭐야?",
        "스피드가 가장 빠른 포켓몬 알려줘"
    ];

    for (const q of questions) {
        console.log('\n========================================');
        console.log(`질문: ${q}`);
        const result = await askPokemonWiki(q);
        console.log(`답변: ${result.answer}`);
    }
}

test();
