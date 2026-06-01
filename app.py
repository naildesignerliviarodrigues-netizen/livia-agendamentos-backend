import os
import re
from datetime import datetime, timedelta

import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)

FIREBASE_DB_URL = os.getenv("FIREBASE_DB_URL", "").rstrip("/")
ASAAS_API_KEY = os.getenv("ASAAS_API_KEY", "")
ASAAS_BASE_URL = os.getenv("ASAAS_BASE_URL", "https://api.asaas.com/v3").rstrip("/")
ASAAS_PIX_KEY = os.getenv("ASAAS_PIX_KEY", "naildesignerliviarodrigues@gmail.com").strip()

PAID_EVENTS = {
    "PAYMENT_RECEIVED",
    "PAYMENT_CONFIRMED",
    "PAYMENT_APPROVED",
    "PIX_RECEIVED",
    "PIX_TRANSACTION_RECEIVED"
}


def firebase_url(path):
    return f"{FIREBASE_DB_URL}/{path.strip('/')}.json"


def asaas_headers():
    return {
        "accept": "application/json",
        "content-type": "application/json",
        "access_token": ASAAS_API_KEY,
        "User-Agent": "StudioLiviaBackend/2.0"
    }


def asaas_error_text(resp):
    try:
        data = resp.json()
        errors = data.get("errors")
        if isinstance(errors, list) and errors:
            return " | ".join([str(e.get("description") or e.get("message") or e) for e in errors])
        return str(data)
    except Exception:
        return resp.text


def patch_appointment(appointment_id, fields):
    if not appointment_id or not FIREBASE_DB_URL:
        return False, 0
    r = requests.patch(firebase_url(f"appointments/{appointment_id}"), json=fields, timeout=10)
    return r.status_code in [200, 204], r.status_code


def extract_appointment_id(data):
    payment = data.get("payment") or {}
    external = payment.get("externalReference")
    if external:
        return external

    raw = str(data)
    match = re.search(r"APPT:([A-Za-z0-9_\-]+)", raw)
    if match:
        return match.group(1)

    return None


@app.get("/")
def home():
    return jsonify({
        "ok": True,
        "service": "Studio Lívia Rodrigues Backend",
        "version": "2.0-hybrid-pix",
        "time": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "asaas_base_url": ASAAS_BASE_URL,
        "firebase_configured": bool(FIREBASE_DB_URL),
        "asaas_key_configured": bool(ASAAS_API_KEY),
        "asaas_pix_key_configured": bool(ASAAS_PIX_KEY)
    })


@app.route("/asaas/webhook", methods=["POST", "OPTIONS"])
def asaas_webhook():
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200

    data = request.get_json(silent=True) or {}
    event = data.get("event")
    appointment_id = extract_appointment_id(data)

    print("ASAAS_WEBHOOK", event, appointment_id, flush=True)

    if not appointment_id:
        return jsonify({"ok": True, "ignored": "missing appointment reference"})

    if event in PAID_EVENTS:
        payment = data.get("payment") or {}
        pix_transaction = data.get("pixTransaction") or data.get("transaction") or {}

        patch = {
            "status": "pago",
            "payment_status": "paid",
            "paid_at": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "asaas_payment_id": payment.get("id") or pix_transaction.get("id"),
            "asaas_event": event,
            "admin_seen": False
        }

        ok, firebase_status = patch_appointment(appointment_id, patch)
        return jsonify({
            "ok": ok,
            "firebase_status": firebase_status,
            "appointment_id": appointment_id,
            "event": event
        })

    return jsonify({"ok": True, "ignored_event": event, "appointment_id": appointment_id})


def create_customer(customer_name, customer_phone, customer_cpf_cnpj):
    payload = {
        "name": customer_name,
        "cpfCnpj": "".join(filter(str.isdigit, str(customer_cpf_cnpj)))
    }
    if customer_phone:
        payload["mobilePhone"] = "".join(filter(str.isdigit, str(customer_phone)))

    resp = requests.post(
        f"{ASAAS_BASE_URL}/customers",
        json=payload,
        headers=asaas_headers(),
        timeout=20
    )

    if resp.status_code not in [200, 201]:
        return False, None, asaas_error_text(resp), resp.status_code

    return True, resp.json().get("id"), None, resp.status_code


def create_payment_pix(appointment_id, customer_id, value, description):
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
        headers=asaas_headers(),
        timeout=20
    )

    if payment_resp.status_code not in [200, 201]:
        return False, None, asaas_error_text(payment_resp), payment_resp.status_code

    payment = payment_resp.json()
    payment_id = payment.get("id")

    qr_resp = requests.get(
        f"{ASAAS_BASE_URL}/payments/{payment_id}/pixQrCode",
        headers=asaas_headers(),
        timeout=20
    )

    if qr_resp.status_code != 200:
        return False, None, asaas_error_text(qr_resp), qr_resp.status_code

    qr_data = qr_resp.json()

    return True, {
        "ok": True,
        "mode": "payment_pix",
        "payment_id": payment_id,
        "invoice_url": payment.get("invoiceUrl"),
        "pix_payload": qr_data.get("payload"),
        "encoded_image": qr_data.get("encodedImage"),
        "expiration_date": qr_data.get("expirationDate")
    }, None, 200


def create_static_pix_qrcode(appointment_id, value, description):
    if not ASAAS_PIX_KEY:
        return False, None, "ASAAS_PIX_KEY não configurada no Render", 500

    expiration = (datetime.now() + timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")

    payload = {
        "addressKey": ASAAS_PIX_KEY,
        "description": f"{description} | APPT:{appointment_id}",
        "value": float(value),
        "allowsMultiplePayments": False,
        "expirationDate": expiration
    }

    resp = requests.post(
        f"{ASAAS_BASE_URL}/pix/qrCodes/static",
        json=payload,
        headers=asaas_headers(),
        timeout=20
    )

    if resp.status_code not in [200, 201]:
        return False, None, asaas_error_text(resp), resp.status_code

    data = resp.json()

    return True, {
        "ok": True,
        "mode": "static_pix_qrcode",
        "payment_id": data.get("id") or f"static-{appointment_id}",
        "invoice_url": "",
        "pix_payload": data.get("payload") or data.get("encodedValue") or data.get("copyPaste") or "",
        "encoded_image": data.get("encodedImage") or data.get("qrCode") or "",
        "expiration_date": data.get("expirationDate") or expiration
    }, None, 200


@app.route("/create-payment", methods=["POST", "OPTIONS"])
def create_payment():
    if request.method == "OPTIONS":
        return jsonify({"ok": True}), 200

    payload = request.get_json(silent=True) or {}

    appointment_id = payload.get("appointment_id")
    customer_name = payload.get("customer_name")
    customer_phone = payload.get("customer_phone")
    customer_cpf_cnpj = payload.get("customer_cpf_cnpj") or payload.get("cpf_cnpj")
    value = payload.get("value")
    description = payload.get("description", "Sinal de agendamento - Studio Lívia Rodrigues")

    if not all([appointment_id, customer_name, customer_cpf_cnpj, value]):
        return jsonify({
            "ok": False,
            "error": "Dados obrigatórios faltando: appointment_id, customer_name, customer_cpf_cnpj e value"
        }), 400

    if not ASAAS_API_KEY:
        return jsonify({"ok": False, "error": "ASAAS_API_KEY não configurada no Render"}), 500

    customer_ok, customer_id, customer_error, customer_status = create_customer(
        customer_name,
        customer_phone,
        customer_cpf_cnpj
    )

    if not customer_ok:
        print("ASAAS_CUSTOMER_ERROR", customer_status, customer_error, flush=True)
        return jsonify({
            "ok": False,
            "step": "customer",
            "error": customer_error,
            "asaas_status": customer_status
        }), 400

    payment_ok, payment_data, payment_error, payment_status = create_payment_pix(
        appointment_id,
        customer_id,
        value,
        description
    )

    if payment_ok:
        print("ASAAS_PAYMENT_PIX_OK", appointment_id, payment_data.get("payment_id"), flush=True)
        return jsonify(payment_data)

    print("ASAAS_PAYMENT_PIX_ERROR", payment_status, payment_error, flush=True)

    static_ok, static_data, static_error, static_status = create_static_pix_qrcode(
        appointment_id,
        value,
        description
    )

    if static_ok:
        print("ASAAS_STATIC_PIX_OK", appointment_id, static_data.get("payment_id"), flush=True)
        return jsonify(static_data)

    print("ASAAS_STATIC_PIX_ERROR", static_status, static_error, flush=True)

    return jsonify({
        "ok": False,
        "step": "payment_and_static_pix",
        "error": f"Falhou cobrança Pix oficial: {payment_error} | Falhou Pix direto: {static_error}",
        "asaas_status": payment_status,
        "static_status": static_status
    }), 400


if __name__ == "__main__":
    port = int(os.getenv("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
