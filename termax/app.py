# termax/app.py
from flask import Flask, render_template, request, jsonify
import requests
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.DEBUG)

API_KEY = "kira_c39529cf2c411605aa4b38bde3bb2fd4"
API_URL = "https://api.kira.ai/v1/chat/completions"  # Added /completions
MODEL = "glm-5.3-free"

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message")
    app.logger.debug(f"Received message: {user_message}")

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.7
    }

    try:
        app.logger.debug(f"Sending request to: {API_URL}")
        response = requests.post(API_URL, headers=headers, json=payload, timeout=10)
        app.logger.debug(f"Response status: {response.status_code}")
        response.raise_for_status()

        data = response.json()
        app.logger.debug(f"Full response: {data}")

        if "choices" in data and len(data["choices"]) > 0:
            bot_response = data["choices"][0]["message"]["content"]
        else:
            bot_response = "Sorry, I didn't understand that."

    except requests.exceptions.RequestException as e:
        app.logger.error(f"Request failed: {str(e)}")
        bot_response = f"API Error: {str(e)}"

    return jsonify({"response": bot_response})

if __name__ == "__main__":
    app.run(debug=True)