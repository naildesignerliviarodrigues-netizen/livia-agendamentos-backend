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
    customer_name = payload.get("customer_name") or "Cliente Studio Lívia"
    customer_phone = payload.get("customer_phone")
    value = payload.get("value")
    description = payload.get("description", "Sinal de agendamento - Studio Lívia Rodrigues")

    if not all([appointment_id, value]):
        return jsonify({"ok": False, "error": "appointment_id e value são obrigatórios"}), 400

    if not ASAAS_API_KEY:
        return jsonify({"ok": False, "error": "ASAAS_API_KEY não configurada"}), 500

    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "access_token": ASAAS_API_KEY
    }

    # Melhor fluxo para não pedir CPF dentro do app:
    # cria um link de pagamento no Asaas; se o Asaas precisar CPF, ele pede na página dele.
    link_payload = {
        "name": description,
        "description": f"Cliente: {customer_name} | Tel: {customer_phone or ''} | Reserva: {appointment_id}",
        "value": float(value),
        "billingType": "PIX",
        "chargeType": "DETACHED",
        "dueDateLimitDays": 1,
        "subscriptionCycle": None,
        "externalReference": appointment_id
    }

    link_resp = requests.post(
        f"{ASAAS_BASE_URL}/paymentLinks",
        json=link_payload,
        headers=headers,
        timeout=20
    )

    if link_resp.status_code in [200, 201]:
        link = link_resp.json()
        payment_url = (
            link.get("url")
            or link.get("paymentUrl")
            or link.get("invoiceUrl")
            or link.get("checkoutUrl")
        )

        return jsonify({
            "ok": True,
            "mode": "payment_link",
            "payment_id": link.get("id"),
            "invoice_url": payment_url,
            "pix_payload": "",
            "encoded_image": "",
            "expiration_date": link.get("expirationDate")
        })

    return jsonify({
        "ok": False,
        "step": "payment_link",
        "asaas_status": link_resp.status_code,
        "asaas": link_resp.text
    }), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
