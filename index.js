const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");
const { MongoClient } = require("mongodb");
require("dotenv").config();
//  LINE bot
const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

//  Google Vision
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: "service-account.json",
});

//  MongoDB
const uri =
  "mongodb+srv://mmiiruu:110022work@cluster1.5hq4p.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const mongoClient = new MongoClient(uri);

// function OCR
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
  const regex = /เลขประจำตัวนักเรียน\s(\d+)/;
  const match = text.match(regex);
  return match ? match[1] : null;
}

// หารหัสนักเรียนที่ตรงกับฐานข้อมูลMongoDB
async function findStudentById(studentId) {
  try {
    await mongoClient.connect();
    const database = mongoClient.db("school");
    const collection = database.collection("students");

    // find studentId
    const studentInfo = await collection.findOne({ studentId: studentId });

    if (studentInfo) {
      // รูปแบบข้อมูลทั้งหมดสำหรับการแสดงผล
      const studentData = `
        ชื่อ: ${studentInfo.name}
        เลขประจำตัวนักเรียน: ${studentInfo.studentId}
        วันเกิด: ${studentInfo.birthdate}
        เลขประจำตัวประชาชน: ${studentInfo.citizenId}
        เพศ: ${studentInfo.gender}
        ที่อยู่: ${studentInfo.address}

        ข้อมูลครอบครัว:
        ชื่อผู้ปกครอง: ${studentInfo.family.guardianName}
        เบอร์โทรผู้ปกครอง: ${studentInfo.family.guardianPhone}

        ข้อมูลการศึกษา:
        ระดับชั้น: ${studentInfo.education.class}
        ห้องเรียน: ${studentInfo.education.section}
        ผลการเรียน:
        - เทอม 1 ปี ${studentInfo.education.grades[0].year} - GPA: ${
        studentInfo.education.grades[0].GPA
      }
        - เทอม 2 ปี ${studentInfo.education.grades[1].year} - GPA: ${
        studentInfo.education.grades[1].GPA
      }

        พฤติกรรม:
        คะแนนพฤติกรรม: ${studentInfo.behavior.goodnessScore}
        กิจกรรมพฤติกรรม:
        ${studentInfo.behavior.activities
          .map((activity) => `- ${activity.activity}: ${activity.points} คะแนน`)
          .join("\n")}`;
      return studentData;
    } else {
      return "ไม่พบข้อมูลนักเรียนในฐานข้อมูล";
    }
  } finally {
    await mongoClient.close();
  }
}

// LINE
async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "image") {
    try {
      // ดาวน์โหลดรูปภาพจาก LINE
      const stream = await client.getMessageContent(event.message.id);
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", async () => {
        const imageBuffer = Buffer.concat(chunks);

        // ตรวจจับ ตรวจหารหัสนักเรียน Google Vision API
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

// Express
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
