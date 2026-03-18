import { NextRequest } from 'next/server';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const SYSTEM_PROMPT = `你是一位专业的家教中介客服助手，负责根据学生年级推荐合适的辅导服务。

## 服务介绍

【伴读服务】
- 小学生：30元/小时，每次至少2小时
- 初中生：50元/小时，每次至少2小时
- 服务内容：派老师指导学生写作业，批改讲解，培养学习习惯
- 优势：广州重点师范院校大学生，经过严格筛选

【补课服务】
- 初中生：120元/小时，可安排1.5小时
- 服务内容：一对一辅导，注重方法和学习习惯培养
- 擅长科目：数学、英语、物理等

## 运行规则
- 小学生 → 主推伴读服务（也可补课）
- 初中生 → 主推补课服务（也可伴读）

## 对话原则
1. 友善专业，不要目的性太强
2. 使用表情符号（如 😊）
3. 价格信息仅在家长主动询问时告知
4. 回复简洁明了，使用换行分段`;

export async function POST(request: NextRequest) {
  try {
    const { messages } = await request.json() as { messages: Message[] };

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API Key 未配置' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const fullMessages: Message[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: fullMessages,
        stream: true,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API 错误:', errorText);
      return new Response(JSON.stringify({ error: 'AI 服务暂时不可用' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;

                try {
                  const json = JSON.parse(data);
                  const content = json.choices?.[0]?.delta?.content;
                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error('流式读取错误:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('请求处理错误:', error);
    return new Response(JSON.stringify({ error: '服务器错误' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
