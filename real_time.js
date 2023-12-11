import admin from "firebase-admin";


admin.initializeApp({
  credential: admin.credential.cert(path.join(__dirname, "firebase_key.json")),
  databaseURL: `https://flavorwave-event-default-rtdb.asia-southeast1.firebasedatabase.app`,
});

const db = admin.database();

export async function newOrderProcess() {
  const ref = db.ref(
    "NewOrderEvent"
  );
  const newRef = ref.push();

  return await newRef.set({ message: "hello world" });
}
