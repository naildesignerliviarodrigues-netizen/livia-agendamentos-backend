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
        "User-Agent": "StudioLiviaBackend/2.2"
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


def firebase_safe_key(value):
    """Firebase Realtime DB não aceita alguns caracteres em chaves."""
    return re.sub(r"[^A-Za-z0-9_\-]", "_", str(value or ""))


def save_static_pix_map(static_pix_id, appointment_id):
    """Liga o ID do Pix estático do Asaas ao ID do agendamento."""
    if not static_pix_id or not appointment_id or not FIREBASE_DB_URL:
        return False, 0
    payload = {
        "appointment_id": appointment_id,
        "static_pix_id": static_pix_id,
        "created_at": datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    }
    key = firebase_safe_key(static_pix_id)
    r = requests.put(firebase_url(f"pix_static_map/{key}"), json=payload, timeout=10)
    return r.status_code in [200, 204], r.status_code


def lookup_static_pix_map(static_pix_id):
    """Busca o agendamento usando o ID do Pix estático."""
    if not static_pix_id or not FIREBASE_DB_URL:
        return None
    key = firebase_safe_key(static_pix_id)
    try:
        r = requests.get(firebase_url(f"pix_static_map/{key}"), timeout=10)
        if r.status_code != 200:
            return None
        data = r.json() or {}
        return data.get("appointment_id")
    except Exception as exc:
        print("STATIC_PIX_MAP_LOOKUP_ERROR", static_pix_id, exc, flush=True)
        return None




def get_payment_value(data):
    payment = data.get("payment") or {}
    pix_transaction = data.get("pixTransaction") or data.get("transaction") or {}
    for source in (payment, pix_transaction, data):
        for key in ("value", "netValue", "originalValue", "amount"):
            try:
                if source.get(key) is not None:
                    return round(float(source.get(key)), 2)
            except Exception:
                pass
    return None


def parse_any_datetime(value):
    if not value:
        return None
    value = str(value).strip()
    formats = [
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M:%S"
    ]
    for fmt in formats:
        try:
            return datetime.strptime(value[:26] if "%f" in fmt else value[:19], fmt)
        except Exception:
            continue
    return None


def normalize_firebase_appointments(data):
    if not isinstance(data, dict):
        return []
    items = []
    for key, value in data.items():
        if isinstance(value, dict):
            item = dict(value)
            item.setdefault("id", key)
            items.append(item)
    return items


def find_pending_appointment_for_static_pix(data):
    """Plano B para Pix estático: webhook veio com pay_..., mas sem externalReference.
    Procura no Firebase a reserva temporária mais provável pelo valor e janela de 10 minutos.
    """
    if not FIREBASE_DB_URL:
        return None

    payment_value = get_payment_value(data)
    now = datetime.now()

    try:
        r = requests.get(firebase_url("appointments"), timeout=10)
        if r.status_code != 200:
            print("STATIC_PIX_FIND_FIREBASE_ERROR", r.status_code, flush=True)
            return None

        appointments = normalize_firebase_appointments(r.json() or {})
        candidates = []

        for item in appointments:
            status = str(item.get("status") or "").lower()
            payment_status = str(item.get("payment_status") or "").lower()

            is_pending = (
                "reservado_aguardando_pagamento" in status
                or "tempor" in status
                or payment_status in ("waiting_payment", "", "none")
            )
            if not is_pending:
                continue

            try:
                deposit = round(float(str(item.get("deposit") or "0").replace(",", ".")), 2)
            except Exception:
                deposit = 0.0

            if payment_value is not None and abs(deposit - payment_value) > 0.01:
                continue

            expires_dt = parse_any_datetime(item.get("expires_at") or item.get("expiresAt"))
            created_dt = parse_any_datetime(item.get("created_at") or item.get("createdAt"))

            # aceita reservas ainda dentro do prazo ou recém-expiradas, para tolerar atraso do webhook
            if expires_dt and now > (expires_dt + timedelta(minutes=20)):
                continue

            sort_dt = created_dt or expires_dt or now
            candidates.append((sort_dt, item))

        if not candidates:
            print("STATIC_PIX_FIND_NO_CANDIDATE", payment_value, flush=True)
            return None

        candidates.sort(key=lambda pair: pair[0], reverse=True)
        chosen = candidates[0][1]
        print("STATIC_PIX_AUTO_MATCH", chosen.get("id"), payment_value, len(candidates), flush=True)
        return chosen.get("id")

    except Exception as exc:
        print("STATIC_PIX_FIND_ERROR", exc, flush=True)
        return None

def extract_payment_or_pix_id(data):
    payment = data.get("payment") or {}
    pix_transaction = data.get("pixTransaction") or data.get("transaction") or {}

    candidates = [
        payment.get("id"),
        payment.get("paymentId"),
        payment.get("pixQrCodeId"),
        payment.get("endToEndIdentifier"),
        pix_transaction.get("id"),
        pix_transaction.get("paymentId"),
        pix_transaction.get("pixQrCodeId"),
        pix_transaction.get("endToEndIdentifier"),
        data.get("id"),
        data.get("paymentId"),
        data.get("pixQrCodeId")
    ]

    raw = str(data)
    match = re.search(r"(\d{12,}ASA)", raw)
    if match:
        candidates.append(match.group(1))

    for item in candidates:
        if item:
            return str(item)
    return None


def extract_appointment_id(data):
    payment = data.get("payment") or {}

    # Cobrança Pix oficial: vem com externalReference.
    external = payment.get("externalReference") or data.get("externalReference")
    if external:
        return external

    # Fallback antigo: tenta achar APPT:<id> em qualquer parte do payload.
    raw = str(data)
    match = re.search(r"APPT:([A-Za-z0-9_\-]+)", raw)
    if match:
        return match.group(1)

    # Pix estático: o Asaas não manda externalReference.
    # Então buscamos o ID do QR/transação recebido e consultamos o mapa salvo
    # quando o QR Code foi gerado.
    pix_id = extract_payment_or_pix_id(data)
    mapped = lookup_static_pix_map(pix_id)
    if mapped:
        return mapped

    # O Asaas pode mandar PAYMENT_RECEIVED com id pay_... diferente do id ...ASA
    # salvo quando o QR estático foi criado. Nesse caso, localizamos a reserva
    # temporária pelo valor recebido e pela janela de expiração.
    fallback = find_pending_appointment_for_static_pix(data)
    if fallback:
        if pix_id:
            save_static_pix_map(pix_id, fallback)
        return fallback

    return None


@app.get("/")
def home():
    return jsonify({
        "ok": True,
        "service": "Studio Lívia Rodrigues Backend",
        "version": "2.2-static-pix-auto-match",
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

    pix_or_payment_id = extract_payment_or_pix_id(data)
    print("ASAAS_WEBHOOK", event, appointment_id, pix_or_payment_id, flush=True)

    if not appointment_id:
        return jsonify({
            "ok": True,
            "ignored": "missing appointment reference",
            "pix_or_payment_id": pix_or_payment_id
        })

    if event in PAID_EVENTS:
        payment = data.get("payment") or {}
        pix_transaction = data.get("pixTransaction") or data.get("transaction") or {}

        patch = {
            "status": "pago",
            "payment_status": "paid",
            "paid_at": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
            "asaas_payment_id": payment.get("id") or pix_transaction.get("id") or pix_or_payment_id,
            "asaas_event": event,
            "admin_seen": False
        }

        ok, firebase_status = patch_appointment(appointment_id, patch)
        print("ASAAS_MARK_PAID", appointment_id, ok, firebase_status, flush=True)
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

    # O Asaas limita a descrição do QR Code estático a 37 caracteres.
    # Por isso deixamos curta. O ID do agendamento fica salvo no Firebase
    # e o Pix ainda aparece para a cliente pagar normalmente.
    payload = {
        "addressKey": ASAAS_PIX_KEY,
        "description": "Sinal Studio Livia",
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
    static_pix_id = data.get("id") or data.get("pixQrCodeId") or f"static-{appointment_id}"

    map_ok, map_status = save_static_pix_map(static_pix_id, appointment_id)
    print("ASAAS_STATIC_PIX_MAP", static_pix_id, appointment_id, map_ok, map_status, flush=True)

    # Também gravamos no agendamento para facilitar auditoria no Firebase.
    patch_appointment(appointment_id, {
        "asaas_static_pix_id": static_pix_id,
        "payment_mode": "static_pix_qrcode"
    })

    return True, {
        "ok": True,
        "mode": "static_pix_qrcode",
        "payment_id": static_pix_id,
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
