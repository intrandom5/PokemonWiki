import { NextRequest, NextResponse } from 'next/server';
import { askPokemonWiki } from '@/lib/llm';

export async function POST(request: NextRequest) {
    try {
        const { question } = await request.json();

        if (!question || typeof question !== 'string') {
            return NextResponse.json(
                { error: '질문을 입력해주세요.' },
                { status: 400 }
            );
        }

        const result = await askPokemonWiki(question);

        return NextResponse.json({
            answer: result.answer,
            sql: result.sql,
            resultCount: result.results.length
        });
    } catch (error: any) {
        console.error('Chat API 오류:', error);
        return NextResponse.json(
            { error: 'LLM 처리 중 오류가 발생했습니다.', detail: error.message },
            { status: 500 }
        );
    }
}
