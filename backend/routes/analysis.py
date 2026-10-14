import os
from io import BytesIO
from fastapi import APIRouter, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

router = APIRouter(tags=["AI Image Analysis"])
_model = None
_model_error = None

def get_model():
    global _model, _model_error
    if _model is not None: return _model
    if _model_error: raise RuntimeError(_model_error)
    if os.getenv("ENABLE_AI", "true").lower() != "true":
        raise RuntimeError("AI is disabled. Set ENABLE_AI=true in backend/.env")
    try:
        from ultralytics import YOLO
        _model = YOLO(os.getenv("YOLO_MODEL", "yolo11n.pt"))
        return _model
    except Exception as exc:
        _model_error = f"Could not load YOLO model: {exc}"
        raise RuntimeError(_model_error)

@router.post("/analyze-image")
async def analyze_image(image: UploadFile = File(...)):
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=400, detail="Upload JPG, PNG or WEBP")
    raw = await image.read()
    if not raw or len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image must be non-empty and at most 5 MB")
    try:
        pil_image = Image.open(BytesIO(raw)).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="Invalid image")
    try:
        result = get_model().predict(pil_image, verbose=False)[0]
        detections = []
        for box in result.boxes:
            class_id = int(box.cls[0].item())
            detections.append({
                "label": result.names.get(class_id, str(class_id)),
                "confidence": round(float(box.conf[0].item()), 4),
                "box_xyxy": [round(float(v), 1) for v in box.xyxy[0].tolist()]
            })
        return {
            "model": os.getenv("YOLO_MODEL", "yolo11n.pt"),
            "task": "general_object_detection",
            "count": len(detections),
            "detections": detections,
            "warning": "General object detection does not establish disaster type, severity, authenticity, or whether someone is trapped. Human verification is required."
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Image analysis failed: {exc}")
