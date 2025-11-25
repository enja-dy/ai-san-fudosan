import express from "express";
import * as line from "@line/bot-sdk";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/* ========= LINE / OPENAI / SUPABASE 設定 ========= */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* ========= Health check ========= */
app.get("/", (_req, res) => res.send("AI-Kun Fudosan Running"));

/* ========= Webhook ========= */
app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
  return res.status(200).end();
});

/* ========= イベント処理 ========= */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const userId = event.source.userId;
  const userMessage = event.message.text;

  try {
    const reply = await runRealEstateAgentAI(userMessage);
    await push(userId, reply);

    // Supabase に保存
    await supabase.from("fudosan_logs").insert({
      user_id: userId,
      question: userMessage,
      response: reply
    });

  } catch (e) {
    console.error("Error:", e);
    await push(userId, "エラーが発生しました。もう一度送ってみてください。");
  }
}

/* ========= AIコアロジック（査定/質問切替） ========= */
async function runRealEstateAgentAI(text) {
  const systemPrompt = `
あなたは「AIくん - 不動産査定の専門家」です。

ユーザーが入力した情報によって回答モードを切り替えなさい：

【モードA：十分な情報がある場合】
以下が揃っている場合 → 査定を実施してよい
・エリア（住所・最寄り駅・市区町村など）
・物件タイプ（マンション / 戸建て / 土地）
・広さ（㎡/坪 or 間取り）
・築年数 or 築浅/築古の表現

出力形式（厳守）：
① 崩さない丁寧な一言コメント
② 推定査定額（価格幅で）
③ 指標にしたポイント（最大3つ）
④ 追加で聞くべき質問があれば1つ


【モードB：情報が不足している場合】
査定せずに足りない情報を自然に質問
・質問は最大2つ
・営業色は出さない
・「より正確な査定のために」という一言を添える
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: text }
    ]
  });

  return completion.choices[0].message.content;
}

/* ========= LINE 返信ユーティリティ ========= */
async function push(to, messages) {
  return lineClient.pushMessage(to, [{ type: "text", text: messages }]);
}

/* ========= Render起動 ========= */
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`AI-kun Fudosan running on ${port}`));
