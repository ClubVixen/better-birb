from gradio_client import Client

# The URL/port your Gradio app is running on:
client = Client("http://127.0.0.1:8122")

# For instance, let's call 'predict' with a text, no image, empty chatbot & history, typical numeric parameters, and model name:
result = client.predict(
    "describe this image",  # text (arg1)
    "test.jpg",                          # image (arg2) - or "my_image.jpg" if you have an image
    [],                            # chatbot (arg3)
    [],                            # history (arg4)
    0.95,                          # top_p (arg5)
    0.1,                           # temperature (arg6)
    1.1,                           # repetition_penalty (arg7)
    2048,                          # max_length_tokens (arg8)
    4096,                          # max_context_length_tokens (arg9)
    "DeepSeek-VL 7B",              # model_select_dropdown (arg10)
    api_name="/predict_image"             # or fn_index=0, whichever your app sets
)

print("Result:", result)