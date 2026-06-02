const services = [
    { id: "gel-tips", name: "Gel na tips", price: 120, durationText: "1h30 a 2h", durationMinutes: 120 },
    { id: "fibra-vidro", name: "Fibra de vidro", price: 140, durationText: "2h", durationMinutes: 120 },
    { id: "manutencao-gel-tips", name: "Manutenção - Gel na tips", price: 110, durationText: "1h30 a 2h", durationMinutes: 120 },
    { id: "manutencao-fibra-vidro", name: "Manutenção - Fibra de vidro", price: 120, durationText: "1h30 a 2h", durationMinutes: 120 },
    { id: "banho-gel", name: "Banho de gel", price: 90, durationText: "1h30 a 2h", durationMinutes: 120 },
    { id: "esmaltacao-gel", name: "Esmaltação em gel", price: 70, durationText: "1h", durationMinutes: 60 },
    { id: "manicure-pedicure", name: "Manicure e pedicure", price: 55, durationText: "aprox. 2h", durationMinutes: 120 },
    { id: "manicure", name: "Manicure", price: 35, durationText: "40min a 1h", durationMinutes: 60 },
    { id: "pedicure", name: "Pedicure", price: 35, durationText: "40min a 1h", durationMinutes: 60 },
    { id: "postica", name: "Postiça", price: 35, durationText: "1h", durationMinutes: 60 },
    { id: "postica-realista", name: "Postiça realista", price: 60, durationText: "1h30", durationMinutes: 90 },
    { id: "plastica-pes", name: "Plástica dos pés", price: 70, durationText: "2h", durationMinutes: 120 },
    { id: "depilacao-axila", name: "Depilação de axila", price: 30, durationText: "30min", durationMinutes: 30 }
];

const defaultWorks = ["assets/trabalho_1.png", "assets/trabalho_2.png", "assets/trabalho_3.png"];
let works = [...defaultWorks];

let currentPhoto = 0;
let selectedService = null;
let selectedDate = null;
let selectedDateBR = "";
let selectedDateObj = null;
let selectedTime = null;
let clientData = { name: "", phone: "", cpf: "" };
let pixPayload = "";
let currentBookingId = null;
let pixCountdownTimer = null;

const FIREBASE_DB_URL = "https://studio-livia-rodrigues-default-rtdb.firebaseio.com";
const BACKEND_URL = "https://livia-agendamentos-backend.onrender.com";
const PENDING_EXPIRE_MINUTES = 10;
let appointmentsCache = [];
let firebaseOnline = true;
let appointmentsRealtimeTimer = null;

const screens = {
    home: document.getElementById("homeScreen"),
    services: document.getElementById("servicesScreen"),
    date: document.getElementById("dateScreen"),
    slots: document.getElementById("slotsScreen"),
    client: document.getElementById("clientScreen"),
    summary: document.getElementById("summaryScreen"),
    pix: document.getElementById("pixScreen"),
    success: document.getElementById("successScreen"),
    myAppointments: document.getElementById("myAppointmentsScreen"),
    admin: document.getElementById("adminScreen"),
    adminPhotos: document.getElementById("adminPhotosScreen")
};

const business = {
    start: "07:30",
    weekdayEnd: "17:30",
    saturdayEnd: "16:00",
    lunchStart: "11:30",
    lunchEnd: "13:00",
    daysAhead: 10
};

const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function money(value){
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function showToast(message, type = "success"){
    let toast = document.getElementById("appToast");
    if(!toast){
        toast = document.createElement("div");
        toast.id = "appToast";
        toast.className = "app-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `app-toast show ${type}`;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}


function depositValue(service){
    return service.price * 0.30;
}

function showScreen(screenName){
    Object.values(screens).forEach(screen => screen.classList.remove("active"));
    screens[screenName].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderServices(){
    const list = document.getElementById("servicesList");
    list.className = "service-list";
    list.innerHTML = "";

    services.forEach(service => {
        const row = document.createElement("section");
        row.className = "service-row";
        row.innerHTML = `
            <div class="service-info">
                <h2>${service.name}</h2>
                <p>${money(service.price)} • duração: ${service.durationText}</p>
                <div class="deposit">Sinal 30%: <strong>${money(depositValue(service))}</strong></div>
            </div>
            <button class="service-arrow" aria-label="Selecionar ${service.name}">›</button>
        `;
        row.addEventListener("click", () => selectService(service.id));
        list.appendChild(row);
    });
}

function selectService(serviceId){
    selectedService = services.find(service => service.id === serviceId);
    selectedDate = null;
    selectedDateBR = "";
    selectedDateObj = null;
    selectedTime = null;

    document.getElementById("dateServiceName").textContent = selectedService.name;
    document.getElementById("dateServiceDuration").textContent = `Duração: ${selectedService.durationText} • Sinal: ${money(depositValue(selectedService))}`;
    renderDates();
    showScreen("date");
}

function timeToMinutes(time){
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
}

function minutesToTime(minutes){
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    return `${h}:${m}`;
}

function formatDateBR(date){
    return date.toLocaleDateString("pt-BR");
}

function dateKey(date){
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseBRDate(text){
    const match = text.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if(!match) return null;
    const [, dd, mm, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if(date.getDate() !== Number(dd) || date.getMonth() !== Number(mm) - 1 || date.getFullYear() !== Number(yyyy)) return null;
    return date;
}

function isWorkday(date){
    const day = date.getDay();
    return day >= 2 && day <= 6;
}

function generateWorkingDates(){
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for(let i = 0; dates.length < business.daysAhead && i < 40; i++){
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        if(isWorkday(date)) dates.push(date);
    }
    return dates;
}

function overlaps(startA, endA, startB, endB){
    return startA < endB && endA > startB;
}

function isLunchBlocked(start, end){
    // Sábado tem atendimento contínuo, sem intervalo para almoço.
    if(selectedDateObj && selectedDateObj.getDay && selectedDateObj.getDay() === 6){
        return false;
    }

    return overlaps(start, end, timeToMinutes(business.lunchStart), timeToMinutes(business.lunchEnd));
}

function businessEndForDate(date){
    // Sábado fecha mais cedo; terça a sexta fecha 17:30.
    if(date && date.getDay && date.getDay() === 6){
        return business.saturdayEnd;
    }
    return business.weekdayEnd;
}

function generateTimesForService(service){
    const times = [];
    const start = timeToMinutes(business.start);
    const end = timeToMinutes(businessEndForDate(selectedDateObj));
    const step = 30;

    for(let current = start; current + service.durationMinutes <= end; current += step){
        times.push(minutesToTime(current));
    }
    return times;
}

function appointmentEndMinutes(item){
    const service = services.find(s => s.id === item.serviceId || s.name === item.service);
    const duration = Number(item.durationMinutes || service?.durationMinutes || 60);
    return timeToMinutes(item.time) + duration;
}

function slotStatus(time){
    const start = timeToMinutes(time);
    const end = start + selectedService.durationMinutes;

    if(isLunchBlocked(start, end)){
        return { status: "unavailable", label: "INDISPONÍVEL" };
    }

    const activeAppointments = getStoredAppointments().filter(item => {
        const normalized = String(item.status || "").toLowerCase();
        return item.date === selectedDateBR && !normalized.includes("cancel") && !normalized.includes("expir");
    });

    for(const item of activeAppointments){
        const apStart = timeToMinutes(item.time);
        const apEnd = appointmentEndMinutes(item);

        if(overlaps(start, end, apStart, apEnd)){
            const exactStart = start === apStart;
            const normalized = String(item.status || "").toLowerCase();

            if(exactStart && normalized.includes("confirm")){
                return { status: "confirmed", label: "CONFIRMADO" };
            }

            if(exactStart){
                return { status: "temporary", label: "RESERVA TEMP." };
            }

            return { status: "unavailable", label: "INDISPONÍVEL" };
        }
    }

    return { status: "available", label: "DISPONÍVEL" };
}

function renderDates(){
    const dateList = document.getElementById("dateList");
    dateList.innerHTML = "";

    generateWorkingDates().forEach(date => {
        const btn = document.createElement("button");
        btn.className = "date-btn";
        btn.innerHTML = `<strong>${dayNames[date.getDay()]}</strong><span>${formatDateBR(date)}</span>`;
        btn.addEventListener("click", () => pickDate(date));
        dateList.appendChild(btn);
    });
}

function pickDate(date){
    selectedDate = dateKey(date);
    selectedDateBR = formatDateBR(date);
    selectedDateObj = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    selectedTime = null;
    renderTimes();
    showScreen("slots");
}

function renderTimes(){
    const timeList = document.getElementById("timeList");
    timeList.innerHTML = "";
    selectedTime = null;

    document.getElementById("slotsSubtitle").textContent = `${selectedDateBR} • ${selectedService.name} • ${selectedService.durationText}`;

    const times = generateTimesForService(selectedService);

    times.forEach(time => {
        const visual = slotStatus(time);
        const btn = document.createElement("button");
        btn.className = `time-btn ${visual.status}`;
        btn.innerHTML = `${time}<br><small>${visual.label}</small>`;

        if(visual.status === "available"){
            btn.addEventListener("click", () => {
                selectedTime = time;
                document.querySelectorAll(".time-btn").forEach(item => item.classList.remove("selected"));
                btn.classList.add("selected");
                setTimeout(() => {
                    showScreen("client");
                }, 120);
            });
        }else{
            btn.disabled = true;
        }

        timeList.appendChild(btn);
    });

    if(times.length === 0){
        timeList.innerHTML = `<p class="empty-message">Nenhum horário disponível para este serviço nessa data.</p>`;
    }
}


function refreshWorksFromStorage(){
    const extraPhotos = getAdminPhotos ? getAdminPhotos() : [];
    works = [...extraPhotos, ...defaultWorks].slice(0, 12);
}

function renderHomeWorks(){
    refreshWorksFromStorage();

    const grid = document.querySelector(".works-grid");
    if(!grid) return;

    const visibleWorks = works.length > 0 ? works : defaultWorks;
    const loopWorks = visibleWorks.length > 3
        ? [...visibleWorks, ...visibleWorks, ...visibleWorks]
        : [...visibleWorks, ...visibleWorks, ...visibleWorks];

    grid.innerHTML = loopWorks.map((src, index) => {
        const realIndex = index % visibleWorks.length;
        return `<img src="${src}" alt="Trabalho recente ${realIndex + 1}" class="work-photo" data-index="${realIndex}">`;
    }).join("");

    grid.querySelectorAll(".work-photo").forEach((img) => {
        img.addEventListener("click", () => {
            currentPhoto = Number(img.dataset.index);
            updatePhoto();
            photoModal.classList.add("active");
        });
    });

    requestAnimationFrame(() => {
        if(visibleWorks.length > 1){
            grid.scrollLeft = Math.floor(grid.scrollWidth / 3);
        }
    });
}

/* Fotos recentes */
const photoModal = document.getElementById("photoModal");
const modalImage = document.getElementById("modalImage");
const photoCounter = document.getElementById("photoCounter");

function updatePhoto(){
    modalImage.src = works[currentPhoto];
    photoCounter.textContent = `Foto ${currentPhoto + 1} de ${works.length}`;
}


document.getElementById("closePhoto").addEventListener("click", () => photoModal.classList.remove("active"));
document.getElementById("prevPhoto").addEventListener("click", () => { currentPhoto = (currentPhoto - 1 + works.length) % works.length; updatePhoto(); });
document.getElementById("nextPhoto").addEventListener("click", () => { currentPhoto = (currentPhoto + 1) % works.length; updatePhoto(); });
photoModal.addEventListener("click", (event) => { if(event.target === photoModal) photoModal.classList.remove("active"); });

/* Botões */
document.getElementById("btnInstagram").addEventListener("click", () => window.open("https://www.instagram.com/liviarodrigues_studio", "_blank"));
document.getElementById("btnMap").addEventListener("click", () => window.open("https://www.google.com/maps/search/?api=1&query=Galeria%20Santos%20Rua%20Aurora%20Gl%C3%B3ria%20Vila%20Velha%20ES", "_blank"));
document.getElementById("btnSchedule").addEventListener("click", () => showScreen("services"));
document.getElementById("btnMyAppointments").addEventListener("click", () => { renderAppointmentsEmpty(); showScreen("myAppointments"); });
document.getElementById("btnBackHome").addEventListener("click", () => showScreen("home"));
document.getElementById("btnBackServices").addEventListener("click", () => showScreen("services"));
document.getElementById("btnBackDate").addEventListener("click", () => showScreen("date"));

document.getElementById("customDateInput").addEventListener("input", (event) => {
    let value = event.target.value.replace(/\D/g, "").slice(0, 8);
    if(value.length > 4) value = `${value.slice(0,2)}/${value.slice(2,4)}/${value.slice(4)}`;
    else if(value.length > 2) value = `${value.slice(0,2)}/${value.slice(2)}`;
    event.target.value = value;
});

document.getElementById("btnCustomDate").addEventListener("click", () => {
    const date = parseBRDate(document.getElementById("customDateInput").value);
    if(!date){ alert("Digite a data assim: 30/05/2026"); return; }
    const today = new Date(); today.setHours(0,0,0,0);
    if(date < today){ alert("Escolha uma data de hoje para frente."); return; }
    if(!isWorkday(date)){ alert("Atendimento somente de terça a sábado."); return; }
    pickDate(date);
});



function formatCpf(value){
    const d = value.replace(/\D/g, "").slice(0, 11);
    if(d.length > 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
    if(d.length > 6) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    if(d.length > 3) return `${d.slice(0,3)}.${d.slice(3)}`;
    return d;
}

function formatPhone(value){
    const d = value.replace(/\D/g, "").slice(0, 11);
    if(d.length > 10) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
    if(d.length > 6) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
    if(d.length > 2) return `(${d.slice(0,2)}) ${d.slice(2)}`;
    if(d.length > 0) return `(${d}`;
    return d;
}

function onlyDigits(value){
    return String(value || "").replace(/\D/g, "");
}

function fillSummary(){
    document.getElementById("summaryClientName").textContent = clientData.name;
    document.getElementById("summaryServiceName").textContent = selectedService.name;
    document.getElementById("summaryDateTime").textContent = `${selectedDateBR} às ${selectedTime}`;
    document.getElementById("summaryTotal").textContent = money(selectedService.price);
    document.getElementById("summaryDeposit").textContent = money(depositValue(selectedService));
}


function setPixQRCode(pixPayload, encodedImage){
    const qrImg = document.getElementById("pixQrImg");
    const qrBox = document.getElementById("pixQrBox");

    if(encodedImage && qrImg){
        const imgSrc = String(encodedImage).startsWith("data:")
            ? encodedImage
            : `data:image/png;base64,${encodedImage}`;
        qrImg.src = imgSrc;
        qrImg.style.display = "block";
        if(qrBox) qrBox.classList.add("real-qr");
        return;
    }

    if(qrImg){
        qrImg.style.display = "none";
    }
}

function fillPix(){
    document.getElementById("pixServiceName").textContent = selectedService.name;
    document.getElementById("pixDateTime").textContent = `${selectedDateBR} às ${selectedTime}`;
    document.getElementById("pixDeposit").textContent = money(depositValue(selectedService));
    pixPayload = `PIX STUDIO LIVIA RODRIGUES | ${selectedService.name} | ${selectedDateBR} ${selectedTime} | SINAL ${money(depositValue(selectedService))}`;
}



function firebaseUrl(path){
    return `${FIREBASE_DB_URL.replace(/\/$/, "")}/${String(path).replace(/^\/|\/$/g, "")}.json`;
}

function normalizeFirebaseData(data){
    if(!data || typeof data !== "object") return [];
    return Object.entries(data).map(([id, value]) => {
        if(value && typeof value === "object"){
            return { id, ...value };
        }
        return null;
    }).filter(Boolean);
}

function statusToWeb(status){
    const s = String(status || "").toLowerCase();
    if(s === "pago" || s.includes("confirm")) return "Confirmado";
    if(s.includes("cancel")) return "Cancelado";
    if(s.includes("expir")) return "Expirado";
    if(s.includes("reservado_aguardando_pagamento") || s.includes("tempor")) return "Reserva temporária";
    return status || "Reserva temporária";
}

function statusToFirebase(status){
    const s = String(status || "").toLowerCase();
    if(s.includes("confirm")) return "pago";
    if(s.includes("cancel")) return "cancelado";
    if(s.includes("expir")) return "expirado";
    return "reservado_aguardando_pagamento";
}

function normalizeAppointmentFromFirebase(item){
    const service = services.find(s => s.id === item.serviceId || s.name === item.service);
    return {
        id: item.id,
        clientName: item.clientName || item.client_name || "Cliente",
        phone: item.phone || item.client_phone || "",
        cpf: item.cpf || item.client_cpf_cnpj || "",
        service: item.service || service?.name || "",
        serviceId: item.serviceId || service?.id || "",
        price: Number(item.price || 0),
        deposit: Number(item.deposit || 0),
        durationMinutes: Number(item.durationMinutes || item.duration_block || service?.durationMinutes || 60),
        durationText: item.durationText || item.duration_label || service?.durationText || "",
        date: item.date || "",
        time: item.time || "",
        status: statusToWeb(item.status),
        createdAt: item.createdAt || item.created_at || "",
        expiresAt: item.expiresAt || item.expires_at || "",
        pixPayload: item.pixPayload || item.pix_payload || "",
        paymentStatus: item.paymentStatus || item.payment_status || "",
        asaasPaymentId: item.asaasPaymentId || item.asaas_payment_id || "",
        raw: item
    };
}

function appointmentToFirebase(item){
    return {
        id: item.id,
        created_at: item.createdAt || new Date().toLocaleString("pt-BR"),
        expires_at: item.expiresAt || new Date(Date.now() + PENDING_EXPIRE_MINUTES * 60 * 1000).toLocaleString("pt-BR"),
        client_name: item.clientName || "",
        client_phone: onlyDigits(item.phone || ""),
        client_cpf_cnpj: onlyDigits(item.cpf || ""),
        service: item.service || "",
        serviceId: item.serviceId || "",
        price: Number(item.price || 0),
        deposit: String(item.deposit || 0),
        duration_label: item.durationText || "",
        duration_block: Number(item.durationMinutes || 60),
        date: item.date || "",
        time: item.time || "",
        status: statusToFirebase(item.status),
        admin_seen: false,
        payment_provider: "Asaas",
        payment_status: item.paymentStatus || "waiting_payment",
        pix_payload: item.pixPayload || "",
        asaas_payment_id: item.asaasPaymentId || ""
    };
}

function saveLocalBackup(items){
    appointmentsCache = Array.isArray(items) ? items : [];
    localStorage.setItem("livia_appointments", JSON.stringify(appointmentsCache));
}

function loadLocalBackup(){
    try{
        const data = JSON.parse(localStorage.getItem("livia_appointments") || "[]");
        return Array.isArray(data) ? data : [];
    }catch(error){
        return [];
    }
}

async function fetchAppointmentsFromFirebase(){
    const response = await fetch(firebaseUrl("appointments"), { cache: "no-store" });
    if(!response.ok) throw new Error(`Firebase HTTP ${response.status}`);
    const data = await response.json();
    const items = normalizeFirebaseData(data).map(normalizeAppointmentFromFirebase);
    firebaseOnline = true;
    saveLocalBackup(items);
    return items;
}

function loadAppointmentsFromFirebase(){
    fetchAppointmentsFromFirebase()
        .then(items => {
            appointmentsCache = items;
            rerenderCurrentDataScreens();
        })
        .catch(error => {
            firebaseOnline = false;
            console.warn("Firebase indisponível, usando backup local:", error);
        });
}

async function patchAppointmentFirebase(id, fields){
    const response = await fetch(firebaseUrl(`appointments/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
    });
    if(!response.ok) throw new Error(`Firebase PATCH ${response.status}`);
    return response.json();
}

async function putAppointmentFirebase(item){
    const response = await fetch(firebaseUrl(`appointments/${item.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointmentToFirebase(item))
    });
    if(!response.ok) throw new Error(`Firebase PUT ${response.status}`);
    return response.json();
}


function showPaidSuccess(item){
    const successService = document.getElementById("successService");
    const successDateTime = document.getElementById("successDateTime");

    if(successService){
        successService.textContent = item?.service || selectedService?.name || "---";
    }

    if(successDateTime){
        const date = item?.date || selectedDateBR || "";
        const time = item?.time || selectedTime || "";
        successDateTime.textContent = date && time ? `${date} às ${time}` : "---";
    }

    const successTitle = document.querySelector("#successScreen h1, #successScreen h2, #successScreen .success-title");
    if(successTitle){
        successTitle.textContent = "Pagamento confirmado!";
    }

    const successText = document.querySelector("#successScreen p");
    if(successText){
        successText.textContent = "Seu horário foi confirmado com sucesso. A reserva já está garantida.";
    }

    showScreen("success");
}


function rerenderCurrentDataScreens(){
    const active = document.querySelector(".screen.active")?.id || "";
    if(active === "slotsScreen" && selectedService && selectedDateBR){
        renderTimes();
    }
    if(active === "pixScreen" && currentBookingId){
        const item = getStoredAppointments().find(ap => ap.id === currentBookingId);
        const normalizedStatus = String(item?.status || "").toLowerCase();
        const normalizedPayment = String(item?.paymentStatus || "").toLowerCase();

        if(
            normalizedStatus.includes("confirm") ||
            normalizedStatus === "pago" ||
            normalizedPayment === "paid" ||
            normalizedPayment.includes("paid")
        ){
            if(pixCountdownTimer){
                clearInterval(pixCountdownTimer);
                pixCountdownTimer = null;
            }
            currentBookingId = null;
            showToast("Pagamento confirmado! Reserva garantida ✓");
            setTimeout(() => showPaidSuccess(item), 700);
            return;
        }
    }
    if(active === "myAppointmentsScreen"){
        const cpf = onlyDigits(document.getElementById("lookupCpf")?.value || "");
        const phone = onlyDigits(document.getElementById("lookupPhone")?.value || "");
        if(cpf.length >= 11 || phone.length >= 10) renderAppointments();
    }
    if(active === "adminScreen"){
        renderAdmin();
    }
}

function startAppointmentsRealtime(){
    if(appointmentsRealtimeTimer) clearInterval(appointmentsRealtimeTimer);
    loadAppointmentsFromFirebase();
    appointmentsRealtimeTimer = setInterval(loadAppointmentsFromFirebase, 5000);
}


function getStoredAppointments(){
    let data = appointmentsCache.length ? appointmentsCache : loadLocalBackup();

    let changed = false;
    const now = Date.now();

    const cleaned = data.map(item => {
        const normalized = String(item.status || "").toLowerCase();
        if(
            normalized.includes("reserva tempor") &&
            item.expiresAt &&
            new Date(item.expiresAt).getTime() <= now
        ){
            changed = true;
            return { ...item, status: "Expirado", expiredAt: new Date().toISOString() };
        }
        return item;
    });

    if(changed){
        saveStoredAppointments(cleaned);
    }

    return cleaned;
}

function saveStoredAppointments(items){
    saveLocalBackup(items);
}


async function createAsaasPaymentForBooking(booking){
    const payload = {
        appointment_id: booking.id,
        customer_name: booking.clientName,
        customer_phone: onlyDigits(booking.phone),
        customer_cpf_cnpj: onlyDigits(booking.cpf),
        value: Number(booking.deposit || 0),
        description: `Sinal de agendamento - ${booking.service || "Studio Lívia Rodrigues"}`
    };

    const response = await fetch(`${BACKEND_URL.replace(/\/$/, "")}/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    let data = {};
    try{
        data = await response.json();
    }catch(error){
        throw new Error("Resposta inválida do servidor Render.");
    }

    if(!response.ok || !data.ok){
        const msg = data.error || data.message || data.step || JSON.stringify(data).slice(0, 300);
        throw new Error(msg || "Erro ao criar Pix no Asaas.");
    }

    return data;
}

function createTemporaryAppointment(){
    currentBookingId = `web-${Date.now()}`;
    const booking = {
        id: currentBookingId,
        clientName: clientData.name,
        phone: clientData.phone,
        cpf: clientData.cpf,
        service: selectedService.name,
        serviceId: selectedService.id,
        price: selectedService.price,
        deposit: depositValue(selectedService),
        durationMinutes: selectedService.durationMinutes,
        durationText: selectedService.durationText,
        date: selectedDateBR,
        time: selectedTime,
        status: "Reserva temporária",
        paymentStatus: "waiting_payment",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + PENDING_EXPIRE_MINUTES * 60 * 1000).toISOString()
    };

    const items = getStoredAppointments().filter(item => item.id !== booking.id);
    items.unshift(booking);
    saveStoredAppointments(items);

    putAppointmentFirebase(booking)
        .then(() => loadAppointmentsFromFirebase())
        .catch(error => {
            firebaseOnline = false;
            console.warn("Erro salvando no Firebase:", error);
            alert("Reserva salva neste aparelho, mas ainda não sincronizou com a nuvem. Verifique a internet.");
        });

    return booking;
}

function statusClass(status){
    const normalized = String(status || "").toLowerCase();
    if(normalized.includes("confirm")) return "confirmed";
    if(normalized.includes("cancel")) return "cancelled";
    if(normalized.includes("expir")) return "expired";
    return "temporary";
}

function appointmentCard(item){
    return `
        <section class="appointment-card ${statusClass(item.status)}">
            <div class="appointment-top">
                <div>
                    <span>Serviço</span>
                    <strong>${item.service}</strong>
                </div>
                <em>${item.status}</em>
            </div>

            <div class="appointment-details">
                <div><span>Data</span><strong>${item.date}</strong></div>
                <div><span>Horário</span><strong>${item.time}</strong></div>
                <div><span>Total</span><strong>${money(Number(item.price || 0))}</strong></div>
                <div><span>Sinal</span><strong>${money(Number(item.deposit || 0))}</strong></div>
            </div>

            <div class="appointment-client">
                <span>Cliente</span>
                <strong>${item.clientName || "Cliente"}</strong>
            </div>

            ${!["Cancelado","Expirado"].includes(item.status) ? `<button class="cancel-appointment-btn" data-id="${item.id}">CANCELAR AGENDAMENTO</button>` : ""}
        </section>
    `;
}

function renderAppointmentsEmpty(){
    document.getElementById("appointmentsResult").innerHTML = "";
    document.getElementById("lookupCpf").value = "";
    document.getElementById("lookupPhone").value = "";
}

function renderAppointments(){
    const cpf = onlyDigits(document.getElementById("lookupCpf").value);
    const phone = onlyDigits(document.getElementById("lookupPhone").value);
    const result = document.getElementById("appointmentsResult");

    if(cpf.length < 11 && phone.length < 10){
        alert("Digite seu CPF ou telefone com DDD para consultar.");
        return;
    }

    const matches = getStoredAppointments().filter(item => {
        const sameCpf = cpf.length === 11 && onlyDigits(item.cpf) === cpf;
        const samePhone = phone.length >= 10 && onlyDigits(item.phone) === phone;
        return sameCpf || samePhone;
    });

    if(matches.length === 0){
        result.innerHTML = `
            <section class="empty-appointments">
                <strong>Nenhum agendamento encontrado</strong>
                <p>Confira se o CPF ou telefone foi digitado igual ao usado na reserva.</p>
            </section>
        `;
        return;
    }

    result.innerHTML = matches.map(appointmentCard).join("");
    result.querySelectorAll(".cancel-appointment-btn").forEach(button => {
        button.addEventListener("click", () => cancelAppointment(button.dataset.id));
    });
}

let pendingCancelId = null;

function openCancelModal(id){
    pendingCancelId = id;
    document.getElementById("cancelModal").classList.add("active");
}

function closeCancelModal(){
    pendingCancelId = null;
    document.getElementById("cancelModal").classList.remove("active");
}

function cancelAppointment(id){
    openCancelModal(id);
}

function confirmCancelAppointment(){
    if(!pendingCancelId) return;

    const id = pendingCancelId;
    const items = getStoredAppointments().map(item => {
        if(item.id === id){
            return { ...item, status: "Cancelado", cancelledAt: new Date().toISOString(), paymentStatus: "cancelled_by_client" };
        }
        return item;
    });

    saveStoredAppointments(items);
    patchAppointmentFirebase(id, {
        status: "cancelado",
        cancelled_at: new Date().toLocaleString("pt-BR"),
        payment_status: "cancelled_by_client",
        admin_seen: false
    }).catch(error => console.warn("Erro cancelando no Firebase:", error));

    const wasPixReservation = currentBookingId === id;

    if(wasPixReservation && pixCountdownTimer){
        clearInterval(pixCountdownTimer);
        pixCountdownTimer = null;
    }

    closeCancelModal();

    const active = document.querySelector(".screen.active")?.id || "";
    if(active === "myAppointmentsScreen"){
        renderAppointments();
    }

    loadAppointmentsFromFirebase();

    if(wasPixReservation){
        currentBookingId = null;
        showScreen("home");
        showToast("Reserva cancelada. Horário disponível novamente.");
    }
}


function formatCountdown(ms){
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
}

function startPixCountdown(){
    if(pixCountdownTimer){
        clearInterval(pixCountdownTimer);
        pixCountdownTimer = null;
    }

    const label = document.getElementById("pixCountdown");
    if(!label || !currentBookingId) return;

    const update = () => {
        const item = getStoredAppointments().find(ap => ap.id === currentBookingId);
        if(!item || !item.expiresAt){
            label.textContent = "10:00";
            return;
        }

        const normalizedStatus = String(item.status || "").toLowerCase();
        const normalizedPayment = String(item.paymentStatus || "").toLowerCase();

        if(
            normalizedStatus.includes("confirm") ||
            normalizedStatus === "pago" ||
            normalizedPayment === "paid" ||
            normalizedPayment.includes("paid")
        ){
            clearInterval(pixCountdownTimer);
            pixCountdownTimer = null;
            label.textContent = "PAGO";
            currentBookingId = null;
            showToast("Pagamento confirmado! Reserva garantida ✓");
            setTimeout(() => showPaidSuccess(item), 700);
            return;
        }

        const remaining = new Date(item.expiresAt).getTime() - Date.now();
        label.textContent = formatCountdown(remaining);

        if(remaining <= 0){
            clearInterval(pixCountdownTimer);
            pixCountdownTimer = null;
            label.textContent = "EXPIRADO";
            getStoredAppointments();
        }
    };

    update();
    pixCountdownTimer = setInterval(update, 1000);
}

const clientNameInput = document.getElementById("clientName");
const clientPhoneInput = document.getElementById("clientPhone");
const clientCpfInput = document.getElementById("clientCpf");

clientPhoneInput.addEventListener("input", (event) => {
    event.target.value = formatPhone(event.target.value);
});

clientCpfInput.addEventListener("input", (event) => {
    event.target.value = formatCpf(event.target.value);
});


const lookupCpfInput = document.getElementById("lookupCpf");
const lookupPhoneInput = document.getElementById("lookupPhone");

lookupCpfInput.addEventListener("input", (event) => {
    event.target.value = formatCpf(event.target.value);
});

lookupPhoneInput.addEventListener("input", (event) => {
    event.target.value = formatPhone(event.target.value);
});

document.getElementById("btnLookupAppointments").addEventListener("click", renderAppointments);
document.getElementById("btnBackHomeFromAppointments").addEventListener("click", () => showScreen("home"));

document.getElementById("btnClientContinue").addEventListener("click", () => {
    const name = clientNameInput.value.trim();
    const phone = onlyDigits(clientPhoneInput.value);
    const cpf = onlyDigits(clientCpfInput.value);

    if(name.length < 3){ alert("Digite o nome da cliente."); return; }
    if(phone.length < 10){ alert("Digite um número válido com DDD."); return; }
    if(cpf.length !== 11){ alert("Digite um CPF válido para gerar o Pix."); return; }

    clientData = { name, phone, cpf };
    fillSummary();
    showScreen("summary");
});

document.getElementById("btnGeneratePix").addEventListener("click", () => {
    const modal = document.getElementById("loadingModal");
    modal.classList.add("active");
    setTimeout(() => {
        modal.classList.remove("active");
        fillPix();
        createTemporaryAppointment();
        showScreen("pix");
        startPixCountdown();
    }, 1300);
});

document.getElementById("btnCopyPix").addEventListener("click", async () => {
    try{
        await navigator.clipboard.writeText(pixPayload);
        showToast("Pix copiado com sucesso ✓");
    }catch(error){
        showToast("Não consegui copiar automaticamente.", "error");
    }
});

document.getElementById("btnFinish").addEventListener("click", () => {
    if(!currentBookingId){
        showScreen("home");
        return;
    }
    openCancelModal(currentBookingId);
});

document.getElementById("btnSuccessHome").addEventListener("click", () => showScreen("home"));
document.getElementById("btnSuccessMyAppointments").addEventListener("click", () => {
    renderAppointmentsEmpty();
    showScreen("myAppointments");
});
document.getElementById("btnBackSlots").addEventListener("click", () => showScreen("slots"));
document.getElementById("btnBackClient").addEventListener("click", () => showScreen("client"));



/* Painel da Lívia */
let adminFilter = "all";
let logoTapCount = 0;
let logoTapTimer = null;

function isStatus(item, key){
    const s = String(item.status || "").toLowerCase();
    if(key === "temporary") return s.includes("reserva tempor");
    if(key === "confirmed") return s.includes("confirm");
    if(key === "cancelled") return s.includes("cancel");
    if(key === "expired") return s.includes("expir");
    return false;
}

function parseBRDateToDate(dateText){
    const parsed = parseBRDate(dateText);
    if(parsed) return parsed;
    return new Date();
}

function isSameBRDate(dateText, date){
    return dateText === formatDateBR(date);
}

function isWithinNextDays(dateText, days){
    const d = parseBRDateToDate(dateText);
    d.setHours(0,0,0,0);
    const today = new Date();
    today.setHours(0,0,0,0);
    const max = new Date(today);
    max.setDate(today.getDate() + days);
    return d >= today && d <= max;
}

function currentMonthMatch(dateText){
    const d = parseBRDateToDate(dateText);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

function sortAppointments(items){
    return [...items].sort((a,b) => {
        const da = parseBRDateToDate(a.date);
        const db = parseBRDateToDate(b.date);
        const ta = timeToMinutes(a.time || "00:00");
        const tb = timeToMinutes(b.time || "00:00");
        return (da - db) || (ta - tb);
    });
}

function adminBookingCard(item){
    const status = String(item.status || "Reserva temporária");
    const phoneDigits = onlyDigits(item.phone);
    const waLink = phoneDigits ? `https://wa.me/55${phoneDigits}` : "#";
    const canCancel = !isStatus(item, "cancelled") && !isStatus(item, "expired");

    return `
        <section class="admin-booking-card ${statusClass(status)}">
            <div class="admin-booking-head">
                <strong>${item.date || "--"} às ${item.time || "--"}</strong>
                <em>${status}</em>
            </div>

            <p>Cliente: <b>${item.clientName || "Cliente"}</b></p>
            <p>WhatsApp: <b>${item.phone || "Não informado"}</b></p>
            <p>Serviço: <b>${item.service || "--"}</b></p>

            <div class="admin-booking-values">
                <span>Total: <b>${money(Number(item.price || 0))}</b></span>
                <span>Sinal: <b>${money(Number(item.deposit || 0))}</b></span>
            </div>

            <p class="admin-duration">Duração: ${item.durationText || item.duration || durationTextFromItem(item)}</p>

            <div class="admin-actions-row">
                ${phoneDigits ? `<button class="admin-whatsapp-btn" data-whatsapp="${waLink}">ABRIR WHATSAPP</button>` : ""}
                ${canCancel ? `<button class="admin-cancel-btn" data-id="${item.id}">CANCELAR</button>` : ""}
                ${isStatus(item, "expired") || isStatus(item, "cancelled") ? `<button class="admin-reactivate-btn" data-id="${item.id}">REATIVAR</button>` : ""}
            </div>
        </section>
    `;
}

function durationTextFromItem(item){
    const service = services.find(s => s.id === item.serviceId || s.name === item.service);
    return service?.durationText || `${item.durationMinutes || 60}min`;
}

function updateAppointmentStatus(id, status){
    const nowIso = new Date().toISOString();
    const items = getStoredAppointments().map(item => {
        if(item.id === id){
            const updated = { ...item, status };
            if(status === "Confirmado"){
                updated.confirmedAt = nowIso;
                updated.paymentStatus = "paid_manual_admin";
            }
            if(status === "Cancelado"){
                updated.cancelledAt = nowIso;
                updated.paymentStatus = "cancelled_by_admin";
            }
            if(status === "Reserva temporária"){
                updated.expiresAt = new Date(Date.now() + PENDING_EXPIRE_MINUTES * 60 * 1000).toISOString();
                updated.paymentStatus = "waiting_payment";
                delete updated.expiredAt;
                delete updated.cancelledAt;
            }
            return updated;
        }
        return item;
    });

    saveStoredAppointments(items);
    renderAdmin();

    const patch = { status: statusToFirebase(status), admin_seen: false };
    if(status === "Confirmado"){
        patch.payment_status = "paid_manual_admin";
        patch.confirmed_at = new Date().toLocaleString("pt-BR");
    }
    if(status === "Cancelado"){
        patch.payment_status = "cancelled_by_admin";
        patch.cancelled_at = new Date().toLocaleString("pt-BR");
    }
    if(status === "Reserva temporária"){
        patch.payment_status = "waiting_payment";
        patch.expires_at = new Date(Date.now() + PENDING_EXPIRE_MINUTES * 60 * 1000).toLocaleString("pt-BR");
    }

    patchAppointmentFirebase(id, patch)
        .then(() => loadAppointmentsFromFirebase())
        .catch(error => console.warn("Erro atualizando status no Firebase:", error));
}

function renderAdmin(){
    const items = getStoredAppointments();
    const today = new Date();

    const active = items.filter(item => isStatus(item, "confirmed") || isStatus(item, "temporary"));
    const temp = items.filter(item => isStatus(item, "temporary"));
    const confirmed = items.filter(item => isStatus(item, "confirmed"));
    const cancelled = items.filter(item => isStatus(item, "cancelled"));
    const expired = items.filter(item => isStatus(item, "expired"));

    document.getElementById("adminActiveCount").textContent = active.length;
    document.getElementById("adminTempCount").textContent = temp.length;
    document.getElementById("adminCanceledCount").textContent = cancelled.length;
    document.getElementById("adminConfirmedCount").textContent = confirmed.length;
    document.getElementById("adminSummaryTempCount").textContent = temp.length;
    document.getElementById("adminExpiredCount").textContent = expired.length;
    document.getElementById("adminSummaryCanceledCount").textContent = cancelled.length;

    const confirmedToday = confirmed.filter(item => isSameBRDate(item.date, today));
    const confirmedWeek = confirmed.filter(item => isWithinNextDays(item.date, 7));
    const confirmedMonth = confirmed.filter(item => currentMonthMatch(item.date));

    const sumDeposits = arr => arr.reduce((acc,item) => acc + Number(item.deposit || 0), 0);
    document.getElementById("adminMoneyToday").textContent = money(sumDeposits(confirmedToday));
    document.getElementById("adminMoneyWeek").textContent = money(sumDeposits(confirmedWeek));
    document.getElementById("adminMoneyMonth").textContent = money(sumDeposits(confirmedMonth));

    document.getElementById("adminFinanceLine").textContent =
        `Confirmados: ${confirmed.length} | Temporárias: ${temp.length} | Expirados: ${expired.length}`;

    document.getElementById("adminSignalsLine").textContent =
        `Sinais confirmados: ${money(sumDeposits(confirmed))} | Sinais temporários: ${money(sumDeposits(temp))}`;

    const todayItems = sortAppointments(active.filter(item => isSameBRDate(item.date, today)));
    document.getElementById("adminTodayLine").textContent =
        `${formatDateBR(today)} • ${todayItems.length} atendimento(s) • ${money(sumDeposits(todayItems.filter(i => isStatus(i, "confirmed"))))} confirmados`;

    const todayList = document.getElementById("adminTodayList");
    if(todayItems.length === 0){
        todayList.innerHTML = `<p class="admin-empty">Nenhum atendimento marcado para hoje.</p>`;
    }else{
        todayList.innerHTML = todayItems.map(item => `
            <div class="admin-today-item">
                <strong>${item.time}</strong>
                <span>${item.clientName || "Cliente"} • ${item.service}</span>
                <em>${item.status}</em>
            </div>
        `).join("");
    }

    let filtered = items;
    if(adminFilter !== "all"){
        filtered = items.filter(item => isStatus(item, adminFilter));
    }

    const list = document.getElementById("adminBookingsList");
    if(filtered.length === 0){
        list.innerHTML = `<p class="admin-empty">Nenhum agendamento encontrado.</p>`;
    }else{
        list.innerHTML = sortAppointments(filtered).map(adminBookingCard).join("");
    }

    list.querySelectorAll(".admin-whatsapp-btn").forEach(btn => {
        btn.addEventListener("click", () => window.open(btn.dataset.whatsapp, "_blank"));
    });
    list.querySelectorAll(".admin-cancel-btn").forEach(btn => {
        btn.addEventListener("click", () => updateAppointmentStatus(btn.dataset.id, "Cancelado"));
    });
    list.querySelectorAll(".admin-reactivate-btn").forEach(btn => {
        btn.addEventListener("click", () => updateAppointmentStatus(btn.dataset.id, "Reserva temporária"));
    });
}

function openAdminPanel(){
    renderAdmin();
    showScreen("admin");
}

function openAdminLoginModal(){
    const modal = document.getElementById("adminLoginModal");
    const input = document.getElementById("adminPasswordInput");
    modal.classList.add("active");
    input.value = "";
    setTimeout(() => input.focus(), 120);
}

function closeAdminLoginModal(){
    document.getElementById("adminLoginModal").classList.remove("active");
}

function confirmAdminLogin(){
    const input = document.getElementById("adminPasswordInput");
    if(input.value === "livia123"){
        closeAdminLoginModal();
        openAdminPanel();
    }else{
        input.value = "";
        input.placeholder = "Senha incorreta";
        input.classList.add("wrong");
        setTimeout(() => input.classList.remove("wrong"), 900);
    }
}

function setupHiddenAdminAccess(){
    const logo = document.querySelector(".logo");
    if(!logo) return;

    logo.addEventListener("click", () => {
        logoTapCount++;
        clearTimeout(logoTapTimer);
        logoTapTimer = setTimeout(() => logoTapCount = 0, 1200);

        if(logoTapCount >= 5){
            logoTapCount = 0;
            openAdminLoginModal();
        }
    });
}

/* Fotos admin em localStorage */
function getAdminPhotos(){
    try{
        const data = JSON.parse(localStorage.getItem("livia_extra_photos") || "[]");
        return Array.isArray(data) ? data : [];
    }catch(error){
        return [];
    }
}

function saveAdminPhotos(items){
    localStorage.setItem("livia_extra_photos", JSON.stringify(items));
}

function renderAdminPhotos(){
    const list = document.getElementById("adminPhotosList");
    const photos = getAdminPhotos();

    if(photos.length === 0){
        list.innerHTML = `
            <section class="admin-photo-empty">
                Nenhuma foto extra cadastrada.<br>
                As 3 fotos padrão continuam aparecendo na tela inicial.
            </section>
        `;
        return;
    }

    list.innerHTML = photos.map((src, index) => `
        <section class="admin-photo-card">
            <img src="${src}" alt="Foto cadastrada ${index + 1}">
            <button data-index="${index}" class="admin-delete-photo">EXCLUIR</button>
        </section>
    `).join("");

    list.querySelectorAll(".admin-delete-photo").forEach(btn => {
        btn.addEventListener("click", () => {
            const index = Number(btn.dataset.index);
            const updated = getAdminPhotos().filter((_, i) => i !== index);
            saveAdminPhotos(updated);
            renderAdminPhotos();
            renderHomeWorks();
        });
    });
}

function addAdminPhoto(file){
    if(!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const photos = getAdminPhotos();
        photos.unshift(reader.result);
        saveAdminPhotos(photos.slice(0, 12));
        renderAdminPhotos();
        renderHomeWorks();
    };
    reader.readAsDataURL(file);
}



function setupInfiniteWorksCarousel(){
    const grid = document.querySelector(".works-grid");
    if(!grid) return;

    let ticking = false;

    grid.addEventListener("scroll", () => {
        if(ticking) return;
        ticking = true;

        requestAnimationFrame(() => {
            const total = grid.scrollWidth;
            const third = total / 3;

            if(third > 0){
                if(grid.scrollLeft < third * 0.45){
                    grid.scrollLeft += third;
                }else if(grid.scrollLeft > third * 1.55){
                    grid.scrollLeft -= third;
                }
            }

            ticking = false;
        });
    });
}

renderServices();
renderHomeWorks();
startAppointmentsRealtime();
setupInfiniteWorksCarousel();
setupHiddenAdminAccess();
bindRealPixButton();

document.getElementById("btnAdminBackHome").addEventListener("click", () => showScreen("home"));
document.getElementById("btnAdminPhotos").addEventListener("click", () => { renderAdminPhotos(); showScreen("adminPhotos"); });
document.getElementById("btnBackAdminFromPhotos").addEventListener("click", () => { renderAdmin(); showScreen("admin"); });
document.getElementById("btnAddAdminPhoto").addEventListener("click", () => document.getElementById("adminPhotoInput").click());
document.getElementById("adminPhotoInput").addEventListener("change", event => {
    addAdminPhoto(event.target.files?.[0]);
    event.target.value = "";
});

document.getElementById("btnAdminLoginCancel").addEventListener("click", closeAdminLoginModal);
document.getElementById("btnAdminLoginConfirm").addEventListener("click", confirmAdminLogin);
document.getElementById("adminPasswordInput").addEventListener("keydown", event => {
    if(event.key === "Enter") confirmAdminLogin();
});
document.getElementById("adminLoginModal").addEventListener("click", event => {
    if(event.target.id === "adminLoginModal") closeAdminLoginModal();
});

document.querySelectorAll(".admin-filter").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll(".admin-filter").forEach(btn => btn.classList.remove("active"));
        button.classList.add("active");
        adminFilter = button.dataset.adminFilter;
        renderAdmin();
    });
});



async function generatePixAndReserveReal(){
    try{
        showLoading("Gerando Pix seguro...", "Aguarde alguns segundos. Não feche o aplicativo.");

        const booking = createTemporaryAppointment();
        if(!booking || !booking.id){
            hideLoading();
            alert("Não consegui criar a reserva temporária.");
            return;
        }

        const payData = await createAsaasPaymentForBooking(booking);

        const realPixPayload = payData.pix_payload || payData.pixPayload || "";
        const encodedImage = payData.encoded_image || payData.encodedImage || payData.qr_code || payData.qrCode || "";
        const invoiceUrl = payData.invoice_url || payData.invoiceUrl || "";
        const paymentId = payData.payment_id || payData.paymentId || "";

        if(!realPixPayload){
            await patchAppointmentFirebase(booking.id, {
                status: "expirado",
                payment_status: "asaas_no_pix_payload",
                payment_error: "Asaas criou cobrança, mas não retornou Pix copia e cola.",
                expired_at: new Date().toLocaleString("pt-BR")
            });
            hideLoading();
            alert("O Pix foi criado, mas o servidor não retornou o Pix copia e cola. Tente novamente.");
            return;
        }

        const updated = {
            ...booking,
            pixPayload: realPixPayload,
            asaasPaymentId: paymentId,
            invoiceUrl,
            paymentStatus: "waiting_payment"
        };

        const items = getStoredAppointments().map(item => item.id === booking.id ? updated : item);
        saveStoredAppointments(items);

        await patchAppointmentFirebase(booking.id, {
            pix_payload: realPixPayload,
            asaas_payment_id: paymentId,
            asaas_invoice_url: invoiceUrl,
            payment_status: "waiting_payment",
            payment_mode: payData.mode || "asaas"
        });

        currentBookingId = booking.id;
        clientData.pixPayload = realPixPayload;
        clientData.encodedImage = encodedImage;
        clientData.invoiceUrl = invoiceUrl;

        fillPix();
        pixPayload = realPixPayload;
        setPixQRCode(realPixPayload, encodedImage);
        hideLoading();
        showScreen("pix");
        startPixCountdown();
        loadAppointmentsFromFirebase();

    }catch(error){
        hideLoading();
        console.error("Erro Pix real:", error);
        alert(`Não consegui gerar o Pix pelo Asaas.\n\nDetalhe: ${error.message || error}`);
    }
}

function showLoading(title, message){
    const modal = document.getElementById("loadingModal");
    if(!modal) return;
    const titleEl = modal.querySelector("strong") || modal.querySelector("h2") || modal.querySelector(".loading-title");
    const msgEl = modal.querySelector("p") || modal.querySelector(".loading-message");
    if(titleEl) titleEl.textContent = title || "Processando...";
    if(msgEl) msgEl.textContent = message || "Aguarde alguns segundos.";
    modal.classList.add("active");
}

function hideLoading(){
    const modal = document.getElementById("loadingModal");
    if(modal) modal.classList.remove("active");
}

function bindRealPixButton(){
    const candidates = [
        "btnGeneratePix",
        "btnReserve",
        "btnConfirmReserve",
        "btnCreatePix",
        "btnSummaryPix"
    ];

    for(const id of candidates){
        const btn = document.getElementById(id);
        if(btn && !btn.dataset.realPixBound){
            btn.dataset.realPixBound = "1";
            btn.addEventListener("click", event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                generatePixAndReserveReal();
            }, true);
        }
    }

    document.querySelectorAll("button").forEach(btn => {
        const txt = (btn.textContent || "").trim().toUpperCase();
        if(txt.includes("GERAR PIX") && !btn.dataset.realPixBound){
            btn.dataset.realPixBound = "1";
            btn.addEventListener("click", event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                generatePixAndReserveReal();
            }, true);
        }
    });
}


console.log("Studio Lívia Rodrigues iniciado com Firebase real de agendamentos.");


document.getElementById("btnCancelNo").addEventListener("click", closeCancelModal);
document.getElementById("btnCancelYes").addEventListener("click", confirmCancelAppointment);
document.getElementById("cancelModal").addEventListener("click", (event) => {
    if(event.target.id === "cancelModal") closeCancelModal();
});
