# 🖥️Zap shift - Server Side (Backend)

This is the backend for the **zap shift** — a full-stack parcel delivery platform built using Node.js, Express, and MongoDB.

---

## 🌐 Live API Base URL

> 🟢 https://zap-shift-server-khaki.vercel.app/  
> 🛠️ Local: `http://localhost:5000`

---

## 🚀 Technologies Used

- Node.js
- Express.js
- MongoDB (native driver)
- Firebase Admin SDK (Token verification)
- CORS, Helmet, morgan
- JWT (Optional if using)
- dotenv
- bcrypt (if manual auth)

---

## 🔐 Authentication & Authorization

- Firebase Token verification middleware
- Role-based Access: `admin`, `rider`, `user`
- Secure routes with token & role check

