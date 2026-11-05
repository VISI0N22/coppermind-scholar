// ==================== CONFIGURATION ====================
const GEMINI_API_KEY = 'AQ.Ab8RN6Kqq4vOvZ2BmauLHBK-EkPAkBMKVItnkJkyeWmqWb7cIg';
const GEMINI_ENDPOINT_FLASH = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
const GEMINI_ENDPOINT_FALLBACK = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const COPPERMIND_API = 'https://coppermind.net/w/api.php';
const COPPERMIND_WIKI_BASE = 'https://coppermind.net/wiki/';
const ARCANUM_API_ENTRY = 'https://wob.coppermind.net/api/entry/';
const ARCANUM_BASE = 'https://wob.coppermind.net/';

// ==================== STATE ====================
const State = {
    mode: 'scholar', // 'scholar' (strictly grounded) or 'normal' (standard chatbot)
    cache: new Map(),
    context: {
        lastEntity: null,
        history: [] // Formatted conversation history
    },
    
    get(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.time < 1000 * 60 * 30) return item.data;
        return null;
    },
    
    set(key, data) {
        this.cache.set(key, { data, time: Date.now() });
        if (this.cache.size > 200) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
    }
};

// ==================== UI ELEMENTS ====================
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const typingIndicator = document.getElementById('typingIndicator');
const statusText = document.getElementById('statusText');
const chatDisclaimer = document.getElementById('chatDisclaimer');
const modeLabelScholar = document.getElementById('modeLabelScholar');
const modeLabelNormal = document.getElementById('modeLabelNormal');

// Initialize labels
updateModeUI();

chatInput.addEventListener('keypress', e => { 
    if (e.key === 'Enter') sendMessage(); 
});

function toggleMode(isNormal) {
    State.mode = isNormal ? 'normal' : 'scholar';
    updateModeUI();
}

function updateModeUI() {
    if (State.mode === 'scholar') {
        modeLabelScholar.classList.add('active');
        modeLabelNormal.classList.remove('active');
        statusText.textContent = "Scholar Mode (Coppermind + Arcanum Grounded)";
        chatDisclaimer.textContent = "Grounding mode: AI summarizes strictly from live Coppermind & Arcanum archives without outside extrapolation.";
    } else {
        modeLabelNormal.classList.add('active');
        modeLabelScholar.classList.remove('active');
        statusText.textContent = "AI Chatbot Mode (General Cosmere Dialogue)";
        chatDisclaimer.textContent = "Standard conversational AI mode powered by Gemini.";
    }
}

function askSuggestion(text) { 
    chatInput.value = text; 
    sendMessage(); 
}

function startNewChat() {
    State.context = { lastEntity: null, history: [] };
    chatMessages.innerHTML = `
        <div class="message bot-message">
            <div class="avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>
            </div>
            <div class="message-content">
                <p>Greetings, traveler. I am the Coppermind Scholar. Ask me anything about Brandon Sanderson's Cosmere.</p>
                <span class="timestamp">Now</span>
            </div>
        </div>
    `;
    chatInput.focus();
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    addMessage(text, 'user');
    chatInput.value = '';
    chatInput.disabled = true;
    sendBtn.disabled = true;
    showTyping();
    
    try {
        let answer;
        if (State.mode === 'scholar') {
            answer = await ScholarEngine.processScholarQuery(text);
        } else {
            answer = await ScholarEngine.processNormalChat(text);
        }
        
        hideTyping();
        addMessage(answer.html, 'bot', answer.meta);
        
        // Save to conversational context
        State.context.history.push({ role: 'user', content: text });
        State.context.history.push({ role: 'assistant', content: answer.rawText || answer.html });
        if (State.context.history.length > 20) State.context.history.splice(0, 2);
        
    } catch (err) {
        console.error('Error generating response:', err);
        hideTyping();
        addMessage("The perpendicularity is unstable — could not retrieve archive records. Please try again.", 'bot');
    }
    
    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

function addMessage(htmlContent, sender, meta = null) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let metaHtml = '';
    if (meta && (meta.coppermindSources?.length || meta.arcanumSources?.length)) {
        metaHtml += `<div class="message-sources"><span class="sources-title">Sources:</span>`;
        
        if (meta.coppermindSources?.length) {
            meta.coppermindSources.forEach(title => {
                const url = `${COPPERMIND_WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}`;
                metaHtml += `<a class="citation" href="${url}" target="_blank" rel="noopener">Wiki: ${escapeHtml(title)}</a>`;
            });
        }
        
        if (meta.arcanumSources?.length) {
            meta.arcanumSources.forEach(wob => {
                const url = wob.url || `${ARCANUM_BASE}events/${wob.event_id}/#e${wob.id}`;
                const label = wob.id ? `WoB #${wob.id}` : `Arcanum`;
                metaHtml += `<a class="citation arcanum-tag" href="${url}" target="_blank" rel="noopener" title="${escapeHtml(wob.event_name || 'Words of Brandon')}">${escapeHtml(label)}</a>`;
            });
        }
        
        metaHtml += `</div>`;
    }
    
    div.innerHTML = `
        <div class="avatar">${sender === 'bot' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' : ''}</div>
        <div class="message-content">
            <div class="message-text">${htmlContent}</div>
            ${metaHtml}
            <span class="timestamp">${time}</span>
        </div>
    `;
    
    chatMessages.appendChild(div);
    scrollToBottom();
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }
function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ==================== ARCHIVE RETRIEVAL (COPPERMIND & ARCANUM) ====================
const ArchiveService = {
    // 1. Search Coppermind Articles
    async searchCoppermind(query, limit = 4) {
        const cacheKey = `cm:search:${query}`;
        const cached = State.get(cacheKey);
        if (cached) return cached;
        
        try {
            const params = new URLSearchParams({
                action: 'query',
                list: 'search',
                srsearch: query,
                srlimit: limit,
                format: 'json',
                origin: '*'
            });
            const res = await fetch(`${COPPERMIND_API}?${params}`);
            if (!res.ok) return [];
            const data = await res.json();
            const results = (data.query?.search || []).map(r => r.title);
            State.set(cacheKey, results);
            return results;
        } catch (e) {
            console.warn('Coppermind search error:', e);
            return [];
        }
    },
    
    // 2. Fetch full extracts & info from Coppermind
    async getCoppermindPage(title) {
        const cacheKey = `cm:page:${title}`;
        const cached = State.get(cacheKey);
        if (cached) return cached;
        
        try {
            const params = new URLSearchParams({
                action: 'query',
                prop: 'extracts|categories',
                titles: title,
                exchars: 5000,
                explaintext: 'true',
                exlimit: '1',
                cllimit: '20',
                format: 'json',
                origin: '*'
            });
            const res = await fetch(`${COPPERMIND_API}?${params}`);
            if (!res.ok) return null;
            const data = await res.json();
            const pages = data.query?.pages || {};
            const page = Object.values(pages)[0];
            
            if (!page || page.missing !== undefined) return null;
            
            const result = {
                title: page.title,
                extract: page.extract || '',
                categories: (page.categories || []).map(c => c.title.replace('Category:', ''))
            };
            State.set(cacheKey, result);
            return result;
        } catch (e) {
            console.warn(`Error getting page for ${title}:`, e);
            return null;
        }
    },
    
    // 3. Search Arcanum (Words of Brandon)
    async searchArcanum(query, limit = 4) {
        const cacheKey = `arcanum:${query}`;
        const cached = State.get(cacheKey);
        if (cached) return cached;
        
        try {
            // Query Arcanum API endpoint
            const url = `${ARCANUM_API_ENTRY}?query=${encodeURIComponent(query)}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return [];
            
            const data = await res.json();
            const results = (data.results || []).slice(0, limit).map(entry => {
                // Extract question and answer lines
                const lines = (entry.lines || []).map(l => `${l.speaker || 'Questioner'}: ${l.text}`).join('\n');
                return {
                    id: entry.id,
                    event_id: entry.event?.id || entry.event_id,
                    event_name: entry.event?.name || 'Arcanum Archive',
                    date: entry.event?.date || '',
                    text: lines || entry.text || '',
                    url: `${ARCANUM_BASE}events/${entry.event?.id || entry.event_id || 1}/#e${entry.id}`
                };
            });
            
            State.set(cacheKey, results);
            return results;
        } catch (e) {
            // Note: Arcanum may block direct CORS depending on origin; fails gracefully if unreachable
            console.warn('Arcanum search note (CORS / Network):', e);
            return [];
        }
    }
};

// ==================== GEMINI API INTEGRATION ====================
const GeminiService = {
    async callGemini(contents, systemInstruction) {
        const payload = {
            contents,
            generationConfig: {
                temperature: 0.15, // Low temperature for high factual accuracy
                maxOutputTokens: 1200,
                topP: 0.8
            }
        };
        
        if (systemInstruction) {
            payload.systemInstruction = {
                parts: [{ text: systemInstruction }]
            };
        }
        
        // Attempt 1: Gemini 2.5 Flash
        try {
            const res = await fetch(GEMINI_ENDPOINT_FLASH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (res.ok) {
                const data = await res.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                console.warn(`Gemini 2.5 flash returned status ${res.status}. Falling back to 1.5 flash.`);
            }
        } catch (e) {
            console.warn('Gemini 2.5 call failed, attempting fallback...', e);
        }
        
        // Attempt 2: Gemini 1.5 Flash Fallback
        const fallbackRes = await fetch(GEMINI_ENDPOINT_FALLBACK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!fallbackRes.ok) {
            const errText = await fallbackRes.text();
            throw new Error(`Gemini API Error (${fallbackRes.status}): ${errText}`);
        }
        
        const fallbackData = await fallbackRes.json();
        return fallbackData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
};

// ==================== SCHOLAR ORCHESTRATION ENGINE ====================
const ScholarEngine = {
    // SCHOLAR MODE: Grounded strictly in Coppermind + Arcanum
    async processScholarQuery(query) {
        // Step 1: Search Coppermind for matching titles
        const titles = await ArchiveService.searchCoppermind(query, 3);
        
        // Step 2: Fetch articles content
        const articles = [];
        for (const title of titles) {
            const page = await ArchiveService.getCoppermindPage(title);
            if (page && page.extract && page.extract.length > 50) {
                articles.push(page);
            }
        }
        
        // Step 3: Search Arcanum for Words of Brandon (WoB)
        const wobs = await ArchiveService.searchArcanum(query, 3);
        
        // If neither Coppermind nor Arcanum yielded results, inform user directly without hallucinating
        if (articles.length === 0 && wobs.length === 0) {
            return {
                html: `<p>I searched the archives of the <strong>Coppermind Wiki</strong> and <strong>Arcanum</strong>, but found no recorded entries regarding "<strong>${escapeHtml(query)}</strong>".</p><p>Please verify the spelling or try searching for the subject's common book alias.</p>`,
                meta: { coppermindSources: [], arcanumSources: [] }
            };
        }
        
        // Format retrieved archive context
        let contextText = `=== COPPERMIND WIKI ARCHIVES ===\n`;
        articles.forEach(a => {
            contextText += `\n[Article: ${a.title}]\n${a.extract}\n`;
        });
        
        if (wobs.length > 0) {
            contextText += `\n=== ARCANUM ARCHIVES (WORDS OF BRANDON) ===\n`;
            wobs.forEach(w => {
                contextText += `\n[WoB Entry #${w.id} (${w.event_name}, ${w.date})]:\n${w.text}\n`;
            });
        }
        
        const systemPrompt = `You are the Coppermind Scholar, a factual archivist of Brandon Sanderson's Cosmere.
CRITICAL CONSTRAINT: You must ground your answer STRICTLY and ONLY on the provided archive context below. 
- Rely very little on outside/prior memory. Do NOT fabricate or assume lore that is not corroborated in the text.
- If the provided texts do not mention an aspect or answer the question, clearly state: "The retrieved Coppermind and Arcanum archives do not contain information regarding [aspect]."
- Summarize clearly, accurately, and concisely.
- Cite your sources in the text (e.g., "According to the Coppermind article on [Subject]..." or "In a Word of Brandon (WoB #${wobs[0]?.id || '...'})").
- Format your response with clear paragraphs, bold text, and bullet points where helpful.`;

        const userPrompt = `User Query: "${query}"\n\nArchive Context:\n${contextText}`;
        
        const rawAiResponse = await GeminiService.callGemini([
            { role: 'user', parts: [{ text: userPrompt }] }
        ], systemPrompt);
        
        return {
            html: formatMarkdown(rawAiResponse),
            rawText: rawAiResponse,
            meta: {
                coppermindSources: articles.map(a => a.title),
                arcanumSources: wobs
            }
        };
    },
    
    // NORMAL CHATBOT MODE: General conversational AI using full Gemini knowledge
    async processNormalChat(query) {
        const systemPrompt = `You are the Coppermind Scholar, a warm, knowledgeable scholar of Brandon Sanderson's Cosmere and fantasy literature.
You are in free conversational mode. You may answer questions using your broad knowledge about the Cosmere, Brandon Sanderson's novels, character arcs, theories, and general inquiries. Keep your tone articulate, immersive, and helpful.`;

        // Include short conversation history
        const contents = State.context.history.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));
        
        contents.push({
            role: 'user',
            parts: [{ text: query }]
        });
        
        const rawAiResponse = await GeminiService.callGemini(contents, systemPrompt);
        
        return {
            html: formatMarkdown(rawAiResponse),
            rawText: rawAiResponse,
            meta: { coppermindSources: [], arcanumSources: [] }
        };
    }
};

// ==================== UTILITIES & FORMATTING ====================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Lightweight Markdown to HTML formatter
function formatMarkdown(text) {
    if (!text) return '';
    
    let html = escapeHtml(text);
    
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Italics: *text* or _text_
    html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
    
    // Lists: lines starting with * or -
    const lines = html.split('\n');
    let inList = false;
    let result = '';
    
    for (let line of lines) {
        const trimmed = line.trim();
        if (/^[-*]\s+/.test(trimmed)) {
            if (!inList) {
                result += '<ul>';
                inList = true;
            }
            result += `<li>${trimmed.replace(/^[-*]\s+/, '')}</li>`;
        } else if (/^\d+\.\s+/.test(trimmed)) {
            if (!inList) {
                result += '<ol>';
                inList = true;
            }
            result += `<li>${trimmed.replace(/^\d+\.\s+/, '')}</li>`;
        } else {
            if (inList) {
                result += '</ul>';
                inList = false;
            }
            if (trimmed.length > 0) {
                result += `<p>${trimmed}</p>`;
            }
        }
    }
    
    if (inList) result += '</ul>';
    
    return result;
}
