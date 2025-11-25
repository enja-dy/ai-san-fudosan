import express from "express";
import * as line from "@line/bot-sdk";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

/* ========= LINE / OPENAI Config ========= */
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
  process.env.SUPABASE_KEY // ここは service_role, anon/publishable は不可
);

/* ========= Health Check ========= */
app.get("/", (_req, res) => res.send("AI-Kun Fudosan Running"));

/* ========= Webhook ========= */
app.post("/callback", line.middleware(config), async (req, res) => {
  const events = req.body.events ?? [];
  await Promise.all(events.map(handleEvent));
  return res.status(200).end();
});

/* ========= メッセージ処理 ========= */
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;
  const userMessage = event.message.text;
  const userId = event.source.userId;

  try {
    const aiResponse = await runRealEstateAgentAI(userMessage);

    // LINE返信
    await push(userId, aiResponse);

    // Supabase保存（失敗しても bot 動作に影響しない）
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

/* ========= 不動産査定 SYSTEM PROMPT ========= */
async function runRealEstateAgentAI(text) {
  const systemPrompt = `
あなたは「AIくん - 不動産査定の専門家」です。

◆トーン
・冷たさゼロ、安心感と寄り添い
・機械的な言い回し禁止
・提案と確認は「押し付けず自然に」

◆住所入力への反応
・「◯◯市」など市区町村名だけの入力 → 興味や関心扱いはしない
・正解例：「川崎市なんですね、ありがとうございます！査定できるように少しずつ伺いますね」
・その後、最初の質問は「物件タイプ」
  （マンション / 戸建て / 土地 など）
・駅名 / 丁目 / 番地 など細かい情報は後半でOK
・負担をかけない形で聞く

◆数値だけの入力（例：80）
・ユーザーが言いたかった可能性を推定しながら確認する
・決めつけないが、気が利く会話
・正解例：「80というのは広さのことですよね？80㎡でしょうか？ざっくりで大丈夫です！」

◆質問の仕方
・質問はまとめて1回
・連発しない
・「答えられる範囲でOK」「ざっくりでもOK」を必ず添える

◆査定テンプレ
① 温かいコメント
② 推定売却価格（幅のある金額）
③ 根拠の説明（短く3点以内）
④ 次の1つだけ丁寧な質問（負担にならない形）
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

/* ========= LINE返信 ========= */
async function push(to, messages) {
  return lineClient.pushMessage(to, [{ type: "text", text: messages }]);
}

/* ========= 起動 ========= */
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`AI-kun running on ${port}`));
