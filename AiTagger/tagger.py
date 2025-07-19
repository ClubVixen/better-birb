import sys
import os
import json
import numpy as np
import pandas as pd
import onnxruntime as ort
from PIL import Image
from huggingface_hub import hf_hub_download

"""
Minimal headless script to use wd-eva02-large-tagger-v3 from Hugging Face.
It:
  1) Downloads model.onnx and selected_tags.csv
  2) Loads them via onnxruntime
  3) For each input image path, returns the detected tags via JSON stdout.

Usage:
  python wd_eva02_tagger.py <image_path>
"""

# Hard-coded default threshold for "general" tags (the model also has rating tags)
GENERAL_THRESHOLD = 0.35
# You can also choose a threshold for character tags, e.g. 0.85

# Where to store downloaded model files
env = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(env, 'wd_eva02_model')

MODEL_REPO = "SmilingWolf/wd-eva02-large-tagger-v3"  # The HF repo
MODEL_FILENAME = "model.onnx"
TAGS_FILENAME = "selected_tags.csv"

# We'll store:
#   session: the ONNX inference session
#   tag_names: list of tag names (strings)
#   rating_indexes: indexes for rating tags (like safe, questionable, explicit)
#   general_indexes: indexes for "general" tags
#   character_indexes: indexes for character tags
session = None
tag_names = []
rating_indexes = []
general_indexes = []
character_indexes = []

def download_model():
    os.makedirs(MODEL_DIR, exist_ok=True)

    csv_path = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=TAGS_FILENAME,
        local_dir=MODEL_DIR
    )
    model_path = hf_hub_download(
        repo_id=MODEL_REPO,
        filename=MODEL_FILENAME,
        local_dir=MODEL_DIR
    )
    return csv_path, model_path

def load_labels(csv_path):
    df = pd.read_csv(csv_path)
    # Tag names in 'name' column
    tag_names = df["name"].tolist()

    # Categories: 9 => rating, 0 => general, 4 => character
    rating_indexes = list(np.where(df["category"] == 9)[0])
    general_indexes = list(np.where(df["category"] == 0)[0])
    character_indexes = list(np.where(df["category"] == 4)[0])

    return tag_names, rating_indexes, general_indexes, character_indexes

def load_model():
    global session, tag_names, rating_indexes, general_indexes, character_indexes

    csv_path, model_path = download_model()

    # 1) Load CSV with tag definitions
    tnames, r_idx, g_idx, c_idx = load_labels(csv_path)
    tag_names = tnames
    rating_indexes = r_idx
    general_indexes = g_idx
    character_indexes = c_idx

    # 2) Create an ONNX InferenceSession
    session = ort.InferenceSession(model_path, providers=['CUDAExecutionProvider','CPUExecutionProvider'])

def prepare_image(image: Image.Image, target_size: int) -> np.ndarray:
    """Match the logic from the official wd-tagger code:
       1) Convert RGBA -> RGB
       2) Pad to square
       3) Resize to target_size
       4) Convert to BGR order
       5) Return float32 array of shape (1, H, W, 3)
    """
    if image.mode != "RGB":
        image = image.convert("RGB")

    w, h = image.size
    max_dim = max(w, h)
    pad_left = (max_dim - w) // 2
    pad_top = (max_dim - h) // 2

    padded_image = Image.new("RGB", (max_dim, max_dim), (255, 255, 255))
    padded_image.paste(image, (pad_left, pad_top))

    if max_dim != target_size:
        padded_image = padded_image.resize((target_size, target_size), Image.BICUBIC)

    # Convert to numpy float32
    image_array = np.asarray(padded_image, dtype=np.float32)
    # Convert RGB -> BGR
    image_array = image_array[:, :, ::-1]
    # Expand dims => (1, H, W, 3)
    image_array = np.expand_dims(image_array, axis=0)
    return image_array

def predict_tags(image_path: str, general_thresh=GENERAL_THRESHOLD) -> (list, str):
    """
    1) Preprocess image
    2) ONNX inference
    3) Threshold general tags at general_thresh
    4) Return (list_of_detected_tags, rating)
    """
    # 1) read image
    image = Image.open(image_path)
    # The ONNX input shape is (1, H, W, 3). We can read it from session:
    input_shape = session.get_inputs()[0].shape  # e.g. [None, 448, 448, 3]
    _, h, w, _ = input_shape

    # 2) Preprocess
    input_array = prepare_image(image, target_size=h)

    # 3) Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    preds = session.run([output_name], {input_name: input_array})[0]  # shape: (1, N_tags)
    preds = preds[0]  # shape (N_tags,)

    # 4) rating: first 4 indexes are rating?
    # Actually the code from official WD tagger picks rating from category=9
    # So let's just get rating indexes from rating_indexes
    rating_scores = [(tag_names[i], preds[i]) for i in rating_indexes]
    # The rating is whichever has the highest confidence
    rating_scores.sort(key=lambda x: x[1], reverse=True)
    rating = rating_scores[0][0]  # e.g. "safe"

    # 5) general tags => category=0
    # We'll keep tags above threshold
    general_tags = []
    for i in general_indexes:
        score = preds[i]
        if score >= general_thresh:
            tag = tag_names[i]
            general_tags.append(tag)

    # 6) (Optional) character tags => category=4, if you want them
    # We'll skip or handle same threshold
    # or do:
    # character_tags = []
    # for i in character_indexes:
    #     if preds[i] >= 0.85:
    #         character_tags.append(tag_names[i])

    return general_tags, rating

if __name__ == "__main__":
    load_model()  # downloads model.onnx, CSV, sets up session
    if len(sys.argv) < 2:
        sys.exit("No image path provided")

    image_path = sys.argv[1]
    tags, rating = predict_tags(image_path)
    # Output JSON
    print(json.dumps({"tags": tags, "rating": rating}))