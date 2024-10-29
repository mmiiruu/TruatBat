const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");
const { MongoClient } = require("mongodb");
require("dotenv").config();
// ตั้งค่า LINE bot
const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

// ตั้งค่า Google Vision client
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: "service-account.json",
});

// ตั้งค่า MongoDB URI
const uri =
  "mongodb+srv://mmiiruu:110022work@cluster1.5hq4p.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const mongoClient = new MongoClient(uri);

// ฟังก์ชัน OCR เพื่อดึง studentId จากรูปภาพ
async function detectStudentId(imageBuffer) {
  const [result] = await visionClient.textDetection(imageBuffer);
  const text = result.textAnnotations[0]?.description;

  if (text) {
    const studentId = extractStudentId(text);
    return studentId || "ไม่พบเลขประจำตัวนักเรียนในรูปภาพ";
  }
  return "ไม่พบข้อความในรูปภาพ";
}

// ฟังก์ชันกรอง studentId จากข้อความ OCR
function extractStudentId(text) {
  const regex = /เลขประจำตัวนักเรียน\s(\d+)/; // ตัวอย่าง regex ที่ใช้ค้นหา studentId
  const match = text.match(regex);
  return match ? match[1] : null;
}

// ฟังก์ชันค้นหาข้อมูลนักเรียนใน MongoDB
async function findStudentById(studentId) {
  try {
    await mongoClient.connect();
    const database = mongoClient.db("school");
    const collection = database.collection("students");

    // ค้นหานักเรียนตาม studentId
    const studentInfo = await collection.findOne({ studentId: studentId });

    if (studentInfo) {
      return `ชื่อ: ${studentInfo.name}\nชั้นเรียน: ${studentInfo.education.class} ${studentInfo.education.section}\nคะแนนพฤติกรรม: ${studentInfo.behavior.goodnessScore}`;
    } else {
      return "ไม่พบข้อมูลนักเรียนในฐานข้อมูล";
    }
  } finally {
    await mongoClient.close();
  }
}

// ฟังก์ชันจัดการข้อความและรูปภาพที่ได้รับจาก LINE
async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "image") {
    try {
      // ดาวน์โหลดรูปภาพจาก LINE
      const stream = await client.getMessageContent(event.message.id);
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", async () => {
        const imageBuffer = Buffer.concat(chunks);

        // ตรวจจับ studentId ด้วย Google Vision API
        const studentId = await detectStudentId(imageBuffer);

        if (studentId.startsWith("ไม่พบ")) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: studentId,
          });
        } else {
          // ค้นหาข้อมูลนักเรียนใน MongoDB
          const studentData = await findStudentById(studentId);

          // ตอบกลับข้อมูลนักเรียนไปยัง LINE
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: studentData,
          });
        }
      });
    } catch (error) {
      console.error("Error processing image:", error);
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "เกิดข้อผิดพลาดในการวิเคราะห์รูปภาพ",
      });
    }
  } else {
    await client.replyMessage(event.replyToken, {
      type: "text",
      text: "กรุณาส่งรูปภาพบัตรนักเรียนที่มีเลขประจำตัว",
    });
  }
}

// สร้างเซิร์ฟเวอร์ Express สำหรับรับ Webhook
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;

app.post("/webhook", line.middleware(client.config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((error) => {
      console.error("Error:", error);
      res.status(500).send("Error");
    });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
