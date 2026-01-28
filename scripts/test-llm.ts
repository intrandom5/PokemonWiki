import { askPokemonWiki } from '../src/lib/ollama';

async function test() {
    const questions = [
        "대검귀의 타입이 뭐야?",
        "스피드가 가장 빠른 포켓몬 알려줘",
        "번치코의 특성이 뭐야?"
    ];

    for (const q of questions) {
        console.log('\n========================================');
        console.log(`질문: ${q}`);
        const result = await askPokemonWiki(q);
        console.log(`답변: ${result.answer}`);
    }
}

test();
