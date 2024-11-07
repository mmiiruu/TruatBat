const line = require("@line/bot-sdk");
const vision = require("@google-cloud/vision");
const { MongoClient } = require("mongodb");
require("dotenv").config();

// LINE bot
const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

// Google Vision
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: "service-account.json",
});

// MongoDB
const uri = process.env.MONGODB_URI;
const mongoClient = new MongoClient(uri);

// Function to detect student ID using OCR
async function detectStudentId(imageBuffer) {
  const [result] = await visionClient.textDetection(imageBuffer);
  const text = result.textAnnotations[0]?.description;

  if (text) {
    const studentId = extractStudentId(text);
    return studentId || "ไม่พบเลขประจำตัวนักเรียนในรูปภาพ";
  }
  return "ไม่พบข้อความในรูปภาพ";
}

// Function to extract student ID from OCR text
function extractStudentId(text) {
  const regex = /เลขประจำตัวนักเรียน\s(\d+)/;
  const match = text.match(regex);
  return match ? match[1] : null;
}

// Function to find student by ID in MongoDB
async function findStudentById(studentId) {
  try {
    await mongoClient.connect();
    const database = mongoClient.db("school");
    const collection = database.collection("students");

    const studentInfo = await collection.findOne({ studentId: studentId });
    console.log("ข้อมูลนักเรียนที่ดึงมา:", studentInfo);
    if (studentInfo) {
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

// Function to save or update student data in MongoDB
async function saveStudentData(studentId, data) {
  try {
    await mongoClient.connect();
    const database = mongoClient.db("school");
    const collection = database.collection("students");

    const result = await collection.updateOne(
      { studentId: studentId },
      { $set: data },
      { upsert: true }
    );
    console.log("ผลลัพธ์การอัปเดต:", result);

    return result.upsertedCount > 0
      ? "บันทึกข้อมูลนักเรียนใหม่สำเร็จ"
      : "อัปเดตข้อมูลนักเรียนสำเร็จ";
  } finally {
    await mongoClient.close();
  }
}

// Function to parse simple input to JSON
function parseInputToJson(input) {
  const pairs = input.split(",").map((pair) => pair.trim());
  const data = {};
  pairs.forEach((pair) => {
    const [key, value] = pair.split("=").map((item) => item.trim());
    if (key && value) {
      data[key] = value;
    }
  });
  return data;
}

// LINE bot handler
async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "image") {
    try {
      const stream = await client.getMessageContent(event.message.id);
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", async () => {
        const imageBuffer = Buffer.concat(chunks);

        const studentId = await detectStudentId(imageBuffer);

        if (studentId.startsWith("ไม่พบ")) {
          await client.replyMessage(event.replyToken, {
            type: "text",
            text: studentId,
          });
        } else {
          const studentData = await findStudentById(studentId);
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
  } else if (event.type === "message" && event.message.type === "text") {
    const message = event.message.text.trim();
    const [command, studentId, ...dataParts] = message.split(" ");
    if (command === "บันทึกข้อมูล" && studentId && dataParts.length > 0) {
      try {
        const dataString = dataParts.join(" ");
        const data = parseInputToJson(dataString);
        const response = await saveStudentData(studentId, data);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: response,
        });
      } catch (error) {
        console.error("Error saving student data:", error);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "เกิดข้อผิดพลาดในการบันทึกข้อมูลนักเรียน กรุณาตรวจสอบรูปแบบข้อมูล",
        });
      }
    } else if (/^\d+$/.test(message)) {
      try {
        const studentData = await findStudentById(message);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: studentData,
        });
      } catch (error) {
        console.error("Error finding student:", error);
        await client.replyMessage(event.replyToken, {
          type: "text",
          text: "เกิดข้อผิดพลาดในการค้นหาข้อมูลนักเรียน",
        });
      }
    } else {
      await client.replyMessage(event.replyToken, {
        type: "text",
        text: "กรุณาส่งรูปภาพบัตรนักเรียนที่มีเลขประจำตัว หรือพิมพ์เลขประจำตัวนักเรียนเพื่อค้นหาข้อมูล",
      });
    }
  }
}

// Express server
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
