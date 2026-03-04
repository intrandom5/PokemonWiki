import { NextRequest } from 'next/server';
import { askPokemonWikiStream } from '@/lib/llm';

export async function POST(request: NextRequest) {
    try {
        const { question } = await request.json();

        if (!question || typeof question !== 'string') {
            return new Response(
                JSON.stringify({ error: '질문을 입력해주세요.' }),
                { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
        }

        // 스트리밍 응답 생성
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of askPokemonWikiStream(question)) {
                        const data = JSON.stringify(chunk) + '\n';
                        controller.enqueue(encoder.encode(data));
                    }
                } catch (error: any) {
                    const errorData = JSON.stringify({ type: 'error', content: error.message }) + '\n';
                    controller.enqueue(encoder.encode(errorData));
                } finally {
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Transfer-Encoding': 'chunked',
                'Cache-Control': 'no-cache',
            },
        });
    } catch (error: any) {
        console.error('Chat Stream API 오류:', error);
        return new Response(
            JSON.stringify({ error: 'LLM 처리 중 오류가 발생했습니다.' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
