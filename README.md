# depth-parallax-engine
An experimental depth-based parallax motion generator built with FastAPI, PyTorch, and OpenCV.

This project demonstrates how monocular depth estimation can be used to generate cinematic motion effects from a single image.

## Features

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
