/**
 * Webアプリケーションのエントリーポイント
 * 通常アクセス時はメイン画面（index.html）、
 * ?page=rules パラメータ付きアクセス時はルール解説画面（rules.html）を表示
 */
function doGet(e) {
  // パラメータ ?page=rules が指定された場合はルール説明ページを表示
  if (e && e.parameter && e.parameter.page === 'rules') {
    return HtmlService.createTemplateFromFile('rules')
      .evaluate()
      .setTitle('坂道グループ 疑似ドラフト会議 - 公式ルール解説')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
  }

  // 通常アクセス時はメイン画面を表示
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('坂道グループ 疑似ドラフト会議')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * 現在デプロイされているWebアプリケーションのURLを取得（フロントエンドの画面遷移に使用）
 */
function getAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * 別ファイル（CSSやHTMLパーツ）をテンプレート内にインクルードするための関数
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * スプレッドシートから候補者名鑑データを取得
 * A列:名前(row[0]), C列:所属(row[2]), E列:出身(row[4]),
 * F列:登場週目(row[5]), G列:競合率(row[6]), H列:ポイント(row[7]),
 * I列:写真(row[8]), J列:写真リンク(row[9])
 */
function getDraftMembers() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets()[0];
    const values = sheet.getDataRange().getValues();
    
    if (!values || values.length <= 1) {
      return [];
    }

    const members = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row) continue;

      const name = (row[0] !== undefined && row[0] !== null) ? String(row[0]).trim() : "";
      if (!name) continue;

      const belong = (row[2] !== undefined && row[2] !== null) ? String(row[2]).trim() : "";
      const originRaw = (row[4] !== undefined && row[4] !== null) ? String(row[4]).trim() : "高";

      let sessionNum = 1;
      if (row[5] !== undefined && row[5] !== null) {
        const match = String(row[5]).match(/\d+/);
        sessionNum = match ? parseInt(match[0], 10) : 1;
      }

      let conflictRate = 0;
      if (row[6] !== undefined && row[6] !== null && !isNaN(Number(row[6]))) {
        conflictRate = Number(row[6]);
      }

      let ptVal = 0;
      if (row[7] !== undefined && row[7] !== null && !isNaN(Number(row[7]))) {
        ptVal = Number(row[7]);
      }

      // I列(row[8])およびJ列(row[9])の画像リンク取得（J列を優先、なければI列）
      const photoUrl = (row[9] !== undefined && row[9] !== null && String(row[9]).trim() !== "") 
        ? String(row[9]).trim() 
        : ((row[8] !== undefined && row[8] !== null) ? String(row[8]).trim() : "");

      members.push({
        名前: name,
        所属: belong,
        出身: originRaw,
        登場週目: sessionNum,
        競合率: conflictRate,
        ポイント: ptVal,
        写真: photoUrl
      });
    }

    return members;
  } catch (err) {
    throw new Error("スプレッドシート読込失敗: " + err.message);
  }
}

/**
 * 【定期実行用トリガー設定推奨】
 * 12時間以上経過した放置ルームを自動削除してFirebaseのDB容量を開放
 */
function autoCleanupOldRooms() {
  const FIREBASE_DB_URL = "https://draftsimulater-default-rtdb.asia-southeast1.firebasedatabase.app";
  const url = `${FIREBASE_DB_URL}/rooms.json`;

  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      Logger.log("データ取得スキップまたはルームなし: " + response.getContentText());
      return;
    }

    const rooms = JSON.parse(response.getContentText());
    if (!rooms) return;

    const now = Date.now();
    // 12時間 = 12 * 60分 * 60秒 * 1000ミリ秒 （※抜け落ちていた演算子を修正）
    const EXPIRE_TIME = 12 * 60 * 60 * 1000;

    for (const roomId in rooms) {
      const room = rooms[roomId];
      // ※抜け落ちていたマイナスや比較演算子を修正
      if (!room.createdAt || ((now - room.createdAt) > EXPIRE_TIME)) {
        const deleteUrl = `${FIREBASE_DB_URL}/rooms/${roomId}.json`;
        UrlFetchApp.fetch(deleteUrl, { method: "delete", muteHttpExceptions: true });
        Logger.log(`削除完了: ルーム [${roomId}] (経過時間超過)`);
      }
    }
  } catch (e) {
    Logger.log("クリーンアップ処理エラー: " + e.message);
  }
}