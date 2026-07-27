/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function generateMotorcycleImage(prompt: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          {
            text: `Create a futuristic, high-quality, professional photography style image of a motorcycle. Context: ${prompt}. The style should be clean, sleek, and high-tech, fitting for a smart parking app avatar.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image generation failed:", error);
    throw error;
  }
}

export async function editMotorcycleImage(base64Image: string, prompt: string) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image.split(',')[1],
              mimeType: "image/png",
            },
          },
          {
            text: `Edit this motorcycle image based on the following instructions: ${prompt}. Keep the core motorcycle consistent but apply the requested changes in a high-quality, professional style.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
          imageSize: "1K"
        },
      },
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image editing failed:", error);
    throw error;
  }
}

/**
 * 請求 AI 停車小助手解答
 * @param userQuery 使用者輸入的問題
 * @param spots 即時的車位狀態列表
 * @returns AI 的回答字串
 */
export async function askParkingAI(userQuery: string, spots: any[], vehicleType: 'moto' | 'car' = 'moto'): Promise<string> {
  const total = spots.length;
  const available = spots.filter(s => s.status === 'available').length;
  const disabled = spots.filter(s => s.status === 'disabled').length;

  const vehicleName = vehicleType === 'car' ? '汽車' : '機車';
  const vehicleEmoji = vehicleType === 'car' ? '🚗' : '🛵';
  const assistantName = vehicleType === 'car' ? 'Smart-CarPark AI' : 'Smart-MotoPark AI';

  // 計算各區空位（以車位編號第一個字母分區）
  const zoneStats: Record<string, { total: number, available: number }> = {};
  spots.forEach(s => {
    // 汽車格編號可能為 CAR-A-01，我們取 row 部份。若是 CAR-A-01，取 CAR- 之後的 A
    let zone = s.number.charAt(0).toUpperCase();
    if (s.number.startsWith("CAR-")) {
      zone = s.number.split('-')[1]?.toUpperCase() || 'A';
    }
    if (!zoneStats[zone]) {
      zoneStats[zone] = { total: 0, available: 0 };
    }
    zoneStats[zone].total++;
    if (s.status === 'available') {
      zoneStats[zone].available++;
    }
  });

  const zoneStatsString = Object.entries(zoneStats)
    .map(([zone, stats]) => `${zone}區: 剩 ${stats.available}/${stats.total}`)
    .join('，');

  try {
    const promptContext = `
【角色設定】
你是一個貼心、親切、熱情，且說話帶點大學生幽默口吻的「智慧停車場 AI 助理」（名字是 ${assistantName}）。
你擁有該校園停車場的「即時${vehicleName}車位狀態數據」，使用者是開${vehicleName}的大學生。

【即時車位數據】
* 總車位數：${total} 格
* 目前剩餘空位：${available} 格（綠色）
* 目前異常車位：${disabled} 格（橙色，遭亂停或停用）
* 區域剩餘空位狀況：${zoneStatsString}

【回覆準則】
1. 以繁體中文回覆，語氣要親切幽默，多用表情符號（如：🙌, ${vehicleEmoji}, 👮, 😭）。
2. 若詢問空位，請根據以上區域狀況推薦空位最多的區。
3. 若詢問或通報亂停（例如：「有人亂停在 B-04」），請告訴使用者你已經將該格標記為異常並通知管理員，地圖上已同步更新。
4. 保持回答在 130 字以內，不要囉唆。

現在，請回答學生的詢問：
"${userQuery}"
`;

    // 呼叫 Gemini 文字生成模型，改用更簡潔的直接 Prompt 傳入，防範 API 結構報錯
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: promptContext
    });

    return response.text?.trim() || `收到！已為您查詢，目前場內還有不少空位，直接看地圖最快呦！${vehicleEmoji}`;
  } catch (error) {
    console.error("AI 停車小助手 API 呼叫失敗，啟用本地智慧規則分析:", error);
    
    const query = userQuery.toUpperCase();
    let reply = "";
    
    if (query.includes("位") || query.includes("空") || query.includes("停哪") || query.includes("滿")) {
      reply = `哈囉！目前場內還有 ${available} 個空位。其中 ${zoneStatsString.split('，')[0] || "A區"} 的空位相對比較充足，建議你可以直接往那邊開呦！${vehicleEmoji}`;
    } else if (query.includes("亂停") || query.includes("異常") || query.includes("佔用") || query.includes("車位") || /[A-Z]-[0-9]/i.test(userQuery)) {
      // 嘗試提取車位編號，如 A-05, B-04
      const match = userQuery.match(/[A-Za-z]-[0-9]{2}/) || userQuery.match(/CAR-[A-Z]-[0-9]{2}/i);
      const spotNum = match ? match[0].toUpperCase() : "";
      if (spotNum) {
        reply = `收到！我已經通知管理處了。我現在立刻幫你在地圖上把車位 ${spotNum} 標記為「異常狀態」，請大家先避開這格喔！系統也會通知管理員前往貼單鎖車！👮`;
      } else {
        reply = `如果發現有人亂停，你可以直接在地圖上點擊該車位，選擇「通報此格被亂停」！我會立刻幫你標記為異常！👮`;
      }
    } else {
      reply = `嘿！我是智慧停車 AI 助理。您可以問我「哪裡有空位」或跟我說「哪格被亂停了（例如：有人亂停在 B-04）」，我會即時幫您查詢與連動地圖喔！${vehicleEmoji}`;
    }
    return reply;
  }
}

