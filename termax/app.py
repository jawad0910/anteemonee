# termax/app.py
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

API_KEY = "kira_c39529cf2c411605aa4b38bde3bb2fd4"
API_URL = "https://api.kira.ai/v1/chat"

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json.get("message")

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "message": user_message
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload)
        response.raise_for_status()
        bot_response = response.json().get("response", "Sorry, I didn't understand that.")
    except requests.exceptions.HTTPError as http_err:
        bot_response = f"HTTP error occurred: {http_err}"
    except requests.exceptions.ConnectionError as conn_err:
        bot_response = f"Connection error occurred: {conn_err}"
    except requests.exceptions.Timeout as timeout_err:
        bot_response = f"Timeout error occurred: {timeout_err}"
    except requests.exceptions.RequestException as req_err:
        bot_response = f"An error occurred: {req_err}"

    return jsonify({"response": bot_response})

if __name__ == "__main__":
    app.run(debug=True)