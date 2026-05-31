import os
from datetime import datetime

import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL", "").rstrip("/")
ASAAS_API_KEY = os.getenv("ASAAS_API_KEY", "")
ASAAS_BASE_URL = os.getenv("ASAAS_BASE_URL", "https://api.asaas.com/v3").rstrip("/")


def firebase_url(path):
    return f"{FIREBASE_DB_URL}/{path.strip('/')}.json"


@app.get("/")
def home():
    return jsonify({
        "ok": True,
        "service": "Studio Lívia Rodrigues Backend",
        "time": datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    })


@app.post("/asaas/webhook")
def asaas_webhook():
    data = request.get_json(silent=True) or {}

    event = data.get("event")
    payment = data.get("payment") or {}
    external_reference = payment.get("externalReference")

    if not external_reference:
        return jsonify({"ok": True, "ignored": "missing externalReference"})

    paid_events = {
        "PAYMENT_RECEIVED",
        "PAYMENT_CONFIRMED",
        "PAYMENT_APPROVED"
    }

    if event in paid_events:
        patch = {
            "status": "pago",
            "paid_at": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "asaas_payment_id": payment.get("id"),
            "asaas_event": event,
            "admin_seen": False
        }

        r = requests.patch(firebase_url(f"appointments/{external_reference}"), json=patch, timeout=10)
        return jsonify({
            "ok": r.status_code in [200, 204],
            "firebase_status": r.status_code,
            "appointment_id": external_reference
        })

    return jsonify({"ok": True, "ignored_event": event})


@app.post("/create-payment")
def create_payment():
    payload = request.get_json(silent=True) or {}

    appointment_id = payload.get("appointment_id")
    customer_name = payload.get("customer_name")
    customer_phone = payload.get("customer_phone")
    customer_cpf_cnpj = payload.get("customer_cpf_cnpj") or payload.get("cpf_cnpj")
    value = payload.get("value")
    description = payload.get("description", "Sinal de agendamento - Studio Lívia Rodrigues")

    if not all([appointment_id, customer_name, value, customer_cpf_cnpj]):
        return jsonify({"ok": False, "error": "appointment_id, customer_name, customer_cpf_cnpj e value são obrigatórios"}), 400

    if not ASAAS_API_KEY:
        return jsonify({"ok": False, "error": "ASAAS_API_KEY não configurada"}), 500

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "access_token": ASAAS_API_KEY
    }

    customer_payload = {
        "name": customer_name,
        "cpfCnpj": "".join(filter(str.isdigit, str(customer_cpf_cnpj)))
    }
    if customer_phone:
        customer_payload["mobilePhone"] = "".join(filter(str.isdigit, str(customer_phone)))

    customer_resp = requests.post(
        f"{ASAAS_BASE_URL}/customers",
        json=customer_payload,
        headers=headers,
        timeout=15
    )

    if customer_resp.status_code not in [200, 201]:
        return jsonify({"ok": False, "step": "customer", "asaas": customer_resp.text}), 400

    customer_id = customer_resp.json().get("id")

    payment_payload = {
        "customer": customer_id,
        "billingType": "PIX",
        "value": float(value),
        "dueDate": datetime.now().strftime("%Y-%m-%d"),
        "description": description,
        "externalReference": appointment_id
    }

    payment_resp = requests.post(
        f"{ASAAS_BASE_URL}/payments",
        json=payment_payload,
        headers=headers,
        timeout=15
    )

    if payment_resp.status_code not in [200, 201]:
        return jsonify({"ok": False, "step": "payment", "asaas": payment_resp.text}), 400

    payment = payment_resp.json()
    payment_id = payment.get("id")

    qr_resp = requests.get(
        f"{ASAAS_BASE_URL}/payments/{payment_id}/pixQrCode",
        headers=headers,
        timeout=15
    )

    qr_data = qr_resp.json() if qr_resp.status_code == 200 else {}

    return jsonify({
        "ok": True,
        "payment_id": payment_id,
        "invoice_url": payment.get("invoiceUrl"),
        "pix_payload": qr_data.get("payload"),
        "encoded_image": qr_data.get("encodedImage"),
        "expiration_date": qr_data.get("expirationDate")
    })


if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
