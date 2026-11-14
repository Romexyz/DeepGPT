# AI Chat Hub

เว็บ chat รวม AI ฟรีทุกเจ้า สไตล์ ChatGPT

## Providers ที่รองรับ
| Provider | Models | Link ขอ Key |
|----------|--------|------------|
| Google Gemini | gemini-1.5-flash, pro | aistudio.google.com |
| Groq | llama3-70b, mixtral | console.groq.com |
| Mistral | mistral-small, open-mistral-7b | console.mistral.ai |
| Cohere | command-r, command-r-plus | dashboard.cohere.com |
| OpenRouter | หลายโมเดล (มีฟรี) | openrouter.ai |
| Cloudflare AI | llama-3, mistral-7b | cloudflare.com/workers-ai |

## วิธีรัน

### 1. ติดตั้ง dependencies
```bash
cd aichat
npm install
```

### 2. รัน backend server
```bash
npm run server
# หรือ: node server/index.js
```

### 3. เปิด frontend
เปิดไฟล์ `index.html` ใน browser โดยตรง (ไม่ต้อง build)

## วิธีใช้
1. เปิด `index.html` ใน browser
2. คลิก Settings (มุมล่างซ้าย)
3. เลือก Provider และใส่ API Key
4. เริ่มคุยได้เลย!

## Features
- 🌙 Dark mode สวยๆ
- 💬 Multi-chat history (เก็บใน localStorage)
- 📋 Copy code blocks
- 🔄 เปลี่ยน provider ได้ทุกเวลา
- 🤖 System prompt custom ได้
- ⌨️ Enter ส่ง, Shift+Enter ขึ้นบรรทัดใหม่
