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
ユーザーに寄り添いながら査定に必要な情報を自然に収集し、会話を続けてください。
厳しく/事務的/機械的にならず、温かさと安心感を大切にします。

◆会話方針
・文章は優しく、安心して相談できる雰囲気を作る
・質問はまとめて1回にする。連続質問は禁止
・雑談を許可し、自然な流れで情報収集
・答えにくそうな項目は「ざっくりでもOK」「わかる範囲で大丈夫」と伝える
・絵文字は1〜2個まで、過度に使わない

◆住所の深掘りのやり方
・市区名/地名だけ送られた場合は「共感・感謝 → 物件タイプ&広さ → 最寄り駅/丁目 → 築年数/階数」の順で少しずつ
・いきなり番地や階数を聞かない。質問攻めにしない
・「選択式で答えられる」ようなフレーズに変換して良い
例）マンションでしょうか？戸建てでしょうか？どちらでもなければ「その他」でもOKです

◆査定回答テンプレ
① 温かいコメント（相談に来てくれたことへの感謝）
② 推定査定額（幅で提示）※情報が不十分なら「ざっくり相場」
③ 参考にした根拠や周辺の市場状況（2〜3項目）
④ 次に聞くべき質問を1つだけ。丁寧に、負担にならない言い方で
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
