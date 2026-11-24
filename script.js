import { savePracticeRecord } from "./firebase-db.js"; //[cite: 3, 6]

let currentUserId = localStorage.getItem("current_child_id") || "KID_001";
let levelStartTime = 0;
let hintTriggered = false;
let hasRecorded = false;

// 設定兒童編號
export function setCurrentUserId(id) {
    if (id && id.trim() !== "") {
        currentUserId = id.trim().toUpperCase();
        localStorage.setItem("current_child_id", currentUserId);
    }
}

// 每次開始新關卡時呼叫（重置計時與狀態）
export function resetRecordState() {
    levelStartTime = Date.now();
    hintTriggered = false;
    hasRecorded = false;
}

// 超過 10 秒觸發提示時呼叫
export function markHintTriggered() {
    hintTriggered = true;
}

// 當手勢達標過關時呼叫
export async function onGestureSuccess(gestureId, gestureName) {
    if (hasRecorded) return; //[cite: 6]
    hasRecorded = true; //[cite: 6]

    const durationSec = (Date.now() - levelStartTime) / 1000; //[cite: 6]
    const ok = await savePracticeRecord(currentUserId, gestureId, gestureName, durationSec, hintTriggered); //[cite: 3, 6]
    if (!ok) {
        hasRecorded = false; // 若網路失敗允許重試
    }
}

// 新增：家長按下「先跳過這題」時記錄
export async function onGestureSkipped(gestureId, gestureName) {
    if (hasRecorded) return;
    hasRecorded = true;

    const durationSec = (Date.now() - levelStartTime) / 1000;
    await savePracticeRecord(currentUserId, gestureId, gestureName, durationSec, true, true);
}