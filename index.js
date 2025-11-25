import express from "express";
import * as line from "@line/bot-sdk";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

// ========= LINE / OPENAI Config =========
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ========= Supabase =========
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ========= Health Check =========
app.get("/", (_req, res) => res.send("AI-Kun Fudosan Running"));

// ========= Webhook =========
app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
  return res.status(200).end(); // LINE へ 200 OK を即返す(重要)
});

// ========= メッセージ処理 =========
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const userMessage = event.message.text;
  const userId = event.source.userId;

  try {
    const aiResponse = await runRealEstateAgentAI(userMessage);
    await push(userId, aiResponse);

    // Supabase 保存（AI応答を保存して履歴活用）
    await supabase.from("fudosan_logs").insert({
      user_id: userId,
      question: userMessage,
      response: aiResponse,
    });
  } catch (err) {
    console.error("Error:", err);
    await push(userId, "エラーが発生しました。もう一度送ってみてください。");
  }
}

// ========= AI査定プロンプト =========
async function runRealEstateAgentAI(text) {
  const systemPrompt = `
あなたは「AIくん - 不動産査定の専門家」です。
ユーザーが住所・物件タイプ・間取り・築年数・広さなどを入力したら、売却価格の相場を推定します。

回答は以下の形式で固定：
① 崩さない丁寧な一言コメント
② 推定査定額（価格幅で）
③ 指標にしたポイント（3つ以内）
④ 追加で聞くべき質問があれば1つ
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text },
    ],
  });

  return response.choices[0].message.content;
}

// ========= LINE 返信 =========
async function push(to, messages) {
  return lineClient.pushMessage(to, [
    {
      type: "text",
      text: messages,
    },
  ]);
}

// ========= 起動 =========
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`AI-kun running on ${port}`));
