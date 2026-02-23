# depth-parallax-engine
An experimental depth-based parallax motion generator built with FastAPI, PyTorch, and OpenCV.

This project demonstrates how monocular depth estimation can be used to generate cinematic motion effects from a single image.

## ✨Features

* Monocular depth estimation (MiDaS-based)
* Depth-weighted displacement rendering
* Dolly-style motion
* Customizable motion parameters
* React + TypeScript frontend
* FastAPI backend
* DeepLab V3 + Canny semantic & edge masks for crisp furniture outlines
* Focal‑point stabilisation (focalX, focalY, 0‑100 %)
* Exports MP4 (H.264, 24 fps) or GIF

## Disclaimer

This project is an independent educational implementation of depth-based motion rendering techniques.
It is not affiliated with, endorsed by, or connected to any commercial products or companies.

## Example of UI
![image alt](https://github.com/Crystal14w/depth-parallax-engine/blob/4b1aa79fdd83dd0c6cab5cba43ec3e4bd23a6028/Images/Page_1_Vertical.PNG)

![image alt](https://github.com/Crystal14w/depth-parallax-engine/blob/4b1aa79fdd83dd0c6cab5cba43ec3e4bd23a6028/Images/Page_2_Vertical.PNG)

## Image Example

## 1.) 🏗 Architecture

```
                       ┌────────────┐   POST /process   ┌────────────┐
User  ── upload img ──►│ React UI   │───────────────────►│ FastAPI   │
                       └────────────┘                    ____________
                            ▲  MP4/GIF ◄───────────────┘            
                            └──── preview ───────────────────────────┘
Layer stack
  Backend  FastAPI • PyTorch • OpenCV • scikit-image
           1) MiDaS depth  2) DeepLab V3 seg  3) Canny refine
           4) Focal-point stabilise   5) Render & encode
  Frontend React • Vite • TypeScript • Tailwind
           Upload form → progress bar → preview + download link
```


## 2.) 🚀 Quick Start

##### Termial
git clone https://github.com/crystal14w/depth-parallax-engine.git
cd depth-parallax-engine

##### Backend  
FastAPI + ML

##### Client   
React frontend

## 3.) ⚙️ Backend setup
cd backend
python -m venv .venv
#### Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# requirements.txt
fastapi==0.110.*
uvicorn[standard]==0.29.*
opencv-python==4.9.*
torch==2.3.*
torchvision==0.18.*
scikit-image==0.23.*
imageio[ffmpeg]==2.34.*

## 4.) 🖥️ Frontend setup
cd ../client
npm install
npm run dev  

Tip: Control + C to exit running application

##### Run it
1.) Open the frontend.
2.) Select an image (JPEG/PNG).
3.) Adjust Focal X / Focal Y (%, 0 = left/top, 100 = right/bottom).
5.) Click Generate → watch the preview, then download.

## 5.) 🛠 API reference (POST /process)

#### Response JSON
{
  "ok": true,
  "video": "/result/ab12cd34?fmt=mp4"
}

Fetch example (React, axios):
const res = await axios.post("http://127.0.0.1:8000/process", formData, {
  headers: { "Content-Type": "multipart/form-data" },
  responseType: "json",
});


#### Paste in Browser:
http://127.0.0.1:8000/result/ab12cd34?fmt=mp4

## 6.) 📦 Production build
npm run build










