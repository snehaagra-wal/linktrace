// LinkTrace — Law Enforcement Police Intelligence Controller

const $ = (id) => document.getElementById(id);

const state = {
  currentView: "landing", // 'landing' | 'login' | 'app'
  activeDashboardPage: "dashboard",
  officer: {
    name: "INSP. V. SHARMA",
    badge: "DL-SP-4412",
    unit: "Special Cell New Delhi",
  },
  overview: {},
  intel: {},
  suspects: [],
  firs: [],
  vehicles: [],
  calls: [],
  transactions: [],
  geoMarkers: [],
  graphData: { nodes: [], edges: [] },
  activeSuspectFilter: "all",
  activeFirFilter: "all",
  d3: {
    svg: null,
    g: null,
    simulation: null,
  },
  map: null,
  lastDataMtime: null,
};

// API Helper
async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error [${res.status}]: ${errorText}`);
  }
  return res.json();
}

function money(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

function riskClass(val) {
  const v = String(val || "").toLowerCase();
  if (v.includes("wanted") || v.includes("high") || v.includes("critical")) return "high";
  if (v.includes("open") || v.includes("medium") || v.includes("chargesheet")) return "medium";
  if (v.includes("custody") || v.includes("low") || v.includes("watch")) return "low";
  return "";
}

// =========================================================================
// 1. MASTER VIEW CONTROLLER (Landing, Login, Dashboard App)
// =========================================================================
function showView(viewId) {
  state.currentView = viewId;

  document.querySelectorAll(".main-view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${viewId}`);
  });

  if (viewId === "app") {
    $("active-officer-label").textContent = state.officer.name;
    renderDashboard();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =========================================================================
// 2. DASHBOARD PAGE ROUTER (Inside the App)
// =========================================================================
function switchDashboardPage(pageId) {
  state.activeDashboardPage = pageId;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === pageId);
  });

  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.toggle("active", view.id === `page-${pageId}`);
  });

  if (pageId === "dashboard") {
    renderDashboard();
  } else if (pageId === "suspects") {
    renderSuspectsPage();
  } else if (pageId === "firs") {
    renderFirsPage();
  } else if (pageId === "vehicles") {
    renderVehiclesPage();
  } else if (pageId === "transactions") {
    renderTransactionsPage();
  } else if (pageId === "entry") {
    initDataEntryPage();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =========================================================================
// 3. SLIDE-OVER DOSSIER DRAWER
// =========================================================================
function openDrawer(title, htmlContent) {
  $("drawer-entity-title").textContent = title;
  $("drawer-content").innerHTML = htmlContent;
  $("dossier-drawer").classList.add("open");
  $("drawer-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  $("dossier-drawer").classList.remove("open");
  $("drawer-backdrop").classList.remove("open");
  document.body.style.overflow = "";
}

// =========================================================================
// 4. DATA LOADING
// =========================================================================
async function loadAllData() {
  const [ov, intel, suspects, firs, vehicles, calls, txns, geo] = await Promise.all([
    api("/api/overview"),
    api("/api/intel"),
    api("/api/suspects"),
    api("/api/firs"),
    api("/api/vehicles"),
    api("/api/calls"),
    api("/api/transactions"),
    api("/api/geo"),
  ]);

  state.overview = ov;
  state.intel = intel;
  state.suspects = suspects;
  state.firs = firs;
  state.vehicles = vehicles;
  state.calls = calls;
  state.transactions = txns;
  state.geoMarkers = geo;
}

// =========================================================================
// 5. PAGE 1: DASHBOARD RENDERER & KPI CONTROLLER
// =========================================================================
function updateKpis() {
  const o = state.overview || {};
  if ($("kpi-suspects")) $("kpi-suspects").textContent = o.suspects !== undefined ? o.suspects : state.suspects.length;
  if ($("kpi-wanted")) $("kpi-wanted").textContent = o.wanted !== undefined ? o.wanted : 3;
  if ($("kpi-firs")) $("kpi-firs").textContent = o.firs !== undefined ? o.firs : state.firs.length;
  if ($("kpi-loss")) $("kpi-loss").textContent = money(o.total_loss_inr || 34450000);
  if ($("kpi-transferred")) $("kpi-transferred").textContent = money(o.total_transferred_inr || 10682000);
  if ($("fin-total-amount")) $("fin-total-amount").textContent = money(o.total_transferred_inr || 10682000);
  if ($("fin-tx-count")) $("fin-tx-count").textContent = `${state.transactions.length} Transfers`;
  if ($("vehicles-count")) $("vehicles-count").textContent = `${state.vehicles.length} vehicles`;
  if ($("calls-count")) $("calls-count").textContent = `${state.calls.length} call logs`;

  // Synchronize Data Entry page registry counters
  if ($("stat-suspects-count")) $("stat-suspects-count").textContent = state.suspects.length;
  if ($("stat-firs-count")) $("stat-firs-count").textContent = state.firs.length;
  if ($("stat-vehicles-count")) $("stat-vehicles-count").textContent = state.vehicles.length;
  if ($("stat-tx-count")) $("stat-tx-count").textContent = state.transactions.length;
}

async function renderDashboard() {
  updateKpis();
  await loadDashboardGraph();
  await initDashboardMap();
}

// =========================================================================
// 5B. INTERACTIVE AI DETECTIVE COPILOT & Q&A ASSISTANT
// =========================================================================
// Helper to detect language (Hindi, Hinglish, English, regional)
function detectLanguage(query) {
  const select = $("copilot-lang-select");
  const chosen = select ? select.value : "auto";
  if (chosen && chosen !== "auto") {
    return chosen;
  }

  // Devanagari script detection (Hindi / Marathi)
  if (/[\u0900-\u097F]/.test(query)) {
    if (/(kuthe|kon|kay|kasa|kashi|saanga|mahiti)/i.test(query)) {
      return "mr";
    }
    return "hi";
  }
  // Bengali script
  if (/[\u0980-\u09FF]/.test(query)) return "bn";
  // Tamil script
  if (/[\u0B80-\u0BFF]/.test(query)) return "ta";
  // Telugu script
  if (/[\u0C00-\u0C7F]/.test(query)) return "te";
  // Gujarati script
  if (/[\u0A80-\u0AFF]/.test(query)) return "gu";

  // Hinglish heuristics: Latin characters with distinct Hindi/Urdu keywords
  const qLower = query.toLowerCase();
  const hinglishWords = [
    "kaun", "kon", "kya", "kaha", "kahan", "kidhar", "kisko", "kisne", "kiski",
    "batao", "bataye", "btao", "bataiye", "hai", "hain", "tha", "thi",
    "gaadi", "gadi", "paise", "rupaye", "khata", "khate", "sirgana", "sargana",
    "loot", "chor", "chori", "giraftaar", "pakda", "dakaiti",
    "kaise", "kab", "kitna", "kitne", "wala", "wali", "wale",
    "bhai", "sunn", "bata", "bheja", "kiska", "kispe", "kyu", "kyun", "kabootar"
  ];
  const isHinglish = hinglishWords.some((w) => {
    const reg = new RegExp(`\\b${w}\\b`, "i");
    return reg.test(qLower);
  });

  if (isHinglish) return "hinglish";
  return "en";
}

// Voice Recognition (Speech-to-Text)
let speechRecognition = null;
let isVoiceRecording = false;

function setupVoiceRecognition() {
  const micBtn = $("btn-copilot-mic");
  const banner = $("voice-status-indicator");
  const bannerText = $("voice-status-text");
  const input = $("copilot-query-input");
  const langSelect = $("copilot-lang-select");

  if (!micBtn) return;

  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    micBtn.title = "Voice recognition not supported in this browser. Please use Google Chrome or type query.";
    micBtn.addEventListener("click", () => {
      alert("🎙️ Voice Typing is supported in Google Chrome, Edge, and Safari. You can also type your query in any language (हिन्दी / English / Hinglish) in the input box!");
    });
    return;
  }

  try {
    speechRecognition = new SpeechRecognitionClass();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;

    micBtn.addEventListener("click", () => {
      if (isVoiceRecording) {
        speechRecognition.stop();
        return;
      }

      const sel = langSelect ? langSelect.value : "auto";
      if (sel === "hi" || sel === "hinglish") {
        speechRecognition.lang = "hi-IN";
      } else if (sel === "bn") {
        speechRecognition.lang = "bn-IN";
      } else if (sel === "mr") {
        speechRecognition.lang = "mr-IN";
      } else if (sel === "ta") {
        speechRecognition.lang = "ta-IN";
      } else if (sel === "te") {
        speechRecognition.lang = "te-IN";
      } else if (sel === "gu") {
        speechRecognition.lang = "gu-IN";
      } else {
        speechRecognition.lang = "hi-IN"; // Default to Hindi-English hybrid recognizer
      }

      try {
        speechRecognition.start();
      } catch (err) {
        console.warn("Speech recognition already active:", err);
      }
    });

    speechRecognition.onstart = () => {
      isVoiceRecording = true;
      micBtn.classList.add("listening");
      micBtn.innerHTML = `<span class="mic-icon">🛑</span> <span class="mic-label">Listening...</span>`;
      if (banner) {
        banner.style.display = "flex";
        if (bannerText) {
          bannerText.textContent = "🎙️ माइक चालू है: कृपया बोलें (हिंदी या अंग्रेजी में प्रश्न पूछें)...";
        }
      }
    };

    speechRecognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (input && transcript) {
        input.value = transcript;
      }
    };

    speechRecognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      if (bannerText) {
        bannerText.textContent = `⚠️ Voice status: ${event.error}. You can also type your query directly.`;
      }
    };

    speechRecognition.onend = () => {
      isVoiceRecording = false;
      micBtn.classList.remove("listening");
      micBtn.innerHTML = `<span class="mic-icon">🎤</span> <span class="mic-label">Voice Typing</span>`;
      setTimeout(() => {
        if (banner) banner.style.display = "none";
      }, 1200);

      // Auto-submit recognized speech query
      if (input && input.value.trim().length > 0) {
        const q = input.value.trim();
        input.value = "";
        processCopilotQuery(q);
      }
    };
  } catch (e) {
    console.warn("Could not initialize SpeechRecognition:", e);
  }
}

// Text-to-Speech Audio Readout
function speakTextFromCard(text, langCode, btn) {
  if (!window.speechSynthesis) {
    alert("Speech synthesis is not supported in this browser.");
    return;
  }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (btn) btn.classList.remove("speaking");
    return;
  }

  const cleanText = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = langCode || "hi-IN";
  utterance.rate = 0.95;

  if (btn) {
    btn.classList.add("speaking");
    utterance.onend = () => btn.classList.remove("speaking");
    utterance.onerror = () => btn.classList.remove("speaking");
  }

  window.speechSynthesis.speak(utterance);
}
window.speakTextFromCard = speakTextFromCard;

function initCopilot() {
  const form = $("copilot-form");
  const input = $("copilot-query-input");
  const clearBtn = $("btn-copilot-clear");

  if (form && input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      processCopilotQuery(q);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const box = $("copilot-chat-box");
      if (!box) return;
      box.innerHTML = `
        <div class="copilot-msg copilot-msg-ai">
          <div class="copilot-msg-avatar">🤖</div>
          <div class="copilot-msg-body">
            <div class="copilot-msg-meta">LINKTRACE DETECTIVE ASSISTANT • MULTILINGUAL READY</div>
            <div class="copilot-msg-content">
              इतिहास साफ़ कर दिया गया है / Chat cleared. You can ask questions in any language (हिन्दी, English, Hinglish) using text or voice typing (🎤).
            </div>
          </div>
        </div>
      `;
    });
  }

  // Quick inquiry chips
  document.querySelectorAll(".copilot-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const q = chip.dataset.query;
      if (q) processCopilotQuery(q);
    });
  });

  // Setup Voice Typing
  setupVoiceRecognition();
}

function appendCopilotMessage(sender, text, htmlContent = null, spokenSummary = null, lang = "en") {
  const box = $("copilot-chat-box");
  if (!box) return;

  const msgDiv = document.createElement("div");
  msgDiv.className = `copilot-msg copilot-msg-${sender}`;

  const avatar = sender === "ai" ? "🤖" : "👮";
  const meta = sender === "ai" ? "LINKTRACE AI MULTILINGUAL DETECTIVE" : (state.officer.name || "INVESTIGATING OFFICER");

  let bodyHtml = "";
  if (htmlContent) {
    bodyHtml = htmlContent;
  } else {
    bodyHtml = `<p>${text}</p>`;
  }

  let speakBtnHtml = "";
  if (sender === "ai" && spokenSummary) {
    const safeSummary = encodeURIComponent(spokenSummary);
    const speechLangCode = (lang === "hi" || lang === "hinglish") ? "hi-IN" : "en-IN";
    const label = lang === "hi" ? "🔊 बोलकर सुनाएं (Listen)" : (lang === "hinglish" ? "🔊 Bolkar Sunayein (Audio)" : "🔊 Listen Audio Brief");
    speakBtnHtml = `
      <div style="margin-top:8px;">
        <button class="btn-copilot-speak" type="button" onclick="speakTextFromCard(decodeURIComponent('${safeSummary}'), '${speechLangCode}', this)">
          ${label}
        </button>
      </div>
    `;
  }

  msgDiv.innerHTML = `
    <div class="copilot-msg-avatar">${avatar}</div>
    <div class="copilot-msg-body">
      <div class="copilot-msg-meta">${meta} • ${new Date().toLocaleTimeString()}</div>
      <div class="copilot-msg-content">
        ${bodyHtml}
        ${speakBtnHtml}
      </div>
    </div>
  `;

  box.appendChild(msgDiv);
  box.scrollTop = box.scrollHeight;
}

function inspectSuspectById(id) {
  inspectSuspect(id);
}
window.inspectSuspectById = inspectSuspectById;

function processCopilotQuery(query) {
  appendCopilotMessage("user", query);

  const q = query.toLowerCase();
  const lang = detectLanguage(query);

  // 1. Suspect: Neha Kapoor
  if (q.includes("neha") || q.includes("kapoor") || q.includes("नेहा") || q.includes("कपूर")) {
    const s = state.suspects.find((x) => x.name.toLowerCase().includes("neha")) || {
      id: "S003",
      name: "Neha Kapoor",
      alias: "The Accountant",
      role: "Syndicate Financial Controller & Mule Ring Coordinator",
      status: "Wanted",
      risk: "high",
      city: "DLF Phase 3, Gurugram",
      phone: "9818812345"
    };

    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `संदिग्ध नेहा कपूर सिंडिकेट की वित्तीय नियंत्रक है। वह गुरुग्राम के म्यूल बैंक खातों से लूट के पैसों की मनी लॉन्ड्रिंग और हवाला ट्रांसफर का संचालन करती है। वह वांछित घोषित है।`;
      answer = `
        <p><strong>🎯 संदिग्ध डॉसियर विश्लेषण: ${s.name.toUpperCase()} (S003)</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `(उपनाम: "${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>सिंडिकेट में भूमिका:</strong> मुख्य वित्तीय नियंत्रक (Financial Controller) एवं म्यूल बैंक खाता समन्वयक।</li>
            <li><strong>कानूनी स्थिति:</strong> <span class="badge danger">वांछित (WANTED)</span> • जोखिम स्तर: <span class="badge danger">उच्च जोखिम (High Risk)</span></li>
            <li><strong>अधिकार क्षेत्र व पता:</strong> ${s.city || "डीएलएफ फेज 3, गुरुग्राम (हरियाणा)"}</li>
            <li><strong>प्राथमिक मोबाइल नंबर:</strong> <code>${s.phone || "9818812345"}</code></li>
            <li><strong>अपराध कार्यप्रणाली (Modus Operandi):</strong> खान मार्केट सेठी ज्वैलर्स डकैती के ₹3.2 करोड़ के सोने की बिक्री से प्राप्त रकम को आईसीआईसीआई व एचडीएफसी के म्यूल खातों में 5 लाख से कम की किश्तों में जमा कराकर आरटीजीएस और हवाला के जरिए मुंबई व सूरत भेजा।</li>
            <li><strong>प्रत्यक्ष सहयोगी:</strong> विक्रम मल्होत्रा (सरगना), अनीता देसाई (मुंबई कैश-आउट), दीपक वर्मा (वाहन कटर)।</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 पूर्ण डॉसियर फ़ाइल खोलें (${s.id})</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Neha Kapoor is gang ki chief financial controller hai. Usne Khan Market heist ke baad Gurugram ke mule bank accounts se hawala money transfer kiya tha. Iske khilaf arrest warrant active hai.`;
      answer = `
        <p><strong>🎯 SUSPECT INTEL: ${s.name.toUpperCase()} (S003)</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `(Alias: "${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>Syndicate Role:</strong> Financial Controller & Mule Accounts Ring Incharge.</li>
            <li><strong>Legal Status:</strong> <span class="badge danger">WANTED</span> • Risk: <span class="badge danger">High Risk</span></li>
            <li><strong>Location & Phone:</strong> ${s.city || "DLF Phase 3, Gurugram"} • <code>${s.phone || "9818812345"}</code></li>
            <li><strong>Modus Operandi:</strong> Sethi Jewellers dacoity ke baad loot ka gold bechkar aaye ₹3.2 Cr ko FIU limits se bachane ke liye Gurugram ke accounts me sub-₹5 Lakh tranches me split kiya aur Mumbai Dongri hawala network ko forward kiya.</li>
            <li><strong>Direct Gang Links:</strong> Vikram Malhotra (Kingpin), Anita Desai (Mumbai Cash-out), Deepak Verma.</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Full Dossier (${s.id})</button>
        </div>
      `;
    } else {
      speech = `Suspect Neha Kapoor is the chief financial controller and mule ring coordinator of the syndicate, wanted under red alert.`;
      answer = `
        <p><strong>🎯 SUSPECT DOSSIER ANALYSIS: ${s.name.toUpperCase()}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `(Alias: "${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>Syndicate Role:</strong> ${s.role || "Financial Controller"}</li>
            <li><strong>Legal Status:</strong> <span class="badge ${riskClass(s.status)}">${s.status}</span> • Risk Assessment: <span class="badge ${riskClass(s.risk)}">${s.risk} Risk</span></li>
            <li><strong>Jurisdiction:</strong> ${s.city || "Gurugram, Haryana"}</li>
            <li><strong>Primary Phone:</strong> <code>${s.phone || "9818812345"}</code></li>
            <li><strong>Modus Operandi:</strong> Operates layered mule bank accounts (HDFC & ICICI) to receive armed heist proceeds and immediately disperse tranches via RTGS/UPI to Mumbai and Surat bullion merchants.</li>
            <li><strong>Direct Associates:</strong> Vikram Malhotra (Kingpin), Deepak Verma (Chop-Shop), Anita Desai (Mumbai Cash-out).</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Full Dossier File (${s.id})</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 2. Suspect: Vikram Malhotra / Kingpin / Sirgana
  if (q.includes("vikram") || q.includes("malhotra") || q.includes("kingpin") || q.includes("सरगना") || q.includes("विक्रम") || q.includes("मल्होत्रा") || q.includes("sargana") || q.includes("sirgana")) {
    const s = state.suspects.find((x) => x.name.toLowerCase().includes("vikram")) || {
      id: "S001",
      name: "Vikram Malhotra",
      alias: "Vicky Don",
      role: "Syndicate Kingpin & Armed Heist Planner",
      status: "Wanted",
      risk: "high",
      city: "Greater Kailash-I, New Delhi"
    };

    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `विक्रम मल्होत्रा इस अंतर्राज्यीय डकैती गिरोह का मुख्य सरगना है। वह खान मार्केट सेठी ज्वेलर्स डकैती का मुख्य आरोपी है और रेड कॉर्नर नोटिस के तहत वांछित है।`;
      answer = `
        <p><strong>🚨 मुख्य सरगना डॉसियर: ${s.name.toUpperCase()} (S001)</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `(उपनाम: "${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>सिंडिकेट भूमिका:</strong> अंतर-राज्यीय सशस्त्र डकैती गिरोह का मुख्य मास्टरमाइंड व रणनीतिकार।</li>
            <li><strong>कानूनी स्थिति:</strong> <span class="badge danger">वांछित • रेड कॉर्नर नोटिस (INTERPOL RED ALERT)</span></li>
            <li><strong>प्रमुख अपराध:</strong> खान मार्केट सेठी ज्वैलर्स में ₹3.2 करोड़ के सोने-हीरे की सशस्त्र डकैती का मुख्य आरोपी (FIR-2024-DL-4412)।</li>
            <li><strong>फरारी वाहन:</strong> काली बीएमडब्ल्यू 320d (DL-1C-AA-1001) और क्लोन्ड टोयोटा फॉर्च्यूनर (UP-16-EF-9012)।</li>
            <li><strong>सीडीआर डिजिटल साक्ष्य:</strong> अपराध से ठीक 15 मिनट पूर्व खान मार्केट टावर 3 पर 20:15 बजे उपस्थिति की डिजिटल पुष्टि।</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 सरगना का संपूर्ण डॉसियर खोलें (${s.id})</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Vikram Malhotra is gang ka prime kingpin hai. Sethi Jewellers Khan Market armed robbery me prime accused hai aur Interpol Red Corner notice par wanted hai.`;
      answer = `
        <p><strong>🚨 PRIME KINGPIN INTEL: ${s.name.toUpperCase()} (S001)</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `(Alias: "${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>Syndicate Role:</strong> Mastermind & Chief Organizer of inter-state armed heist network.</li>
            <li><strong>Status:</strong> <span class="badge danger">WANTED • RED CORNER ALERT</span></li>
            <li><strong>Key Crime:</strong> Khan Market Sethi Jewellers armed robbery (₹3.2 Cr gold/diamond loot).</li>
            <li><strong>Getaway Transport:</strong> Luxury BMW 320d (DL-1C-AA-1001) & Cloned Fortuner (UP-16-EF-9012).</li>
            <li><strong>CDR Proof:</strong> Dacoity se 15 min pehle 20:15 hrs par Khan Market Tower 3 par phone ping record hua.</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Kingpin Dossier (${s.id})</button>
        </div>
      `;
    } else {
      speech = `Vikram Malhotra is the primary kingpin and organizer of the inter-state armed heist network, wanted under a Red Corner Notice.`;
      answer = `
        <p><strong>🚨 PRIME KINGPIN INTEL: ${s.name.toUpperCase()}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} (Target ${s.id})</h4>
          <ul>
            <li><strong>Syndicate Role:</strong> Mastermind & Prime Organizer of inter-state heist network</li>
            <li><strong>Status:</strong> <span class="badge danger">WANTED • RED CORNER NOTICE</span></li>
            <li><strong>Key Crime:</strong> Prime accused in Khan Market Sethi Jewellers armed robbery (₹3.2 Cr gold/diamonds)</li>
            <li><strong>Getaway Transport:</strong> Luxury BMW 320d (DL-1C-AA-1001) & Cloned Fortuner (UP-16-EF-9012)</li>
            <li><strong>Critical CDR Evidence:</strong> Cellular tower logs placed S001 at Khan Market Tower 3 at 20:15 hrs, exactly 15 minutes prior to the armed breach.</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Kingpin Dossier (${s.id})</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 3. Hawala & Money Trail / Mule Accounts
  if (q.includes("hawala") || q.includes("money") || q.includes("trail") || q.includes("mule") || q.includes("हवाला") || q.includes("पैसे") || q.includes("खाता") || q.includes("लेनदेन") || q.includes("रुपये") || q.includes("transfer") || q.includes("financial")) {
    const totalTraced = state.transactions.reduce((sum, t) => sum + (t.amount_inr || 0), 0);

    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `जांच में एक करोड़ छह लाख रुपये से अधिक का अंतर-राज्यीय हवाला मनी ट्रेल ट्रेस हुआ है जो दिल्ली-एनसीआर, गुरुग्राम, और मुंबई डोंगरी तक फैला है।`;
      answer = `
        <p><strong>💸 अंतर-राज्यीय हवाला और मनी लॉन्ड्रिंग फॉरेंसिक रिपोर्ट</strong></p>
        <div class="copilot-dossier-card">
          <h4>ट्रेस की गई कुल लॉन्ड्रिंग रकम: ${money(totalTraced || 10682000)}</h4>
          <p>जांच में 3-स्तरीय जटिल मनी लॉन्ड्रिंग संरचना का खुलासा हुआ है:</p>
          <ul>
            <li><strong>पहला चरण (सोने की बिक्री व नकद परिवर्तन):</strong> चांदनी चौक के गुप्त रिसीवरों के माध्यम से लूटा गया सोना बेचकर डिजिटल आईएमपीएस क्रेडिट लिया गया।</li>
            <li><strong>दूसरा चरण (म्यूल खातों में लेयरिंग):</strong> नेहा कपूर द्वारा गुरुग्राम (डीएलएफ फेज 3) के खातों में एफआईयू रिपोर्टिंग सीमा (₹5 लाख) से कम की किश्तों में रकम जमा कराई गई।</li>
            <li><strong>तीसरा चरण (अंतिम निकासी):</strong> डोंगरी (मुंबई) में अनीता देसाई और झावेरी बाजार के सर्राफा कूरियरों को हवाला कूरियर के जरिए डिलीवरी।</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('transactions')">📊 वित्तीय लेनदेन बहीखाता खोलें</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Investigation me total 1.06 Crore se zyada ka Hawala money trail trace hua hai. Delhi se Gurugram mule accounts aur phir Mumbai Dongri tak paisa disperse kiya gaya tha.`;
      answer = `
        <p><strong>💸 INTER-STATE HAWALA & MONEY LAUNDERING TRAIL</strong></p>
        <div class="copilot-dossier-card">
          <h4>Total Traced Amount: ${money(totalTraced || 10682000)}</h4>
          <p>Gang ka 3-stage money laundering pipeline identified hai:</p>
          <ul>
            <li><strong>Stage 1 (Cash Conversion):</strong> Robbery ka sona Chandni Chowk ke black market jewellers ko bechkar bank account me IMPS credit kiya gaya.</li>
            <li><strong>Stage 2 (Mule Accounts Layering):</strong> Neha Kapoor ne Gurugram DLF Phase 3 ke multiple accounts me 5 lakh se kam amount me split kiya.</li>
            <li><strong>Stage 3 (Final Cash-Out):</strong> Anita Desai (Dongri, Mumbai) aur Zaveri Bazaar bullion couriers ko Hawala codes ke through transfer hua.</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('transactions')">📊 Open Financial Transactions Ledger</button>
        </div>
      `;
    } else {
      speech = `Inter-state hawala pipeline traced at over 1.06 crore rupees through a 3-tier layering architecture across Delhi, Gurugram, and Mumbai.`;
      answer = `
        <p><strong>💸 INTER-STATE HAWALA & MONEY LAUNDERING ANALYSIS</strong></p>
        <div class="copilot-dossier-card">
          <h4>Traced Laundering Pipeline (Total: ${money(totalTraced || 10682000)})</h4>
          <p>Investigation reveals a 3-tier layering architecture:</p>
          <ul>
            <li><strong>Stage 1 (Cash Conversion):</strong> Heist gold liquidated through Chandni Chowk fences into digital IMPS credits.</li>
            <li><strong>Stage 2 (Mule Layering):</strong> Managed by Neha Kapoor via accounts in Gurugram (DLF Phase 3) split into sub-₹5,00,000 tranches to evade FIU reporting limits.</li>
            <li><strong>Stage 3 (Cash-Out Destination):</strong> Routed to Anita Desai (Dongri, Mumbai) and Zaveri Bazaar bullion couriers.</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('transactions')">📊 Open Financial Transactions Ledger</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 4. Khan Market FIR / Heist
  if (q.includes("fir") || q.includes("khan market") || q.includes("4412") || q.includes("heist") || q.includes("jewel") || q.includes("case") || q.includes("डकैती") || q.includes("केस") || q.includes("एफआईआर") || q.includes("थाना")) {
    const fir = state.firs.find((f) => f.id.includes("4412")) || state.firs[0] || {};

    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `एफआईआर 4412 सेठी ज्वैलर्स खान मार्केट की सशस्त्र डकैती का मामला है जिसमें 3 करोड़ 20 लाख के सोने और हीरे लूटे गए थे। इसमें विक्रम मल्होत्रा और रमेश कालिया नामजद हैं।`;
      answer = `
        <p><strong>📁 केस फाइल: ${fir.id || "FIR-2024-DL-4412"}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${fir.title || "खान मार्केट सेठी ज्वैलर्स सशस्त्र डकैती कांड"}</h4>
          <ul>
            <li><strong>संबंधित पुलिस स्टेशन:</strong> ${fir.police_station || "तुगलक रोड थाना, नई दिल्ली"}</li>
            <li><strong>कानूनी स्थिति:</strong> <span class="badge medium">${fir.status || "चार्जशीट दायर • विचारणाधीन"}</span></li>
            <li><strong>अनुमानित नुकसान:</strong> ${money(fir.loss_estimate_inr || 32000000)} | <strong>बरामदगी:</strong> ${money(fir.recovered_amount_inr || 4500000)}</li>
            <li><strong>लागू दंड धाराएं:</strong> आईपीसी 392 (डकैती), 397 (घातक हथियार से डकैती), 120B (आपराधिक षड्यंत्र), आर्म्स एक्ट धारा 25/27।</li>
            <li><strong>नामित मुख्य आरोपी:</strong> विक्रम मल्होत्रा (S001), रमेश कालिया (S002), मोहम्मद इरफ़ान (S004)।</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('firs')">📁 एफआईआर रिकॉर्ड्स पृष्ठ खोलें</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `FIR number 4412 Tughlak Road police station me darj hai. Sethi Jewellers Khan Market me 3.2 Crore ki armed loot hui thi jisme Vikram Malhotra aur Ramesh Kalia prime accused hain.`;
      answer = `
        <p><strong>📁 CASE BRIEF: ${fir.id || "FIR-2024-DL-4412"}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${fir.title || "Khan Market Sethi Jewellers Armed Robbery"}</h4>
          <ul>
            <li><strong>Police Station:</strong> ${fir.police_station || "Tughlak Road PS, New Delhi"}</li>
            <li><strong>Legal Status:</strong> <span class="badge medium">${fir.status || "Chargesheet filed • Court Trial"}</span></li>
            <li><strong>Total Loss:</strong> ${money(fir.loss_estimate_inr || 32000000)} | <strong>Recovered:</strong> ${money(fir.recovered_amount_inr || 4500000)}</li>
            <li><strong>Sections Invoked:</strong> IPC 392 (Robbery), 397 (Deadly weapons), 120B (Conspiracy), Arms Act Sec 25/27.</li>
            <li><strong>Named Accused:</strong> Vikram Malhotra (S001), Ramesh Kalia (S002), Mohd. Irfan (S004).</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('firs')">📁 Open FIR Records Page</button>
        </div>
      `;
    } else {
      speech = `FIR 2024 DL 4412 at Tughlak Road Police Station covers the Sethi Jewellers armed robbery with 3.2 crore loss estimate.`;
      answer = `
        <p><strong>📁 CASE BRIEF: ${fir.id || "FIR-2024-DL-4412"}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${fir.title || "Khan Market Sethi Jewellers Armed Robbery"}</h4>
          <ul>
            <li><strong>Police Station:</strong> ${fir.police_station || "Tughlak Road PS, New Delhi"}</li>
            <li><strong>Legal Status:</strong> <span class="badge medium">${fir.status || "Chargesheet filed"}</span></li>
            <li><strong>Loss Estimate:</strong> ${money(fir.loss_estimate_inr || 32000000)} | <strong>Recovered:</strong> ${money(fir.recovered_amount_inr || 4500000)}</li>
            <li><strong>Penal Sections:</strong> IPC 392 (Robbery), 397 (Robbery with deadly weapon), 120B (Criminal Conspiracy), Arms Act Sec 25/27.</li>
            <li><strong>Accused Named:</strong> Vikram Malhotra (S001), Ramesh Kalia (S002), Mohd. Irfan (S004).</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('firs')">📁 Open FIR Records Page</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 5. Tower CDR Convergence
  if (q.includes("tower") || q.includes("cdr") || q.includes("convergence") || q.includes("ping") || q.includes("call") || q.includes("टावर") || q.includes("सीडीआर") || q.includes("कॉल") || q.includes("लोकेशन")) {
    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `सीडीआर फॉरेंसिक रिपोर्ट से सिद्ध होता है कि खान मार्केट टावर 3 पर घटना के समय विक्रम मल्होत्रा और रमेश कालिया दोनों मौजूद थे। 450 मीटर के दायरे में उनकी उपस्थिति प्रमाणित है।`;
      answer = `
        <p><strong>📡 सेल टावर सीडीआर कन्वर्जेंस फॉरेंसिक रिपोर्ट</strong></p>
        <div class="copilot-dossier-card">
          <h4>घटनास्थल सह-उपस्थिति डिजिटल साक्ष्य (खान मार्केट टावर 3)</h4>
          <p>फोरेंसिक टेलीकॉम सीडीआर लॉग विश्लेषण से स्पष्ट सह-उपस्थिति सिद्ध हुई है:</p>
          <ul>
            <li><strong>अभियुक्त S001 (विक्रम मल्होत्रा):</strong> टावर पिंग शाम 20:15:30 बजे, IMEI: <code>356789012345678</code></li>
            <li><strong>अभियुक्त S002 (रमेश कालिया):</strong> टावर पिंग शाम 20:18:12 बजे, IMEI: <code>867890123456789</code></li>
            <li><strong>अभियुक्त S004 (मोहम्मद इरफ़ान):</strong> फरारी वाहन से S001 को शाम 20:21:05 बजे 42 सेकंड की इंटरसेप्टेड कॉल।</li>
          </ul>
          <p>यह तकनीकी साक्ष्य साबित करता है कि मुख्य शूटर और फरारी वाहन चालक डकैती के समय सेठी ज्वैलर्स के 450 मीटर के दायरे में एक साथ मौजूद थे।</p>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">📡 सभी टेलीकॉम सीडीआर लॉग्स देखें</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Khan Market Tower 3 par crime ke time Vikram Malhotra aur Ramesh Kalia ke phones ek sath ping huye the. Yeh telecom forensic evidence unki presence ko prove karta hai.`;
      answer = `
        <p><strong>📡 CELL TOWER CDR CONVERGENCE REPORT</strong></p>
        <div class="copilot-dossier-card">
          <h4>Crime Scene Co-Location (Khan Market Tower 3)</h4>
          <p>Forensic telecom CDR log analysis confirms conclusive co-location:</p>
          <ul>
            <li><strong>Suspect S001 (Vikram Malhotra):</strong> Tower ping at 20:15:30 IST, IMEI: <code>356789012345678</code></li>
            <li><strong>Suspect S002 (Ramesh Kalia):</strong> Tower ping at 20:18:12 IST, IMEI: <code>867890123456789</code></li>
            <li><strong>Suspect S004 (Mohd. Irfan):</strong> Intercepted CDR call to S001 at 20:21:05 IST duration 42 seconds from getaway vehicle.</li>
          </ul>
          <p>Ye prime shooters aur getaway drivers ko dacoity ke time Sethi Jewellers ke 450 meter radius ke andar place karta hai.</p>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">📡 Inspect All Telecom CDR Logs</button>
        </div>
      `;
    } else {
      speech = `Forensic telecom CDR analysis confirms conclusive co-location of suspects S001 and S002 at Khan Market Tower 3 during the crime window.`;
      answer = `
        <p><strong>📡 CELL TOWER CDR CONVERGENCE REPORT</strong></p>
        <div class="copilot-dossier-card">
          <h4>Crime Scene Co-Location (Khan Market Tower 3)</h4>
          <p>Forensic telecom CDR log analysis confirms conclusive co-location:</p>
          <ul>
            <li><strong>Suspect S001 (Vikram Malhotra):</strong> Tower ping at 20:15:30 IST, IMEI: <code>356789012345678</code></li>
            <li><strong>Suspect S002 (Ramesh Kalia):</strong> Tower ping at 20:18:12 IST, IMEI: <code>867890123456789</code></li>
            <li><strong>Suspect S004 (Mohd. Irfan):</strong> Intercepted CDR call to S001 at 20:21:05 IST duration 42 seconds from getaway vehicle.</li>
          </ul>
          <p>This places prime syndicate shooters and getaway drivers within a 450-meter radius of Sethi Jewellers simultaneously during the crime execution window.</p>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">📡 Inspect All Telecom CDR Logs</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 6. Vehicles & Getaway Cars
  if (q.includes("vehicle") || q.includes("car") || q.includes("fortuner") || q.includes("bmw") || q.includes("swift") || q.includes("गाड़ी") || q.includes("गाड़ियां") || q.includes("कार") || q.includes("गाड़ियाँ") || q.includes("gadi") || q.includes("gaadi")) {
    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `गिरोह द्वारा उपयोग की गई टोयोटा फॉर्च्यूनर गाजियाबाद में दीपक वर्मा के गैराज से बरामद कर ली गई है। विक्रम मल्होत्रा की बीएमडब्ल्यू कार ग्रेटर कैलाश में ट्रेस की गई है।`;
      answer = `
        <p><strong>🚘 निगरानी एवं वाहन बरामदगी खुफिया रिपोर्ट</strong></p>
        <div class="copilot-dossier-card">
          <h4>ट्रैक किए गए गिरोह के वाहन (कुल: ${state.vehicles.length || 3})</h4>
          <ul>
            <li><strong>बीएमडब्ल्यू 320d (DL-1C-AA-1001):</strong> विक्रम मल्होत्रा के नाम पंजीकृत, जीके-1 के बेसमेंट पार्किंग में छिपाए जाने की पुष्टि।</li>
            <li><strong>टोयोटा फॉर्च्यूनर (UP-16-EF-9012):</strong> लूट में प्रयुक्त चोरी का वाहन। दीपक वर्मा के गाजियाबाद गैराज से बदले हुए चेसिस नंबर के साथ सफलतापूर्वक बरामद।</li>
            <li><strong>मारुति स्विफ्ट (DL-3C-DD-4040):</strong> बदरपुर टोल प्लाजा पर एएनपीआर सीसीटीवी कैमरों में बल्लभगढ़ की ओर जाते हुए कैद।</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">🚘 ट्रैक किए गए वाहन पृष्ठ खोलें</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Gang ki getaway Toyota Fortuner car Deepak Verma ke Ghaziabad garage se recover ho chuki hai, jabki Vikram ki BMW 320d par surveillance lagayi gayi hai.`;
      answer = `
        <p><strong>🚘 SURVEILLANCE & VEHICLE RECOVERY INTEL</strong></p>
        <div class="copilot-dossier-card">
          <h4>Tracked Gang Fleet (Total: ${state.vehicles.length || 3} Vehicles)</h4>
          <ul>
            <li><strong>BMW 320d (DL-1C-AA-1001):</strong> Vikram Malhotra ki personal car, Greater Kailash-I me located.</li>
            <li><strong>Toyota Fortuner (UP-16-EF-9012):</strong> Heist getaway car Deepak Verma ke Ghaziabad garage se chassis tampered state me recover kar li gayi hai.</li>
            <li><strong>Maruti Swift (DL-3C-DD-4040):</strong> Badarpur Toll Plaza ANPR cameras me Ballabgarh ki taraf jati spot hui.</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">🚘 Open Tracked Vehicles Page</button>
        </div>
      `;
    } else {
      speech = `Fleet intelligence: The stolen Toyota Fortuner getaway car was recovered in Ghaziabad, while Vikram Malhotra's BMW 320d remains under surveillance.`;
      answer = `
        <p><strong>🚘 SURVEILLANCE & VEHICLE RECOVERY INTELLIGENCE</strong></p>
        <div class="copilot-dossier-card">
          <h4>Tracked Gang Fleet (Total: ${state.vehicles.length || 3} Vehicles)</h4>
          <ul>
            <li><strong>BMW 320d (DL-1C-AA-1001):</strong> Registered to Vikram Malhotra. Concealed in GK-I basement parking.</li>
            <li><strong>Toyota Fortuner (UP-16-EF-9012):</strong> Stolen vehicle used as crash getaway. Intercepted and recovered at Deepak Verma's Ghaziabad garage with altered chassis.</li>
            <li><strong>Maruti Swift (DL-3C-DD-4040):</strong> Spotted on ANPR CCTV passing Badarpur Toll Plaza heading towards Ballabgarh.</li>
          </ul>
          <button class="copilot-action-btn" onclick="switchDashboardPage('vehicles')">🚘 Open Tracked Vehicles Page</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // 7. Dynamic search match across suspects
  const matchingSuspect = state.suspects.find((s) =>
    s.name.toLowerCase().includes(q) || (s.alias && s.alias.toLowerCase().includes(q)) || (s.role && s.role.toLowerCase().includes(q))
  );

  if (matchingSuspect) {
    const s = matchingSuspect;
    let answer = "";
    let speech = "";

    if (lang === "hi") {
      speech = `संदिग्ध ${s.name} सिंडिकेट में ${s.role || "ऑपरेटिव"} के पद पर है। स्थिति ${s.status} है।`;
      answer = `
        <p><strong>👤 मिलान संदिग्ध विवरण: ${s.name.toUpperCase()}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `("${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>भूमिका:</strong> ${s.role || "ऑपरेटिव"}</li>
            <li><strong>अधिकार क्षेत्र:</strong> ${s.city || "अखिल भारतीय निगरानी"}</li>
            <li><strong>स्थिति:</strong> <span class="badge ${riskClass(s.status)}">${s.status}</span></li>
            <li><strong>मोबाइल:</strong> <code>${s.phone || "उपलब्ध नहीं"}</code></li>
            <li><strong>टिप्पणी:</strong> ${s.notes || "अखिल भारतीय अपराध नेटवर्क के अंतर्गत निरंतर निगरानी सक्रिय।"}</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 पूर्ण डॉसियर देखें</button>
        </div>
      `;
    } else if (lang === "hinglish") {
      speech = `Suspect ${s.name} is network me ${s.role || "operative"} hai. Current status ${s.status} mark kiya gaya hai.`;
      answer = `
        <p><strong>👤 MATCHED SUSPECT: ${s.name.toUpperCase()}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `("${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>Role:</strong> ${s.role || "Operative"}</li>
            <li><strong>Location:</strong> ${s.city || "Pan-India Scope"}</li>
            <li><strong>Status:</strong> <span class="badge ${riskClass(s.status)}">${s.status}</span></li>
            <li><strong>Phone:</strong> <code>${s.phone || "None"}</code></li>
            <li><strong>Intel Notes:</strong> ${s.notes || "Active under Pan-India CCTNS surveillance."}</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Dossier</button>
        </div>
      `;
    } else {
      speech = `Matched suspect ${s.name}, operating as ${s.role || "syndicate member"} in ${s.city || "India"}. Status is ${s.status}.`;
      answer = `
        <p><strong>👤 MATCHED SUSPECT: ${s.name.toUpperCase()}</strong></p>
        <div class="copilot-dossier-card">
          <h4>${s.name} ${s.alias ? `("${s.alias}")` : ""}</h4>
          <ul>
            <li><strong>Role:</strong> ${s.role || "Operative"}</li>
            <li><strong>Jurisdiction:</strong> ${s.city || "Pan-India"}</li>
            <li><strong>Status:</strong> <span class="badge ${riskClass(s.status)}">${s.status}</span></li>
            <li><strong>Phone:</strong> <code>${s.phone || "None"}</code></li>
            <li><strong>Notes:</strong> ${s.notes || "Surveillance active under Pan-India crime monitoring."}</li>
          </ul>
          <button class="copilot-action-btn" onclick="inspectSuspectById('${s.id}')">📂 Open Dossier</button>
        </div>
      `;
    }

    setTimeout(() => appendCopilotMessage("ai", "", answer, speech, lang), 250);
    return;
  }

  // Fallback intelligent summary
  let fallback = "";
  let fallbackSpeech = "";

  if (lang === "hi") {
    fallbackSpeech = `लिंकट्रेस डेटाबेस में कुल ${state.suspects.length} संदिग्ध, ${state.firs.length} एफआईआर, और एक करोड़ छह लाख से अधिक की मनी ट्रेल दर्ज है। आप किसी भी संदिग्ध या केस के बारे में पूछ सकते हैं।`;
    fallback = `
      <p><strong>🤖 एआई विश्लेषण: "${query}"</strong></p>
      <div class="copilot-dossier-card">
        <p>राष्ट्रीय पुलिस डेटाबेस सारांश (${state.suspects.length} सक्रिय संदिग्ध, ${state.firs.length} एफआईआर मामले, ${state.transactions.length} वित्तीय लेनदेन):</p>
        <ul>
          <li><strong>मुख्य जांच:</strong> खान मार्केट सेठी ज्वैलर्स सशस्त्र डकैती (FIR-2024-DL-4412)।</li>
          <li><strong>प्रमुख वांछित:</strong> विक्रम मल्होत्रा (S001), रमेश कालिया (S002), नेहा कपूर (S003)।</li>
          <li><strong>ट्रेस हवाला ट्रेल:</strong> ${money(state.overview.total_transferred_inr || 10682000)} गुरुग्राम से मुंबई डोंगरी तक।</li>
        </ul>
        <p style="font-size:11.5px; color:var(--text-muted); margin-top:6px;">सुझाव: ऊपर दिए गए त्वरित बटनों पर क्लिक करें या <em>"नेहा कपूर कौन है?"</em>, <em>"हवाला ट्रेल बताओ"</em> जैसा प्रश्न पूछें या माइक 🎤 से बोलें।</p>
      </div>
    `;
  } else if (lang === "hinglish") {
    fallbackSpeech = `LinkTrace database me ${state.suspects.length} suspects aur ${state.firs.length} FIRs tracked hain. Aap kisi bhi suspect ya Hawala trail ke bare me sawaal pooch sakte hain.`;
    fallback = `
      <p><strong>🤖 COPILOT INTEL QUERY: "${query}"</strong></p>
      <div class="copilot-dossier-card">
        <p>Current intelligence overview across synchronized Pan-India database (${state.suspects.length} suspects, ${state.firs.length} FIR cases, ${state.transactions.length} transfers):</p>
        <ul>
          <li><strong>Primary Investigation:</strong> Sethi Jewellers Heist (FIR-2024-DL-4412) connecting Delhi-NCR to Mumbai and Jaipur.</li>
          <li><strong>Wanted Targets:</strong> Vikram Malhotra (S001), Ramesh Kalia (S002), Neha Kapoor (S003).</li>
          <li><strong>Financial Trail:</strong> ${money(state.overview.total_transferred_inr || 10682000)} traced across layered mule accounts to Mumbai Dongri cash-outs.</li>
        </ul>
        <p style="font-size:11.5px; color:var(--text-muted); margin-top:6px;">Suggestion: Aap quick query chips par click kar sakte hain ya <em>"Neha Kapoor kaun hai?"</em> bol/type kar sakte hain.</p>
      </div>
    `;
  } else {
    fallbackSpeech = `LinkTrace database summary: ${state.suspects.length} active suspects, ${state.firs.length} registered FIR cases, and over 1.06 crore rupees in traced hawala transfers.`;
    fallback = `
      <p><strong>🤖 COPILOT QUERY ANALYSIS FOR: "${query}"</strong></p>
      <div class="copilot-dossier-card">
        <p>Current intelligence overview across synchronized Pan-India database (${state.suspects.length} suspects, ${state.firs.length} cases, ${state.transactions.length} transfers):</p>
        <ul>
          <li><strong>Primary Investigation:</strong> Sethi Jewellers Heist (FIR-2024-DL-4412) connecting Delhi-NCR to Mumbai and Jaipur.</li>
          <li><strong>Wanted Targets:</strong> Vikram Malhotra (S001), Ramesh Kalia (S002), Neha Kapoor (S003).</li>
          <li><strong>Financial Trail:</strong> ${money(state.overview.total_transferred_inr || 10682000)} traced across layered mule accounts to Mumbai Dongri cash-outs.</li>
        </ul>
        <p style="font-size:11.5px; color:var(--text-muted); margin-top:6px;">Suggested: Click any quick query chip above or ask about specific suspects like <em>"Neha Kapoor"</em>, or click the mic button 🎤 to speak.</p>
      </div>
    `;
  }

  setTimeout(() => appendCopilotMessage("ai", "", fallback, fallbackSpeech, lang), 250);
}

// =========================================================================
// 6. PAGE 2: SUSPECTS DIRECTORY
// =========================================================================
function renderSuspectsPage() {
  const container = $("suspects-grid");
  container.innerHTML = "";

  const searchQuery = ($("search-suspects-input").value || "").toLowerCase().trim();
  const filter = state.activeSuspectFilter;

  const filtered = state.suspects.filter((s) => {
    if (filter !== "all" && s.status !== filter) return false;
    if (searchQuery) {
      const haystack = `${s.name} ${s.alias || ""} ${s.city || ""} ${s.role || ""} ${s.phone || ""}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  // Ensure newly added records in this session appear at the very top
  filtered.sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));

  filtered.forEach((s) => {
    const card = document.createElement("div");
    card.className = `suspect-card${s.is_new ? " newly-added-record" : ""}`;

    const initials = (s.name || "UN")
      .split(" ")
      .filter(Boolean)
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    card.innerHTML = `
      <div class="suspect-card-top">
        <div class="suspect-avatar-badge">${initials}</div>
        <div class="suspect-header-info">
          <h3>${s.name} ${s.is_new ? '<span class="new-record-pill">✨ NEW ENTRY</span>' : ''}</h3>
          <div class="suspect-alias">${s.alias ? `Alias: "${s.alias}"` : "ID: " + s.id}</div>
        </div>
      </div>
      <div class="suspect-card-body">
        <div class="suspect-info-row">
          <span class="info-label">Syndicate Role</span>
          <span class="info-val">${s.role || "Operative"}</span>
        </div>
        <div class="suspect-info-row">
          <span class="info-label">City / Jurisdiction</span>
          <span class="info-val">${s.city || "NCR"}</span>
        </div>
        <div class="suspect-info-row">
          <span class="info-label">Contact Phone</span>
          <span class="info-val" style="font-family: var(--font-mono);">${s.phone || "None"}</span>
        </div>
        <div class="suspect-info-row">
          <span class="info-label">Linked Cases</span>
          <span class="info-val">${(s.fir_ids || []).length} FIR(s)</span>
        </div>
      </div>
      <div class="suspect-card-footer">
        <div>
          <span class="badge ${riskClass(s.status)}">${s.status}</span>
          <span class="badge ${riskClass(s.risk)}">${s.risk} Risk</span>
        </div>
        <button class="btn btn-sm btn-primary btn-view-dossier" type="button">View Dossier ➔</button>
      </div>
    `;

    card.querySelector(".btn-view-dossier").addEventListener("click", () => inspectSuspect(s.id));
    card.addEventListener("click", (e) => {
      if (!e.target.closest(".btn-view-dossier")) inspectSuspect(s.id);
    });
    container.appendChild(card);
  });

  if (!filtered.length) {
    container.innerHTML = `<p class="subtext" style="grid-column: 1/-1; padding: 24px; text-align: center;">No suspect profiles match current filters.</p>`;
  }
}

async function inspectSuspect(suspectId) {
  const dossier = await api(`/api/suspects/${suspectId}`);
  const s = dossier.suspect;
  const initials = s.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  const html = `
    <div class="dossier-hero">
      <div class="dossier-avatar">${initials}</div>
      <div class="dossier-meta">
        <h3>${s.name} ${s.alias ? `<span style="color:var(--amber); font-size:14px;">("${s.alias}")</span>` : ""}</h3>
        <div>
          <span class="badge ${riskClass(s.status)}">${s.status}</span>
          <span class="badge ${riskClass(s.risk)}">${s.risk} Risk</span>
        </div>
      </div>
    </div>

    <div class="dossier-section-title">Confidential Criminal Profile</div>
    <dl class="kv-table">
      <dt>Suspect ID</dt><dd><strong>${s.id}</strong></dd>
      <dt>Syndicate Role</dt><dd>${s.role || "Operative"}</dd>
      <dt>Phone (CDR)</dt><dd style="font-family: var(--font-mono);">${s.phone || "—"} ${s.alt_phone ? `<br>${s.alt_phone}` : ""}</dd>
      <dt>Aadhaar</dt><dd style="font-family: var(--font-mono);">${s.aadhaar_masked || "Unverified"}</dd>
      <dt>Base Address</dt><dd>${s.address}, ${s.city}</dd>
      <dt>Bank Accounts</dt><dd style="font-family: var(--font-mono);">${(s.accounts || []).join(", ") || "None mapped"}</dd>
    </dl>

    <div class="dossier-section-title">Intelligence & Surveillance Notes</div>
    <p class="subtext" style="line-height:1.6; margin-bottom: 16px;">${s.notes || "No surveillance summary filed."}</p>

    <div class="dossier-section-title">Linked FIR Crime Cases (${dossier.firs.length})</div>
    <ul class="mini-list">
      ${dossier.firs.map((f) => `<li><strong>${f.id}</strong> — ${f.offense} (${f.police_station}) <br><span style="color:var(--crimson); font-family:var(--font-mono); font-size:11px;">Loss: ${money(f.loss_estimate_inr)}</span></li>`).join("") || "<li class='subtext'>No FIRs linked directly</li>"}
    </ul>

    <div class="dossier-section-title">Registered / Linked Vehicles (${dossier.vehicles.length})</div>
    <ul class="mini-list">
      ${dossier.vehicles.map((v) => `<li><strong style="font-family:var(--font-mono); color:var(--cyan);">${v.registration}</strong> · ${v.make} ${v.model} (${v.status})</li>`).join("") || "<li class='subtext'>No vehicles registered</li>"}
    </ul>

    <div class="dossier-section-title">Known Associates (${dossier.associates.length})</div>
    <ul class="mini-list">
      ${dossier.associates.map((a) => `<li><strong>${a.name} (${a.id})</strong> · ${a.role} · ${a.city}</li>`).join("") || "<li class='subtext'>No associates mapped</li>"}
    </ul>

    <div class="dossier-section-title">Intercepted Calls (${dossier.calls.length})</div>
    <ul class="mini-list">
      ${dossier.calls.slice(-5).map((c) => `<li>${c.timestamp}: <span style="font-family:var(--font-mono);">${c.from_phone} ➔ ${c.to_phone}</span> (${c.duration_sec}s, ${c.tower})</li>`).join("") || "<li class='subtext'>No call records</li>"}
    </ul>

    <div class="dossier-section-title">Financial Hawala / UPI Ledger (${dossier.transactions.length})</div>
    <ul class="mini-list">
      ${dossier.transactions.slice(-5).map((t) => `<li>${t.timestamp}: <strong style="color:var(--emerald); font-family:var(--font-mono);">${t.mode} ${money(t.amount_inr)}</strong> — ${t.narration || "Transfer"}</li>`).join("") || "<li class='subtext'>No transactions</li>"}
    </ul>
  `;

  openDrawer(`${s.name} (${s.id})`, html);
}

// =========================================================================
// 7. PAGE 3: FIR RECORDS
// =========================================================================
function renderFirsPage() {
  const container = $("firs-grid");
  container.innerHTML = "";

  const filter = state.activeFirFilter;
  const searchQuery = ($("search-firs-input").value || "").toLowerCase().trim();

  const filtered = state.firs.filter((f) => {
    if (filter !== "all" && f.status !== filter) return false;
    if (searchQuery) {
      const haystack = `${f.id} ${f.offense || f.title || ""} ${f.police_station} ${f.district || ""} ${(f.sections || []).join(" ")}`.toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    return true;
  });

  // Ensure newly added FIRs in this session appear at the very top
  filtered.sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));

  filtered.forEach((f) => {
    const card = document.createElement("div");
    card.className = `fir-card-item${f.is_new ? " newly-added-record" : ""}`;

    const offenseText = f.offense || f.title || "Criminal Offense";
    const accusedText = (f.accused_ids && f.accused_ids.length) ? f.accused_ids.join(", ") : (f.accused || "S001");

    card.innerHTML = `
      <div class="fir-card-header">
        <div>
          <div class="fir-number">${f.id} ${f.is_new ? '<span class="new-record-pill">✨ NEW ENTRY</span>' : ''}</div>
          <div class="fir-offense-title">${offenseText}</div>
        </div>
        <div class="fir-loss-badge">${money(f.loss_estimate_inr)}</div>
      </div>
      <div class="fir-meta-row">
        <span>Police Station: <strong>${f.police_station}</strong> (${f.district || "NCR"})</span>
        <span>Date: <strong>${f.date}</strong></span>
        <span>IPC Sections: <strong>${(f.sections || []).join(", ") || "IPC"}</strong></span>
        <span>Status: <span class="badge ${riskClass(f.status)}">${f.status}</span></span>
      </div>
      <p class="fir-summary-text">${f.summary}</p>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
        <span class="subtext">Accused Suspects: <strong style="color:var(--text-main); font-family:var(--font-mono);">${accusedText}</strong></span>
        <button class="btn btn-sm btn-ghost btn-inspect-fir" type="button">Inspect Case File ➔</button>
      </div>
    `;

    card.querySelector(".btn-inspect-fir").addEventListener("click", () => inspectFir(f));
    container.appendChild(card);
  });
}

function inspectFir(f) {
  const html = `
    <div class="dossier-hero">
      <div class="dossier-avatar" style="border-color: var(--crimson); color: var(--crimson);">FIR</div>
      <div class="dossier-meta">
        <h3>${f.id}</h3>
        <span class="badge ${riskClass(f.status)}">${f.status}</span>
      </div>
    </div>
    <dl class="kv-table">
      <dt>Offense</dt><dd><strong>${f.offense}</strong></dd>
      <dt>Police Station</dt><dd>${f.police_station} (${f.district})</dd>
      <dt>Date Filed</dt><dd>${f.date}</dd>
      <dt>IPC Sections</dt><dd>${(f.sections || []).join(", ")}</dd>
      <dt>Complainant</dt><dd>${f.complainant || "Meera Sethi"}</dd>
      <dt>Loss Estimate</dt><dd><strong style="color: var(--crimson); font-size: 16px;">${money(f.loss_estimate_inr)}</strong></dd>
      <dt>Accused Suspects</dt><dd style="font-family: var(--font-mono);">${(f.accused_ids || []).join(", ")}</dd>
    </dl>
    <div class="dossier-section-title">Incident Details & Police Chargesheet</div>
    <p class="subtext" style="line-height:1.6;">${f.summary}</p>
  `;
  openDrawer(`FIR Case: ${f.id}`, html);
}

// =========================================================================
// 8. PAGE 4: VEHICLES & CDR LOGS
// =========================================================================
function renderVehiclesPage() {
  const vContainer = $("vehicles-grid");
  vContainer.innerHTML = "";
  $("vehicles-count").textContent = `${state.vehicles.length} tracked vehicles`;

  const vehiclesList = [...state.vehicles].sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));

  vehiclesList.forEach((v) => {
    const card = document.createElement("div");
    card.className = `vehicle-card${v.is_new ? " newly-added-record" : ""}`;
    const plate = v.registration || v.plate || "VEHICLE";
    const makeModel = `${v.make || ""} ${v.model || ""}`.trim() || v.model || "Tracked Fleet Vehicle";

    card.innerHTML = `
      <div class="vehicle-card-top">
        <span class="vehicle-plate">${plate} ${v.is_new ? '<span class="new-record-pill">✨ NEW ENTRY</span>' : ''}</span>
        <span class="badge low">${v.status}</span>
      </div>
      <h3 style="font-size: 15px; font-weight:700; margin: 8px 0 4px;">${makeModel} (${v.color || "Vehicle"})</h3>
      <div class="suspect-card-body" style="margin-bottom: 10px;">
        <div class="suspect-info-row">
          <span class="info-label">Registered Owner</span>
          <span class="info-val">${v.owner_id ? `Suspect ${v.owner_id}` : (v.suspect || "Unknown")}</span>
        </div>
        <div class="suspect-info-row">
          <span class="info-label">Last Seen Location</span>
          <span class="info-val">${v.last_seen_location || v.last_seen || "Unknown"}</span>
        </div>
      </div>
      <p class="subtext" style="margin-bottom: 12px;">${v.notes || "Vehicle tracked via LinkTrace radar."}</p>
      <button class="btn btn-sm btn-ghost btn-inspect-v" style="align-self: flex-start;" type="button">Inspect Vehicle Log</button>
    `;
    card.querySelector(".btn-inspect-v").addEventListener("click", () => inspectVehicle(v));
    vContainer.appendChild(card);
  });

  const tableBody = $("calls-table-body");
  tableBody.innerHTML = "";
  $("calls-count").textContent = `${state.calls.length} telecom CDR intercepts`;

  state.calls.forEach((c) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-family: var(--font-mono); color: var(--cyan); font-weight:700;">${c.id}</td>
      <td style="font-family: var(--font-mono); font-size:11px;">${c.timestamp.replace("T", " ")}</td>
      <td style="font-family: var(--font-mono); font-weight:600;">${c.from_phone}</td>
      <td style="font-family: var(--font-mono); font-weight:600;">${c.to_phone}</td>
      <td><span class="badge low">${c.duration_sec}s</span></td>
      <td><strong>${c.tower}</strong></td>
      <td style="font-family: var(--font-mono); font-size:11px; color: var(--text-dim);">${c.imei || "—"}</td>
      <td><button class="btn btn-sm btn-ghost btn-inspect-call" type="button">Inspect</button></td>
    `;
    tr.querySelector(".btn-inspect-call").addEventListener("click", () => inspectCall(c));
    tableBody.appendChild(tr);
  });
}

function inspectVehicle(v) {
  const html = `
    <div class="dossier-hero">
      <div class="dossier-avatar" style="border-color: var(--blue); color: var(--blue);">CAR</div>
      <div class="dossier-meta">
        <h3>${v.registration}</h3>
        <span class="badge low">${v.status}</span>
      </div>
    </div>
    <dl class="kv-table">
      <dt>Make & Model</dt><dd>${v.make} ${v.model} (${v.color})</dd>
      <dt>Chassis No.</dt><dd style="font-family: var(--font-mono);">${v.chassis_number || "Verified"}</dd>
      <dt>Owner Link</dt><dd>Suspect ${v.owner_id}</dd>
      <dt>Last Location</dt><dd>${v.last_seen_location}</dd>
    </dl>
    <div class="dossier-section-title">Challan & CCTV Recovery Notes</div>
    <p class="subtext">${v.notes}</p>
  `;
  openDrawer(`Vehicle: ${v.registration}`, html);
}

function inspectCall(c) {
  const html = `
    <div class="dossier-hero">
      <div class="dossier-avatar" style="border-color: var(--cyan); color: var(--cyan);">CDR</div>
      <div class="dossier-meta">
        <h3>Call Data Record (${c.id})</h3>
        <span class="badge low">${c.duration_sec}s Duration</span>
      </div>
    </div>
    <dl class="kv-table">
      <dt>Caller (From)</dt><dd style="font-family: var(--font-mono); font-weight:700;">${c.from_phone} (${c.from_suspect || "Unknown"})</dd>
      <dt>Receiver (To)</dt><dd style="font-family: var(--font-mono); font-weight:700;">${c.to_phone} (${c.to_suspect || "Unknown"})</dd>
      <dt>Timestamp</dt><dd style="font-family: var(--font-mono);">${c.timestamp}</dd>
      <dt>Cell Tower</dt><dd><strong>${c.tower}</strong></dd>
      <dt>IMEI Number</dt><dd style="font-family: var(--font-mono);">${c.imei}</dd>
    </dl>
  `;
  openDrawer(`Call Record: ${c.id}`, html);
}

// =========================================================================
// 9. PAGE 5: FINANCIAL TRANSACTIONS
// =========================================================================
function renderTransactionsPage() {
  const container = $("transactions-grid");
  if (!container) return;
  container.innerHTML = "";

  const txList = [...state.transactions].sort((a, b) => (b.is_new ? 1 : 0) - (a.is_new ? 1 : 0));

  txList.forEach((t) => {
    const card = document.createElement("div");
    card.className = `tx-card${t.is_new ? " newly-added-record" : ""}`;

    card.innerHTML = `
      <div class="tx-card-header">
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="badge medium">${t.mode}</span>
          ${t.is_new ? '<span class="new-record-pill">✨ NEW ENTRY</span>' : ''}
        </div>
        <span class="tx-amount">${money(t.amount_inr)}</span>
      </div>
      <div class="tx-flow-row">
        <div class="tx-flow-party">
          <span class="tx-party-label">SOURCE ACCOUNT</span>
          <span class="tx-account">${t.from_account}</span>
          <span class="tx-party-owner">${t.from_suspect || "Unverified Mule"}</span>
        </div>
        <span class="tx-arrow">➔</span>
        <div class="tx-flow-party">
          <span class="tx-party-label">BENEFICIARY ACCOUNT</span>
          <span class="tx-account">${t.to_account}</span>
          <span class="tx-party-owner">${t.to_suspect || "Cash-Out Mule"}</span>
        </div>
      </div>
      <div style="font-size:12px; color:var(--text-muted); line-height:1.4;">
        Narration: <strong style="color:var(--text-main);">"${t.narration || "Layering credit"}"</strong>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-dim); border-top:1px solid var(--border-subtle); padding-top:8px;">
        <span>${t.timestamp ? t.timestamp.replace("T", " ") : "2024-10-15"}</span>
        <span>TX ID: ${t.id}</span>
      </div>
    `;

    card.addEventListener("click", () => inspectTransaction(t));
    container.appendChild(card);
  });
}

function inspectTransaction(t) {
  const html = `
    <div class="dossier-hero">
      <div class="dossier-avatar" style="border-color: var(--emerald); color: var(--emerald);">TXN</div>
      <div class="dossier-meta">
        <h3>${t.mode} Transfer (${t.id})</h3>
        <div class="tx-amount" style="font-size:24px; margin-top:4px;">${money(t.amount_inr)}</div>
      </div>
    </div>
    <dl class="kv-table">
      <dt>Source Account</dt><dd style="font-family: var(--font-mono); color:var(--cyan);">${t.from_account} (${t.from_suspect || "Unknown"})</dd>
      <dt>Destination</dt><dd style="font-family: var(--font-mono); color:var(--cyan);">${t.to_account} (${t.to_suspect || "Unknown"})</dd>
      <dt>Transfer Mode</dt><dd>${t.mode}</dd>
      <dt>Timestamp</dt><dd style="font-family: var(--font-mono);">${t.timestamp}</dd>
      <dt>Bank Narration</dt><dd>"${t.narration}"</dd>
    </dl>
  `;
  openDrawer(`Financial Trace: ${t.id}`, html);
}

// =========================================================================
// =========================================================================
// 9B. PAGE 6: OFFICER DATA ENTRY PORTAL
// =========================================================================
let dataEntryInitialized = false;

function switchEntryCategory(category) {
  const hiddenInput = $("entry-record-type");
  if (hiddenInput) hiddenInput.value = category;

  // Toggle category cards
  document.querySelectorAll("#entry-category-pills .category-card, #entry-category-pills .category-pill").forEach((card) => {
    const isTarget = card.dataset.category === category;
    card.classList.toggle("active", isTarget);
    const badge = card.querySelector(".cat-badge");
    if (badge) {
      badge.textContent = isTarget ? "ACTIVE" : "SELECT";
    }
  });

  // Toggle dynamic fieldsets
  document.querySelectorAll(".entry-dynamic-fieldset").forEach((fs) => {
    fs.classList.toggle("active", fs.id === `entry-fields-${category}`);
  });

  // Category specific titles, icons, and IDs
  const meta = {
    suspects: {
      icon: "👤",
      heading: "REGISTER SUSPECT DOSSIER",
      subtext: "Register an accused kingpin, lieutenant, mule account holder, or operative.",
      idPrefix: `AUTO S${String((state.suspects || []).length + 1).padStart(3, "0")}`,
      btnLabel: "Register Suspect & Add to Profiles ➔",
      firstInputId: "entry-suspect-name",
    },
    firs: {
      icon: "📁",
      heading: "REGISTER FORMAL POLICE FIR",
      subtext: "File formal First Information Report under IPC/BNS with crime loss valuation.",
      idPrefix: `AUTO FIR-2026-DL-${(state.firs || []).length + 1000}`,
      btnLabel: "Register FIR & Add to Crime Records ➔",
      firstInputId: "entry-fir-station",
    },
    vehicles: {
      icon: "🚘",
      heading: "REGISTER TRACKED GETAWAY VEHICLE",
      subtext: "Log vehicle registration plate, model, ANPR camera sightings, and owner.",
      idPrefix: `AUTO V${String((state.vehicles || []).length + 1).padStart(3, "0")}`,
      btnLabel: "Register Vehicle & Add to Radar Fleet ➔",
      firstInputId: "entry-vehicle-plate",
    },
    transactions: {
      icon: "💸",
      heading: "REGISTER ILLICIT FINANCIAL TRAIL",
      subtext: "Log hawala transactions, shell account money tranches, and mule transfers.",
      idPrefix: `AUTO TX-${Date.now().toString().slice(-4)}`,
      btnLabel: "Record Transaction & Add to Ledger ➔",
      firstInputId: "entry-tx-from",
    },
  };

  const info = meta[category] || meta.suspects;
  if ($("entry-category-icon")) $("entry-category-icon").textContent = info.icon;
  if ($("entry-category-heading")) $("entry-category-heading").textContent = info.heading;
  if ($("entry-category-subtext")) $("entry-category-subtext").textContent = info.subtext;
  if ($("entry-id-preview-val")) $("entry-id-preview-val").textContent = info.idPrefix;
  if ($("btn-entry-submit-label")) $("btn-entry-submit-label").textContent = info.btnLabel;

  const banner = $("entry-alert-banner");
  if (banner) banner.style.display = "none";

  setTimeout(() => {
    const input = $(info.firstInputId);
    if (input) input.focus();
  }, 60);
}

function updateEntryPageCounters() {
  if ($("stat-suspects-count")) $("stat-suspects-count").textContent = (state.suspects || []).length;
  if ($("stat-firs-count")) $("stat-firs-count").textContent = (state.firs || []).length;
  if ($("stat-vehicles-count")) $("stat-vehicles-count").textContent = (state.vehicles || []).length;
  if ($("stat-tx-count")) $("stat-tx-count").textContent = (state.transactions || []).length;
  if ($("entry-officer-name")) $("entry-officer-name").textContent = state.officer.name || "INSP. VIKRAM SHARMA";
}

function initDataEntryPage() {
  updateEntryPageCounters();

  if (dataEntryInitialized) return;
  dataEntryInitialized = true;

  // Category toggle cards & pills
  const selectorCards = document.querySelectorAll("#entry-category-pills .category-card, #entry-category-pills .category-pill");
  selectorCards.forEach((card) => {
    card.addEventListener("click", () => {
      const category = card.dataset.category;
      if (category) switchEntryCategory(category);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const category = card.dataset.category;
        if (category) switchEntryCategory(category);
      }
    });
  });

  // Reset button
  const resetBtn = $("btn-entry-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      $("officer-entry-form").reset();
      const currentCat = $("entry-record-type").value || "suspects";
      switchEntryCategory(currentCat);
      const banner = $("entry-alert-banner");
      if (banner) banner.style.display = "none";
    });
  }

  // Form submit handler
  const form = $("officer-entry-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = $("btn-entry-submit");
      const submitLabel = $("btn-entry-submit-label");
      const originalLabel = submitLabel ? submitLabel.textContent : "Submit";
      const banner = $("entry-alert-banner");

      const category = $("entry-record-type").value || "suspects";
      let payload = {};

      // Robust Category-specific field validation
      if (category === "suspects") {
        const name = $("entry-suspect-name").value.trim();
        if (!name) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Missing Required Field:</strong> Please enter the suspect's full legal name.</div>";
          $("entry-suspect-name").focus();
          return;
        }
        payload = {
          name: name,
          alias: $("entry-suspect-alias").value.trim(),
          role: $("entry-suspect-role").value.trim() || "Syndicate Operative",
          city: $("entry-suspect-city").value.trim() || "New Delhi",
          phone: $("entry-suspect-phone").value.trim() || "",
          status: $("entry-suspect-status").value || "Wanted",
          risk: $("entry-suspect-risk").value || "high",
          notes: $("entry-suspect-notes").value.trim() || "Confidential intelligence dossier.",
          known_associates: ["S001"],
          vehicle_ids: [],
          fir_ids: [],
          accounts: [],
        };
      } else if (category === "firs") {
        const firTitle = $("entry-fir-title").value.trim();
        const firStation = $("entry-fir-station").value.trim();
        if (!firTitle) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Missing Required Field:</strong> Please enter the primary offense or case title.</div>";
          $("entry-fir-title").focus();
          return;
        }
        if (!firStation) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Missing Required Field:</strong> Please specify the investigating police station.</div>";
          $("entry-fir-station").focus();
          return;
        }
        const firId = $("entry-fir-id").value.trim();
        const rawSections = $("entry-fir-sections").value.trim();
        const accusedStr = $("entry-fir-accused").value.trim();
        const summaryText = $("entry-fir-summary") ? $("entry-fir-summary").value.trim() : "";

        payload = {
          ...(firId ? { id: firId } : {}),
          title: firTitle,
          offense: firTitle, // Required by FIR renderer
          police_station: firStation,
          district: "National Capital Region",
          sections: rawSections ? rawSections.split(",").map((s) => s.trim()).filter(Boolean) : ["120B IPC", "392 IPC"],
          status: $("entry-fir-status").value || "Under investigation",
          loss_estimate_inr: Number($("entry-fir-loss").value || 0),
          recovered_amount_inr: Number($("entry-fir-recovered").value || 0),
          accused: accusedStr || "Unknown Accused",
          accused_ids: accusedStr ? accusedStr.split(",").map((s) => s.trim()).filter(Boolean) : ["S001"],
          summary: summaryText || `Official FIR registered at ${firStation} under section ${rawSections || 'IPC'}.`,
          date: new Date().toISOString().split("T")[0],
          location: firStation,
        };
      } else if (category === "vehicles") {
        const plate = $("entry-vehicle-plate").value.trim();
        const model = $("entry-vehicle-model").value.trim();
        if (!plate) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Missing Required Field:</strong> Please enter the vehicle registration plate number.</div>";
          $("entry-vehicle-plate").focus();
          return;
        }
        payload = {
          registration: plate,
          plate: plate,
          make: model ? model.split(" ")[0] : "Fleet",
          model: model || "Getaway Vehicle",
          color: $("entry-vehicle-color").value.trim() || "Black",
          status: $("entry-vehicle-status").value || "Under surveillance",
          state: $("entry-vehicle-state").value.trim() || "Delhi-NCR",
          last_seen_location: $("entry-vehicle-location").value.trim() || "Delhi-NCR",
          last_seen: new Date().toISOString(),
          owner_id: $("entry-vehicle-suspect").value.trim() || "S001",
          suspect: $("entry-vehicle-suspect").value.trim() || "S001",
          notes: `Tracked by SIT radar surveillance. Associated with ${$("entry-vehicle-suspect").value.trim() || "active investigation"}.`,
        };
      } else if (category === "transactions") {
        const fromAcc = $("entry-tx-from").value.trim();
        const toAcc = $("entry-tx-to").value.trim();
        const amount = Number($("entry-tx-amount").value || 0);
        if (!fromAcc || !toAcc) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Missing Required Field:</strong> Please provide both source and beneficiary accounts.</div>";
          if (!fromAcc) $("entry-tx-from").focus(); else $("entry-tx-to").focus();
          return;
        }
        if (!amount || amount <= 0) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = "<span>⚠️</span> <div><strong>Invalid Amount:</strong> Please enter a valid transfer amount greater than ₹0.</div>";
          $("entry-tx-amount").focus();
          return;
        }
        const mode = $("entry-tx-mode").value || "UPI";
        payload = {
          from_account: fromAcc,
          to_account: toAcc,
          amount_inr: amount,
          mode: mode,
          channel: mode === "Hawala Cash" ? "hawala" : "bank",
          from_suspect: $("entry-tx-sender").value.trim() || "Unverified Mule",
          to_suspect: $("entry-tx-receiver").value.trim() || "Cash-out Mule",
          narration: $("entry-tx-narration").value.trim() || "Layering credit",
          timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
          fir_ids: [],
        };
      }

      try {
        submitBtn.disabled = true;
        if (submitLabel) submitLabel.textContent = "Registering in Central Database...";

        const res = await api("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: category, data: payload }),
        });

        // Instant dynamic sync across all components
        await syncData(true);

        const createdRecord = res.record || payload;
        const createdId = createdRecord.id || "REC-" + Date.now();

        // Mark the newly added record as new in local state and place it at the beginning
        if (state[category] && Array.isArray(state[category])) {
          const idx = state[category].findIndex((item) => item.id === createdId);
          if (idx !== -1) {
            state[category][idx].is_new = true;
            const [item] = state[category].splice(idx, 1);
            state[category].unshift(item);
          } else {
            createdRecord.is_new = true;
            state[category].unshift(createdRecord);
          }
        }

        updateKpis();
        updateEntryPageCounters();

        const catTitles = {
          suspects: "Suspect Profiles",
          firs: "FIR Case Files",
          vehicles: "Vehicles & Logs",
          transactions: "Financial Transactions",
        };
        const pageTitle = catTitles[category] || category.toUpperCase();

        // Show prominent success alert
        if (banner) {
          banner.className = "entry-alert-banner success";
          banner.style.display = "flex";
          banner.innerHTML = `
            <span>✅</span>
            <div style="flex:1;">
              <strong>Record Registered Successfully!</strong> Reference ID: <code>${createdId}</code> registered under <em>${pageTitle}</em>.
              <div style="margin-top:6px; font-size:12px; color:var(--text-dim);">
                🚀 Redirecting to <strong>${pageTitle}</strong> page so you can review your new entry at the top...
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-accent" style="white-space:nowrap;" onclick="switchDashboardPage('${category}')">
              View Now ➔
            </button>
          `;
        }

        // Add to session audit log
        const logsContainer = $("session-logs-list");
        if (logsContainer) {
          const empty = logsContainer.querySelector(".session-log-empty");
          if (empty) empty.remove();

          const logItem = document.createElement("div");
          logItem.className = "session-log-item";
          const titleText = payload.name || payload.title || payload.plate || `${money(payload.amount_inr)} (${payload.mode})`;
          logItem.innerHTML = `
            <div class="session-log-top">
              <span class="badge ${category === 'suspects' ? 'danger' : 'medium'}">${category.toUpperCase()}</span>
              <span style="font-family:var(--font-mono); font-size:10px; color:var(--text-dim);">${new Date().toLocaleTimeString()}</span>
            </div>
            <div style="font-weight:700; color:#fff; margin-top:2px;">${titleText}</div>
            <div style="font-size:10.5px; color:var(--text-muted); font-family:var(--font-mono);">ID: ${createdId} • By: ${state.officer.name || 'INSP. V. SHARMA'}</div>
          `;
          logsContainer.prepend(logItem);
        }

        form.reset();

        // Automatically redirect officer to that category's page after 1.2s!
        setTimeout(() => {
          switchDashboardPage(category);
        }, 1200);

      } catch (err) {
        if (banner) {
          banner.className = "entry-alert-banner error";
          banner.style.display = "flex";
          banner.innerHTML = `<span>❌</span> <div><strong>Submission Error:</strong> ${err.message}</div>`;
        }
      } finally {
        submitBtn.disabled = false;
        if (submitLabel) submitLabel.textContent = originalLabel;
        switchEntryCategory(category);
      }
    });
  }
}

window.switchEntryCategory = switchEntryCategory;

// =========================================================================
// 10. DASHBOARD D3 GRAPH
// =========================================================================
async function loadDashboardGraph() {
  state.graphData = await api("/api/graph");
  const container = $("graph-container");
  container.innerHTML = "";

  const w = container.clientWidth || 600;
  const h = 480;

  const svg = d3.select(container).append("svg").attr("width", w).attr("height", h);
  state.d3.svg = svg;

  const g = svg.append("g").attr("class", "graph-root");
  state.d3.g = g;

  const zoom = d3.zoom().scaleExtent([0.3, 3]).on("zoom", (e) => g.attr("transform", e.transform));
  svg.call(zoom);

  const nodes = state.graphData.nodes.map((d) => ({ ...d }));
  const links = state.graphData.edges.map((d) => ({ ...d }));

  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(90))
    .force("charge", d3.forceManyBody().strength(-300))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collision", d3.forceCollide().radius(26));

  const link = g
    .append("g")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke", (d) => (d.kind === "call" ? "#06b6d4" : d.kind === "transaction" ? "#10b981" : "#334155"))
    .attr("stroke-width", 1.8)
    .attr("opacity", 0.8);

  const node = g
    .append("g")
    .selectAll("g")
    .data(nodes)
    .enter()
    .append("g")
    .attr("cursor", "pointer")
    .call(
      d3
        .drag()
        .on("start", (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on("end", (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  node
    .append("circle")
    .attr("r", 15)
    .attr("fill", (d) => (d.kind === "suspect" ? "#f59e0b" : d.kind === "fir" ? "#ef4444" : "#3b82f6"))
    .attr("stroke", "#070a0f")
    .attr("stroke-width", 2);

  node
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dy", ".35em")
    .attr("fill", "#000")
    .attr("font-size", "10px")
    .attr("font-weight", "800")
    .text((d) => (d.kind === "suspect" ? d.label.charAt(0) : d.kind === "fir" ? "!" : "V"));

  node
    .append("text")
    .attr("x", 18)
    .attr("y", 4)
    .attr("fill", "#cbd5e1")
    .attr("font-size", "11px")
    .text((d) => d.label);

  node.on("click", (e, d) => {
    e.stopPropagation();
    if (d.kind === "suspect") inspectSuspect(d.id);
  });

  simulation.on("tick", () => {
    link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });
}

// =========================================================================
// 11. DASHBOARD LEAFLET MAP
// =========================================================================
async function initDashboardMap() {
  if (state.map) {
    state.map.invalidateSize();
    return;
  }
  // Default Pan-India Map View
  const map = L.map("gis-map").setView([22.5937, 78.9629], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors | Ministry of Home Affairs Special Operations",
  }).addTo(map);

  state.map = map;

  state.geoMarkers.forEach((m) => {
    const labelChar =
      m.kind === "suspect"
        ? "👤"
        : m.kind === "fir"
        ? "🚨"
        : m.kind === "tower"
        ? "📡"
        : m.kind === "hub"
        ? "🏛️"
        : "🚘";

    const customIcon = L.divIcon({
      className: `custom-pin pin-${m.kind}`,
      html: labelChar,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const marker = L.marker([m.lat, m.lng], { icon: customIcon }).addTo(map);
    marker.bindPopup(`
      <div style="font-family: Outfit, sans-serif; font-size: 12px; color:#000;">
        <strong>${m.label}</strong>
        <p style="margin: 4px 0;">${m.detail}</p>
        <span style="font-size: 10px; background: #222; color: #fff; padding: 2px 6px; border-radius: 4px;">${m.status || m.kind}</span>
      </div>
    `);

    marker.on("click", () => {
      if (m.kind === "suspect") inspectSuspect(m.id);
    });
  });
}

// =========================================================================
// 12. EVENT LISTENERS & AUTH SETUP
// =========================================================================
function setupEvents() {
  // Navigation between Views (Landing, Login, Dashboard)
  $("btn-goto-login").addEventListener("click", () => showView("login"));
  $("btn-hero-login").addEventListener("click", () => showView("login"));
  $("btn-back-to-landing").addEventListener("click", () => showView("landing"));

  // 1-Click Demo Login Bypass
  $("btn-demo-login").addEventListener("click", () => {
    state.officer = {
      name: "INSP. VIKRAM SHARMA",
      badge: "DL-SP-4412",
      unit: "Special Cell New Delhi",
    };
    showView("app");
  });

  // Regular Login Form Submit
  $("officer-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const badge = $("login-badge").value.trim() || "DL-SP-4412";
    const station = $("login-station").value;
    state.officer = {
      name: `OFFICER (${badge})`,
      badge: badge,
      unit: station,
    };
    showView("app");
  });

  // Logout button
  $("btn-logout").addEventListener("click", () => {
    if (confirm("Are you sure you want to end your confidential intelligence session?")) {
      showView("landing");
    }
  });

  // Navigation tabs inside the Dashboard
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => switchDashboardPage(btn.dataset.page));
  });

  // Drawer close
  $("btn-close-drawer").addEventListener("click", closeDrawer);
  $("drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });

  // Print drawer
  $("btn-print-drawer").addEventListener("click", () => window.print());

  // Suspects page filters & search
  document.querySelectorAll("#suspects-filter-chips .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#suspects-filter-chips .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeSuspectFilter = chip.dataset.filter;
      renderSuspectsPage();
    });
  });
  $("search-suspects-input").addEventListener("input", renderSuspectsPage);

  // FIRs page filters & search
  document.querySelectorAll("#firs-filter-chips .filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#firs-filter-chips .filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeFirFilter = chip.dataset.filter;
      renderFirsPage();
    });
  });
  $("search-firs-input").addEventListener("input", renderFirsPage);

  // Zonal Nav Pills on Map
  document.querySelectorAll(".city-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.map) return;
      document.querySelectorAll(".city-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const city = btn.dataset.city;
      if (city === "all") state.map.flyTo([22.5937, 78.9629], 5);
      else if (city === "north") state.map.flyTo([28.6139, 77.2090], 7);
      else if (city === "west") state.map.flyTo([21.1702, 72.8311], 7);
      else if (city === "south") state.map.flyTo([13.0827, 78.2707], 6);
      else if (city === "east") state.map.flyTo([24.5, 87.5], 6);
    });
  });

  // Graph reset
  $("btn-reset-graph").addEventListener("click", () => loadDashboardGraph());

  // Window resize handler
  window.addEventListener("resize", () => {
    if (state.currentView === "app" && state.activeDashboardPage === "dashboard") {
      loadDashboardGraph();
      if (state.map) state.map.invalidateSize();
    }
  });

  // Direct Data Entry Button & Modal Handlers
  const modal = $("new-record-modal");
  const btnAddRecord = $("btn-add-record");
  if (btnAddRecord) {
    btnAddRecord.addEventListener("click", () => {
      if (state.currentView !== "app") {
        showView("app");
      }
      switchDashboardPage("entry");
      const entryCard = $("entry-card-main");
      if (entryCard) {
        entryCard.scrollIntoView({ behavior: "smooth", block: "start" });
        entryCard.classList.add("highlight-pulse");
        setTimeout(() => entryCard.classList.remove("highlight-pulse"), 2500);
      }
      const firstInput = $("entry-suspect-name");
      if (firstInput) setTimeout(() => firstInput.focus(), 150);
    });
  }

  // Initialize Data Entry Page immediately
  initDataEntryPage();

  if ($("btn-close-modal")) $("btn-close-modal").addEventListener("click", () => modal && modal.close());
  if ($("btn-cancel-modal")) $("btn-cancel-modal").addEventListener("click", () => modal && modal.close());

  const addRecordForm = $("add-record-form");
  if (addRecordForm) {
    addRecordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const recordType = form.type.value;

      const payload = {
        name: form.name.value.trim(),
        alias: form.alias.value.trim(),
        role: form.role.value.trim(),
        phone: form.phone.value.trim(),
        city: form.city.value.trim(),
        status: form.status.value,
        risk: form.risk.value,
        notes: form.notes.value.trim(),
        known_associates: ["S001"],
        vehicle_ids: [],
        fir_ids: [],
      };

      try {
        await api("/api/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: recordType, data: payload }),
        });
        if (modal) modal.close();
        form.reset();
        await syncData(true);
        switchDashboardPage(recordType);
      } catch (err) {
        alert("Error saving record: " + err.message);
      }
    });
  }
}

// =========================================================================
// 12. DYNAMIC REAL-TIME DATA SYNCHRONIZATION
// =========================================================================
async function syncData(force = false) {
  try {
    const ov = await api("/api/overview");
    const mtimeChanged = state.lastDataMtime !== null && ov.data_mtime && ov.data_mtime !== state.lastDataMtime;
    const countChanged = (
      ov.suspects !== state.suspects.length ||
      ov.firs !== state.firs.length ||
      ov.vehicles !== state.vehicles.length ||
      ov.transactions !== state.transactions.length
    );

    if (force || state.lastDataMtime === null || mtimeChanged || countChanged) {
      state.lastDataMtime = ov.data_mtime || state.lastDataMtime;
      await loadAllData();
      updateKpis();

      // Refresh currently viewed page smoothly
      if (state.activeDashboardPage === "suspects") {
        renderSuspectsPage();
      } else if (state.activeDashboardPage === "firs") {
        renderFirsPage();
      } else if (state.activeDashboardPage === "vehicles") {
        renderVehiclesPage();
      } else if (state.activeDashboardPage === "transactions") {
        renderTransactionsPage();
      }
    }
  } catch (err) {
    console.warn("[LinkTrace Sync] Background sync check:", err.message);
  }
}

// Expose navigation and view helpers to window
window.inspectSuspect = inspectSuspect;
window.switchDashboardPage = switchDashboardPage;
window.syncData = syncData;

// =========================================================================
// 13. BOOTSTRAP
// =========================================================================
async function boot() {
  setupEvents();
  initCopilot();
  await loadAllData();
  state.lastDataMtime = (state.overview && state.overview.data_mtime) || null;
  showView("landing");

  // Dynamic real-time sync polling every 5 seconds & on window focus
  setInterval(() => syncData(false), 5000);
  window.addEventListener("focus", () => syncData(false));
}

boot().catch((err) => {
  console.error("Boot error:", err);
});
