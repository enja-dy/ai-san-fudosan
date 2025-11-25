import express from "express";
import * as line from "@line/bot-sdk";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/* ========= LINE / OPENAI ========= */
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const lineClient = new line.Client(config);
const app = express();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ========= Supabase ========= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY // 必ず service_role
);

/* ========= Health Check ========= */
app.get("/", (_req, res) => res.send("AI-Kun Fudosan Running"));

/* ========= Webhook ========= */
app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
  return res.status(200).end();
});

/* ========= Event Handler ========= */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const userMessage = event.message.text;
  const userId = event.source.userId;

  try {
    const aiResponse = await runRealEstateAgentAI(userId, userMessage);
    await push(userId, aiResponse);

    // Supabase 保存（失敗しても会話は止めない）
    const { error } = await supabase.from("fudosan_logs").insert({
      user_id: userId,
      question: userMessage,
      response: aiResponse,
    });
    if (error) console.error("Supabase insert error:", error);

  } catch (err) {
    console.error("Error:", err);
    await push(userId, "エラーが発生しました。もう一度送ってみてください🙇‍♂️");
  }
}

/* ========= Core AI Logic ========= */
async function runRealEstateAgentAI(userId, userMessage) {
  // 🔥 過去10件の会話取得
  const { data: logs } = await supabase
    .from("fudosan_logs")
    .select("question, response")
    .eq("user_id", userId)
    .order("id", { ascending: true })
    .limit(10);

  const messages = [];

  /* === SYSTEM PROMPT（超精密・丁寧対応） === */
  messages.push({
    role: "system",
    content: `
あなたは「AIくん - 不動産査定の専門家」です。

【キャラクター】
・物腰柔らかく丁寧で、信頼できる不動産のプロ
・押し付けない、煽らない、営業しない
・話しやすさと安心感が最優先
・絵文字は1〜2個以内

【会話ルール】
・ユーザーが少しずつ情報を出してくる前提で対応
・質問攻めは禁止（質問は1〜2つ以内）
・短文でも文脈を読み取って推測し、決めつけずに確認する
・わからない場合に「ざっくりでもOK」「思い出せる範囲でOK」を添える

【短文入力処理の例】
・「80」→ 広さの可能性 → 「80㎡でしょうか？」と推測して確認
・「10年」→ 築年数の可能性 → 「築10年のことですか？」と確認
・「川崎市」→ 住所 → 感謝しつつ次の物件タイプ質問へ

【情報収集の順番】
① 住所（市区レベルでOK）
② 物件タイプ（マンション / 戸建て / 土地 / その他）
③ 広さ（㎡ / 坪 / 間取りのどれでもOK）
④ 築年数
⑤ 必要なら階数 / 土地面積 / 駅距離の追加確認

【査定回答フォーマット（必ず固定）】
① 安心感のある一言（相談のお礼＋ねぎらい）
② 推定売却価格（幅で提示）
③ 根拠（3点まで）
④ 次の1つだけ負担にならない質問

【禁止事項】
× 専門用語の羅列
× 過度に情報を要求する
× 営業感・売却を煽る表現
× 番地・電話番号・本名・来店を強制する
`
  });

  // 🔥 過去会話投入（文脈維持）
  if (logs) {
    logs.forEach(log => {
      messages.push({ role: "user", content: log.question });
      messages.push({ role: "assistant", content: log.response });
    });
  }

  // 🔥 今回のユーザー入力
  messages.push({ role: "user", content: userMessage });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });

  return response.choices[0].message.content;
}

/* ========= LINE Push ========= */
async function push(to, messages) {
  return lineClient.pushMessage(to, [{ type: "text", text: messages }]);
}

/* ========= Start ========= */
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`AI-kun running on ${port}`));
