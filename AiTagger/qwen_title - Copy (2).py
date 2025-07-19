# === Temporary patch: override Tensor.view with Tensor.reshape ===
try:
    import xformers.ops as xops
except ModuleNotFoundError:
    import torch.nn.functional as F
    import types
    xops = types.ModuleType("xops")
    def memory_efficient_attention(query, key, value, attn_bias=None, dropout_p=0.0, scale=None):
        # Fallback: use PyTorch's scaled_dot_product_attention (ignoring 'scale')
        return F.scaled_dot_product_attention(query, key, value, attn_mask=attn_bias, dropout_p=dropout_p)
    xops.memory_efficient_attention = memory_efficient_attention
    import sys
    sys.modules["xformers.ops"] = xops

import torch
_old_view = torch.Tensor.view

def new_view(self, *args, **kwargs):
    if not args and not kwargs:
        return self
    return _old_view(self, *args, **kwargs)

torch.Tensor.view = new_view

import sys
import os
import json
import re
from PIL import Image
from huggingface_hub import snapshot_download
from transformers import AutoModelForCausalLM, LlamaTokenizer
import random

def random_replace_words(text: str) -> str:
    # Dictionary of "word": [list_of_possible_replacements]
    synonyms = {
  "reverie": ["slutdream", "whore fantasy", "nut vision", "fap material", "jizz hallucination", "cum mirage", "dick trance", "bang delusion"],
  "sultry": ["slutty", "fuckable", "dick-teasing", "cock-hungry", "nut-baiting", "sperm-summoning", "goon worthy"],
  "beauty": ["slut", "whore", "cum target", "fuckdoll", "nut bucket", "sleeve", "meat puppet", "jizz receptacle"],
  "temptation": ["dick bait", "nut temptress", "sperm demon", "goon fuel", "cock trap", "fuck lure", "jizz siren", "wank curse"],
  "desire": ["dick thirst", "nut craving", "fucklust", "sperm hunger", "cock fever", "jizz obsession", "goon need", "wank greed"],
  "woman": ["cumdump", "fucktoy", "throat goat", "slut", "nut bank", "sperm vault", "bangmaid", "jizz sponge"],
  "girl": ["cumdump", "fucktoy", "throat goat", "slut", "nut bank", "sperm vault", "bangmaid", "jizz sponge"],
  "gaze": ["fuck-me eyes", "nut stare", "dick hypnosis", "whore look", "goon trance", "jizz invitation", "cock hypnosis", "wank bait"],
  "passion": ["rough fuck", "hate sex", "slutbreaking", "whore abuse", "meat pounding", "nut destruction", "jizz ruin", "fuck annihilation"],
  "pleasure": ["nut", "creampie", "throatpie", "fuckgasm", "jizz eruption", "sperm flood", "cock frenzy", "wank explosion"],
  "seduction": ["slut game", "whore tactics", "dick witchcraft", "pussy hypnosis", "jizz sorcery", "nut voodoo", "cock magic", "fuck alchemy"],
  "dream": ["fuck fantasy", "slut hallucination", "nut delusion", "whore mirage", "jizz illusion", "bang vision", "cock daydream", "wank nightmare"],
  "body": ["fuckmeat", "cum canvas", "nut vessel", "slut chassis", "jizz playground", "bang wagon", "cock garage", "wank material"],
  "lips": ["cock cushions", "nut collectors", "dick pillows", "jizz funnels", "throat blockers", "fuck gaskets", "sperm catchers", "bang flaps"],
  "hips": ["nut handles", "fuck levers", "jizz cranks", "bang hinges", "cock grips", "wank rails", "sperm sliders", "goon bars"],
  "moan": ["nut music", "cock symphony", "jizz anthem", "fuck hymn", "bang soundtrack", "wank melody", "sperm sonata", "goon chorus"],
  "innocence": ["rapebait", "broken-in slut", "defiled doll", "corruption candidate", "virgin whore", "unspoiled fucktoy", "naive nut sack", "pre-ruined sleeve"],
  "charm": ["whore aura", "slut magnetism", "cum charm", "dick hypnosis", "fuck pheromones", "jizz gravity", "nut spell", "goon allure"],
  "elegance": ["high-class whore", "luxury fuckdoll", "refined cumdump", "aristocrat slut", "designer fuckmeat", "champagne cumsleeve", "executive nut bucket", "bitch in pearls"],
  "grace": ["fuck poise", "slut fluidity", "cock ballet", "jizz elegance", "nut refinement", "whore posture", "bang delicacy", "goon finesse"],
  "mystery": ["fuck puzzle", "nut enigma", "cock riddle", "jizz paradox", "whore illusion", "slut maze", "bang conundrum", "goon tease"],
  "radiance": ["cum glow", "fuck shine", "slut luminescence", "jizz glitter", "nut sparkle", "whore halo", "bang aura", "goon dazzle"],
  "blush": ["fuck flush", "slut tint", "cock fever", "nut glow", "jizz blush", "whore rose", "bang heat", "goon bloom"],
  "whisper": ["cock murmur", "nut breath", "fuck hiss", "jizz sigh", "slut purr", "whore moanlet", "bang whimper", "goon tease"],
  "touch": ["dick graze", "nut brush", "fuck contact", "jizz caress", "slut grip", "whore claw", "bang grope", "goon violation"],
  "scent": ["cum musk", "fuck perfume", "slut stench", "jizz aroma", "nut pheromones", "whore reek", "bang odor", "goon bait"],
  "tease": ["cock torment", "nut denial", "fuck edging", "jizz suffering", "slut cruelty", "whore mindbreak", "bang frustration", "goon agony"],
  "control": ["fuck dominance", "slut ownership", "cock tyranny", "jizz rule", "nut command", "whore leash", "bang mastery", "goon dictatorship"],
  "submission": ["fuck slavery", "slut surrender", "cock worship", "jizz devotion", "nut obedience", "whore grovel", "bang defeat", "goon servitude"],
  "ecstasy": ["nut high", "cock euphoria", "fuck delirium", "jizz madness", "slut overload", "whore ruin", "bang collapse", "goon oblivion"],
  "torment": ["fuck torture", "cock suffering", "nut anguish", "jizz misery", "slut despair", "whore agony", "bang punishment", "goon hell"],
  "obsession": ["dick madness", "nut fixation", "fuck mania", "jizz possession", "slut addiction", "whore fever", "bang compulsion", "goon curse"],
  "fantasy": ["rape dream", "gangbang vision", "freeuse mirage", "breeding hallucination", "slut nightmare", "whore delusion", "fuck trance", "goon illusion"],
  "heaven": ["cum paradise", "fuck nirvana", "nut utopia", "jizz Eden", "slut Valhalla", "whore Olympus", "bang Elysium", "goon bliss"],
  "hell": ["fuck inferno", "nut abyss", "cock torment", "jizz perdition", "slut damnation", "whore void", "bang suffering", "goon nightmare"]
}


    # For each word in the dictionary, do a case-insensitive replace
    # with a randomly chosen synonym.
    for original_word, replacements in synonyms.items():
        pattern = re.compile(rf"\b({original_word})\b", re.IGNORECASE)

        def replacer(match):
            # pick a random replacement
            new_word = random.choice(replacements)
            
            # preserve capitalization if the match was capitalized
            if match.group(1)[0].isupper():
                new_word = new_word.capitalize()
            return new_word

        text = pattern.sub(replacer, text)

    return text

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python cogvlm_title.py <image_path> <comma_separated_tags> <rating>")
        sys.exit(1)

    image_path = sys.argv[1]
    booru_tags_str = sys.argv[2]
    rating = sys.argv[3]  # e.g. "Safe", "Suggestive", or "Explicit"

    
###############################################################################
# 1) Constants & Setup
###############################################################################
DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

DEFAULT_GENERATE_PARAMS = {
    "do_sample": False,
    "max_new_tokens": 80,
}

# Repository IDs for the model and tokenizer
COGVLM_REPO_ID    = "THUDM/cogvlm-chat-hf"
VICUNA_TOKENIZER  = "lmsys/vicuna-7b-v1.5"

# Local folders for model and tokenizer
env_dir = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(env_dir, "cogvlm_chat_hf")
TOKENIZER_DIR = os.path.join(env_dir, "vicuna-7b-v1.5")
BASE_PROMPT = (
    "Write a highly sexual title for this image. Focus on graphic sex acts mentioned in the tags to help make the title. The title must sound like porn, not just suggestive. Use slutty, demeaning language. it should be readable and understandable sitll "
    "Use these booru tags to guide your title: "
)


###############################################################################
# 2) Helper: Possibly resize the input image
###############################################################################
def maybe_resize_image(original_path: str, max_dim=1024) -> str:
    try:
        with Image.open(original_path) as im:
            w, h = im.size
            if max(w, h) <= max_dim:
                return original_path
            ratio = max_dim / float(max(w, h))
            new_w = int(w * ratio)
            new_h = int(h * ratio)
            resized = im.resize((new_w, new_h), Image.LANCZOS)
            new_path = original_path + ".resized.png"
            resized.save(new_path, "PNG")
            return new_path
    except Exception as e:
        print(f"Warning: could not open/resize {original_path}, using original. Error: {e}")
        return original_path

###############################################################################
# 3) Ensure local download of model & tokenizer
###############################################################################
def ensure_repo_download(local_dir: str, repo_id: str):
    if not os.path.exists(local_dir):
        print(f"Downloading {repo_id} into {local_dir} ...", file=sys.stderr)
        snapshot_download(repo_id=repo_id, local_dir=local_dir)

def ensure_cogvlm_and_tokenizer():
    ensure_repo_download(MODEL_DIR, COGVLM_REPO_ID)
    ensure_repo_download(TOKENIZER_DIR, VICUNA_TOKENIZER)

###############################################################################
# 4) Main: Title Generation using CogVLM
###############################################################################
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python cogvlm_title.py <image_path> <comma_separated_tags>")
        sys.exit(1)

    image_path = sys.argv[1]
    booru_tags_str = sys.argv[2].strip()

    # Possibly resize the image
    resized_path = maybe_resize_image(image_path, max_dim=1024)

    # Build the final prompt text
    prompt_text = BASE_PROMPT + booru_tags_str

    # Ensure model & tokenizer are downloaded locally
    ensure_cogvlm_and_tokenizer()

    # Load the tokenizer
    tokenizer = LlamaTokenizer.from_pretrained(TOKENIZER_DIR)

    # Load CogVLM model
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_DIR,
        torch_dtype=DTYPE,
        trust_remote_code=True,
        low_cpu_mem_usage=True
    ).to(DEVICE)

    # Optional: override Tensor.view = reshape
    # (We do this after loading model so it doesn't conflict with safetensors reading)
    torch.Tensor.view = lambda self, *args, **kwargs: self.reshape(*args, **kwargs)

    # Convert the image to RGB
    with Image.open(resized_path) as pil_img:
        if pil_img.mode == "RGBA":
            pil_img = pil_img.convert("RGB")
        inputs = model.build_conversation_input_ids(
            tokenizer=tokenizer,
            query=prompt_text,
            history=[],
            images=[pil_img],
        )

    input_ids = inputs["input_ids"].unsqueeze(0).to(DEVICE)
    token_type_ids = inputs["token_type_ids"].unsqueeze(0).to(DEVICE)
    attention_mask = inputs["attention_mask"].unsqueeze(0).to(DEVICE)
    images_tensor = inputs["images"][0].to(DEVICE, dtype=DTYPE)
    images = [[images_tensor]]

    # Generate caption
    with torch.no_grad():
        outputs = model.generate(
            input_ids=input_ids,
            token_type_ids=token_type_ids,
            attention_mask=attention_mask,
            images=images,
            **DEFAULT_GENERATE_PARAMS
        )

    # Remove the original prompt tokens
    prompt_len = input_ids.shape[1]
    outputs = outputs[:, prompt_len:]

    # Decode the text
    result = tokenizer.decode(outputs[0], skip_special_tokens=True).strip()
    if result.endswith("</s>"):
        result = result[:-4].strip()

    # Remove leading fluff if any
    result = re.sub(r"(?i)^(title:|a potential title could be|.*title.*?:)\s*", "", result).strip()
    result = result.strip("'\"")
    # skip synonyms if rating is safe
    if rating.lower() != "safe":
        result = random_replace_words(result)
    result = result.rstrip(".'")

    print(json.dumps({"title": result}))

    # Optionally restore the original .view
    torch.Tensor.view = _old_view

    # Finally, kill the process to free GPU memory
    import sys
    sys.exit(0)
