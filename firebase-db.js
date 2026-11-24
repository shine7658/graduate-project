import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { 
    getFirestore, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js"; // 從外部讀取

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 1. 寫入一筆練習紀錄（過關時呼叫）
export async function savePracticeRecord(userId, gestureId, gestureName, durationSec, hintTriggered) {
    try {
        const docRef = await addDoc(collection(db, "practice_records"), {
            user_id: userId,
            gesture_id: gestureId,
            gesture_name: gestureName,
            duration_sec: Number(durationSec.toFixed(1)),
            hint_triggered: hintTriggered,
            completed_at: serverTimestamp()
        });
        console.log("紀錄寫入成功，ID:", docRef.id);
        return true;
    } catch (e) {
        console.error("寫入失敗:", e);
        return false;
    }
}

// 2. 管理者讀取所有紀錄（可選填 userId 篩選特定兒童）
export async function fetchPracticeRecords(filterUserId = "") {
    const recordsRef = collection(db, "practice_records");
    let q;

    if (filterUserId.trim() !== "") {
        q = query(recordsRef, where("user_id", "==", filterUserId.trim()), orderBy("completed_at", "desc"));
    } else {
        q = query(recordsRef, orderBy("completed_at", "desc"));
    }

    const querySnapshot = await getDocs(q);
    const records = [];
    querySnapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
    });
    return records;
}