import io
import os
from pathlib import Path

import numpy as np
import cv2
from PIL import Image
import imageio.v3 as iio

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

import torch

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000","http://127.0.0.1:3000","http://localhost:5173","http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = Path("outputs")
OUTPUT_DIR.mkdir(exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
torch.set_grad_enabled(False)

print(f"🚀 Using device: {DEVICE}")

# MiDaS depth
MODEL_TYPE = "DPT_Hybrid"
midas = torch.hub.load("intel-isl/MiDaS", MODEL_TYPE).to(DEVICE).eval()
midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
transform = midas_transforms.dpt_transform


def depth_midas(rgb_uint8: np.ndarray) -> np.ndarray:
    """Generate depth map using MiDaS"""
    rgb_float = rgb_uint8.astype(np.float32) / 255.0
    input_batch = transform(rgb_float).to(DEVICE)

    with torch.no_grad():
        pred = midas(input_batch)
        pred = torch.nn.functional.interpolate(
            pred.unsqueeze(1),
            size=rgb_uint8.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()

    return pred.cpu().numpy().astype(np.float32)


def normalize_depth01(depth: np.ndarray) -> np.ndarray:
    """Normalize depth to 0-1 range"""
    d = depth.astype(np.float32, copy=True)
    d = np.nan_to_num(d, nan=0.0, posinf=0.0, neginf=0.0)
    lo = np.percentile(d, 2)
    hi = np.percentile(d, 98)
    d = (d - lo) / ((hi - lo) + 1e-6)
    return np.clip(d, 0.0, 1.0).astype(np.float32)


def aspect_scale_to_height(rgb: np.ndarray, target_h: int = 1080) -> tuple[int, int]:
    """Scale image to target height while maintaining aspect ratio"""
    h, w = rgb.shape[:2]
    scale = target_h / float(max(h, 1))
    out_h = target_h
    out_w = int(round(w * scale))
    return max(64, out_w), max(64, out_h)


def generate_smooth_motion_curve(
    frames: int, 
    motion_type: str = "orbit",
    direction: str = "clockwise"
) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate smooth motion curves for seamless looping.
    
    Args:
        frames: Number of frames
        motion_type: "orbit", "drift", or "zoom"
        direction: "clockwise" or "counterclockwise"
    
    Returns:
        (motion_x, motion_y) arrays that loop seamlessly
    """
    # Complete 2π cycle for perfect loop
    t = np.linspace(0, 2 * np.pi, frames, endpoint=False, dtype=np.float32)
    
    # Reverse direction if counterclockwise
    if direction == "counterclockwise":
        t = t[::-1]
    
    if motion_type == "orbit":
        # Smooth circular orbit
        motion_x = np.sin(t)
        motion_y = np.cos(t) * 0.5  # Elliptical (less vertical motion)
        
    elif motion_type == "drift":
        # Slow horizontal drift with gentle vertical sway
        motion_x = np.sin(t * 0.5)
        motion_y = np.sin(t * 0.3) * 0.3
        
    elif motion_type == "zoom":
        # Zoom in/out effect
        zoom_factor = (np.sin(t) * 0.5 + 0.5)
        motion_x = zoom_factor * np.sin(t * 2)
        motion_y = zoom_factor * np.cos(t * 2) * 0.5
        
    else:
        # Default to orbit
        motion_x = np.sin(t)
        motion_y = np.cos(t) * 0.5
    
    return motion_x, motion_y


def create_layer_weights(depth: np.ndarray, num_layers: int = 7) -> list[np.ndarray]:
    """
    Create smooth, continuous per-layer weights that sum to 1 everywhere.
    This eliminates banding/seam lines from percentile masks.
    """
    d = depth.astype(np.float32)
    d = np.clip(d, 0.0, 1.0)

    # Evenly spaced centers from near->far (you can flip if you want)
    centers = np.linspace(0.0, 1.0, num_layers, dtype=np.float32)

    # Controls how wide each layer is. Larger = smoother blend.
    sigma = 1.0 / (num_layers * 2.8)  # tweak: 1.0/(num_layers*0.9) = sharper, 1.0/(num_layers*1.6)=softer
    sigma2 = sigma * sigma + 1e-8

    weights = []
    for c in centers:
        w = np.exp(-0.5 * ((d - c) ** 2) / sigma2).astype(np.float32)
        weights.append(w)

    # Normalize so weights sum to 1 everywhere
    wsum = np.maximum(np.sum(weights, axis=0), 1e-8).astype(np.float32)
    weights = [w / wsum for w in weights]

    # Optional: a tiny blur helps suppress any residual contouring
    weights = [cv2.GaussianBlur(w, (0, 0), 0.3) for w in weights]

    # Renormalize after blur
    wsum = np.maximum(np.sum(weights, axis=0), 1e-8).astype(np.float32)
    weights = [w / wsum for w in weights]

    return weights


def enhance_depth_edges(rgb: np.ndarray, depth: np.ndarray) -> np.ndarray:
    """
    Edge-aware depth refinement without uint8 quantization banding.
    """
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    edges = cv2.Canny(gray, 50, 150).astype(np.float32) / 255.0
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)

    # Smooth depth in float space
    depth_smooth = cv2.GaussianBlur(depth.astype(np.float32), (0, 0), 2.0)

    # Keep original depth at edges, smooth elsewhere
    depth_refined = depth * edges + depth_smooth * (1.0 - edges)
    return np.clip(depth_refined, 0.0, 1.0).astype(np.float32)

def smoothstep(x: np.ndarray) -> np.ndarray:
    return x * x * (3.0 - 2.0 * x)

def generate_dolly_curve(frames: int, zoom_amount: float = 0.08, loop: bool = True) -> np.ndarray:
    if frames <= 1:
        return np.ones((frames,), dtype=np.float32)

    if loop:
        t = np.linspace(0, 2 * np.pi, frames, endpoint=False, dtype=np.float32)
        s = 0.5 - 0.5 * np.cos(t)
    else:
        t = np.linspace(0, 1.0, frames, endpoint=True, dtype=np.float32)
        s = smoothstep(t)

    return (1.0 + zoom_amount * s).astype(np.float32)

def render_parallax(
    rgb: np.ndarray,
    depth01: np.ndarray,
    out_w: int,
    out_h: int,
    frames: int,
    depth_strength: int,
    parallax: int,
    speed: int,
    focal_point_x: float,
    focal_point_y: float,
    motion_type: str,
    direction: str,
    stabilize: bool,
) -> np.ndarray:
    """
    Render sharp, dark-style parallax using ONE continuous depth-based displacement field.
    - No layered blending (prevents blur)
    - Edge-aware depth refinement
    """
    print(f"🎬 Rendering {frames} frames at {out_w}x{out_h}")
    print(f"   Focal point: ({focal_point_x:.2f}, {focal_point_y:.2f})")
    print(f"   Motion: {motion_type} ({direction}), Speed: {speed}%")

    # Resize (use sharper filter)
    rgb_out = cv2.resize(rgb, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
    depth_out = cv2.resize(depth01, (out_w, out_h), interpolation=cv2.INTER_CUBIC).astype(np.float32)

    # Edge-aware refinement (float-safe)
    print("   🔍 Refining depth edges...")
    depth_refined = enhance_depth_edges(rgb_out, depth_out)
    depth_refined = np.clip(depth_refined, 0.0, 1.0).astype(np.float32)

    # Coordinate grids
    yy, xx = np.mgrid[0:out_h, 0:out_w].astype(np.float32)

    # Distance from focal point (in pixels)
    focal_x_px = float(focal_point_x) * out_w
    focal_y_px = float(focal_point_y) * out_h
    dx = xx - focal_x_px
    dy = yy - focal_y_px
    dist = np.sqrt(dx * dx + dy * dy)

    max_dist = np.sqrt((out_w / 2) ** 2 + (out_h / 2) ** 2)
    distance_normalized = np.clip(dist / max_dist, 0.0, 2.0).astype(np.float32)

    # Base motion scale
    base_shift = (3.0 + (parallax / 100.0) * 12.0) * (speed / 100.0)
    print(f"   Base shift: {base_shift:.2f}px")

    # Smooth looping motion curve
    motion_x, motion_y = generate_smooth_motion_curve(frames, motion_type, direction)

    # Depth influence (continuous field)
    # Sharpen depth response slightly to boost foreground separation without blending blur.
    k = float(depth_strength) / 100.0
    depth_gamma = 1.20  # tweak 1.0–1.5
    depth_shaped = np.power(depth_refined, depth_gamma).astype(np.float32)

    # Motion multiplier around 1.0 (near/far split around 0.5)
    depth_motion = (1.0 + (depth_shaped - 0.5) * (0.90 * k)).astype(np.float32)

    # Optional stabilization: reduce motion where depth is uncertain/flat
    # (keeps thin lines/edges steadier without blurring)
    if stabilize:
        # local depth gradient magnitude
        gx = cv2.Sobel(depth_refined, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(depth_refined, cv2.CV_32F, 0, 1, ksize=3)
        grad = np.sqrt(gx * gx + gy * gy)
        grad = grad / (np.percentile(grad, 95) + 1e-6)
        grad = np.clip(grad, 0.0, 1.0)

        # areas with low gradient => flatter depth => damp motion a bit
        damp = (0.75 + 0.25 * grad).astype(np.float32)  # 0.75..1.0
    else:
        damp = 1.0

    out_frames = []
    print(f"   Generating frames: ", end="", flush=True)
    progress_step = max(1, frames // 20)

    for i, (mx, my) in enumerate(zip(motion_x, motion_y)):
        if i % progress_step == 0:
            print(f"{int(100 * i / frames)}%...", end="", flush=True)

        # Camera motion field (stronger away from focal point)
        cam_x = (mx * base_shift * distance_normalized).astype(np.float32)
        cam_y = (my * base_shift * distance_normalized * 0.6).astype(np.float32)

        # Apply depth influence + optional damping
        scale = depth_motion * damp

        map_x = (xx + cam_x * scale).astype(np.float32)
        map_y = (yy + cam_y * scale).astype(np.float32)

        np.clip(map_x, 0.0, out_w - 1.0, out=map_x)
        np.clip(map_y, 0.0, out_h - 1.0, out=map_y)

        frame = cv2.remap(
            rgb_out,
            map_x,
            map_y,
            interpolation=cv2.INTER_CUBIC,  # sharper than linear
            borderMode=cv2.BORDER_REPLICATE,
        )

        out_frames.append(frame)

    print(" ✓ Done!")
    return np.stack(out_frames, axis=0).astype(np.uint8)


@app.post("/process")
async def process(
    file: UploadFile = File(...),
    
    # Existing parameters
    depthStrength: int = Form(60),
    parallax: int = Form(60),
    stabilize: bool = Form(True),
    
    # Motion parameters
    speed: int = Form(500),
    focalPointX: float = Form(0.5),
    focalPointY: float = Form(0.5),
    motionType: str = Form("orbit"),
    direction: str = Form("clockwise"),  # NEW: clockwise or counterclockwise
        
    dollyZoom: float = Form(0.08),
    loop: bool = Form(True),

    # Quality preset
    quality: str = Form("balanced"),  # NEW: fast, balanced, high
):
    try:
        # Validate parameters
        depth_strength = int(np.clip(depthStrength, 0, 100))
        parallax_val = int(np.clip(parallax, 0, 100))
        speed_val = int(np.clip(speed, 0, 200))
        focal_x = float(np.clip(focalPointX, 0.0, 1.0))
        focal_y = float(np.clip(focalPointY, 0.0, 1.0))
        motion = motionType if motionType in ["orbit", "drift", "zoom"] else "orbit"
        direction_val = direction if direction in ["clockwise", "counterclockwise"] else "clockwise"
        quality_val = quality if quality in ["fast", "balanced", "high"] else "balanced"
        
        # Quality presets
        QUALITY_PRESETS = {
            "fast": {
                "resolution": 720,
                "fps": 24,
                "crf": 23,
                "preset": "veryfast"
            },
            "balanced": {
                "resolution": 1080,
                "fps": 30,
                "crf": 20,
                "preset": "medium"
            },
            "high": {
                "resolution": 1080,
                "fps": 30,
                "crf": 18,
                "preset": "slow"
            }
        }
        
        preset = QUALITY_PRESETS[quality_val]
        DURATION = 15
        fps_val = preset["fps"]
        target_height = preset["resolution"]
        total_frames = DURATION * fps_val
        
        print(f"\n{'='*60}")
        print(f"📥 Processing request:")
        print(f"   Quality: {quality_val.upper()} ({target_height}p @ {fps_val}fps = {total_frames} frames)")
        print(f"   Depth: {depth_strength}%, Parallax: {parallax_val}%, Speed: {speed_val}%")
        print(f"   Focal: ({focal_x:.2f}, {focal_y:.2f})")
        print(f"   Motion: {motion} ({direction_val})")
        print(f"{'='*60}")
        
        # Read and process image
        data = await file.read()
        img = Image.open(io.BytesIO(data)).convert("RGB")
        rgb = np.array(img, dtype=np.uint8)

        print(f"📷 Input image: {rgb.shape} ({rgb.dtype})")

        # Calculate output dimensions based on quality
        out_w, out_h = aspect_scale_to_height(rgb, target_h=target_height)
        print(f"📐 Output resolution: {out_w}x{out_h}")

        # Generate depth map
        print("🔍 Generating depth map...")
        depth = depth_midas(rgb)
        depth01 = normalize_depth01(depth)
        
        # Save debug outputs
        cv2.imwrite(str(OUTPUT_DIR / "debug_rgb.png"), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        cv2.imwrite(str(OUTPUT_DIR / "debug_depth.png"), (depth01 * 255).astype(np.uint8))

        # Render parallax animation
        frames_np = render_parallax(
            rgb, 
            depth01,
            out_w=out_w, 
            out_h=out_h,
            frames=total_frames,
            depth_strength=depth_strength,
            parallax=parallax_val,
            speed=speed_val,
            focal_point_x=focal_x,
            focal_point_y=focal_y,
            motion_type=motion,
            direction=direction_val,
            stabilize=stabilize,
        )

        # Save first frame for debugging
        cv2.imwrite(str(OUTPUT_DIR / "debug_first_frame.png"), cv2.cvtColor(frames_np[0], cv2.COLOR_RGB2BGR))

        # Generate unique output ID
        out_id = os.urandom(8).hex()

        # Export video
        out_path = OUTPUT_DIR / f"{out_id}.mp4"
        frames_u8 = np.ascontiguousarray(frames_np.astype(np.uint8))

        print(f"💾 Encoding MP4 ({quality_val})...")
        iio.imwrite(
            out_path,
            frames_u8,
            fps=fps_val,
            codec="libx264",
            pixelformat="yuv420p",
            ffmpeg_params=["-crf", str(preset["crf"]), "-preset", preset["preset"], "-movflags", "+faststart"],
        )
        
        file_size_mb = out_path.stat().st_size / (1024 * 1024)
        print(f"✅ Saved MP4: {out_path} ({file_size_mb:.1f} MB)")
        print(f"{'='*60}\n")
        
        return {"ok": True, "video": f"/result/{out_id}?fmt=mp4"}

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/result/{out_id}")
def result(out_id: str, fmt: str = "mp4"):
    """Serve the generated video file"""
    fmt = fmt.lower()
    path = OUTPUT_DIR / f"{out_id}.{fmt}"
    if not path.exists():
        return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
    media = "video/mp4" if fmt == "mp4" else "image/gif"
    return FileResponse(path, media_type=media, filename=path.name)


@app.get("/")
def root():
    """Health check endpoint"""
    return {
        "status": "online",
        "device": DEVICE,
        "model": MODEL_TYPE,
        "quality_presets": ["fast", "balanced", "high"]
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
