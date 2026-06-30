const API_BASE = 'https://coppermind.net/w/api.php';
const WIKI_BASE = 'https://coppermind.net/wiki/';

let conversationHistory = [];
let currentContext = { lastEntity: null, lastTopic: null };

const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const typingIndicator = document.getElementById('typingIndicator');

chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

function askSuggestion(text) {
    chatInput.value = text;
    sendMessage();
}

function startNewChat() {
    conversationHistory = [];
    currentContext = { lastEntity: null, lastTopic: null };
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
                <p>Greetings, traveler. I am the Coppermind Scholar. Ask me about characters, magic systems, worlds, or events from Brandon Sanderson's Cosmere — I shall search the archives and reveal what I find.</p>
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
        const answer = await processQuestion(text);
        hideTyping();
        addMessage(answer.text, 'bot', answer.meta);
    } catch (err) {
        console.error(err);
        hideTyping();
        addMessage("The spren are being uncooperative — I cannot reach the Coppermind archives at the moment. Please try again shortly.", 'bot');
    }

    chatInput.disabled = false;
    sendBtn.disabled = false;
    chatInput.focus();
}

function addMessage(text, sender, meta = null) {
    const div = document.createElement('div');
    div.className = `message ${sender}-message`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let metaHtml = '';
    if (meta) {
        if (meta.sources && meta.sources.length > 0) {
            const links = meta.sources.map(s => 
                `<a class="citation" href="${WIKI_BASE}${encodeURIComponent(s.replace(/ /g, '_'))}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`
            ).join(' • ');
            metaHtml += `<div style="margin-top:10px; font-size: 0.8rem;">Sources: ${links}</div>`;
        }
        if (meta.confidence) {
            const color = meta.confidence === 'high' ? '#4ade80' : meta.confidence === 'medium' ? '#fbbf24' : '#f87171';
            metaHtml += `<span class="confidence" style="color: ${color};">Confidence: ${meta.confidence}</span>`;
        }
    }

    div.innerHTML = `
        <div class="avatar">
            ${sender === 'bot' ? 
                `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                </svg>` : ''
            }
        </div>
        <div class="message-content">
            <div class="message-text">${text}</div>
            ${metaHtml}
            <span class="timestamp">${time}</span>
        </div>
    `;
    
    chatMessages.appendChild(div);
    scrollToBottom();
    conversationHistory.push({ sender, text });
}

function showTyping() {
    typingIndicator.classList.remove('hidden');
    scrollToBottom();
}

function hideTyping() {
    typingIndicator.classList.add('hidden');
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==================== QUESTION PROCESSING ====================

async function processQuestion(query) {
    // Handle follow-ups
    let processedQuery = query;
    const isFollowUp = /^(what about|and|what|how about|tell me more|who else|where else|why|how|when|what is|who is|describe|is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\b/i.test(query) && currentContext.lastEntity;
    
    if (isFollowUp && !query.toLowerCase().includes(currentContext.lastEntity.toLowerCase())) {
        processedQuery = query + ' ' + currentContext.lastEntity;
    }

    // Detect what user wants
    const intent = detectIntent(query);
    let entity = extractEntity(processedQuery, intent);
    
    console.log('Intent:', intent.type, 'Entity:', entity);
    
    // Search Coppermind
    let searchResults = await searchCoppermind(entity || processedQuery);
    
    if (searchResults.length === 0 && entity) {
        // Try broader search
        searchResults = await searchCoppermind(entity.split(' ').slice(0, 2).join(' '));
    }
    
    if (searchResults.length === 0) {
        return {
            text: `<p>I searched the Coppermind but found no articles matching "<strong>${escapeHtml(entity || query)}</strong>".</p><p>Try using the exact name from the books (e.g., "Kaladin" instead of "Kal"), or ask about a general topic like "Surgebinding" or "Roshar".</p>`,
            meta: { confidence: 'low', sources: [] }
        };
    }

    // Fetch articles with MORE content
    const articles = await fetchArticles(searchResults.slice(0, 6).map(r => r.title));
    
    if (articles.length === 0 || !articles[0].extract || articles[0].extract.length < 50) {
        // Try fetching the top result individually with full text
        const fullArticle = await fetchFullArticle(searchResults[0].title);
        if (fullArticle && fullArticle.extract && fullArticle.extract.length > 50) {
            articles[0] = fullArticle;
        } else {
            return {
                text: `<p>I found an article for <strong>${escapeHtml(searchResults[0].title)}</strong>, but the Coppermind's API returned only a brief snippet. The full article likely contains the answer you seek.</p><p><a href="${WIKI_BASE}${encodeURIComponent(searchResults[0].title.replace(/ /g, '_'))}" target="_blank" style="color: #b87333;">Read the full article on Coppermind →</a></p>`,
                meta: { confidence: 'low', sources: [searchResults[0].title] }
            };
        }
    }

    // Update context
    currentContext.lastEntity = articles[0].title;
    currentContext.lastTopic = intent.type;

    // Generate answer based on intent
    const answer = generateAnswer(intent, articles, query);
    
    return answer;
}

function detectIntent(query) {
    const lower = query.toLowerCase().replace(/[?.,!]/g, '');
    
    // Birth/death/age
    if (/\b(born|birth|birthday|date of birth|when .* born|when .* die|died|death|dead|killed|slain|murdered|how old|age|years old)\b/.test(lower)) {
        if (/\b(die|died|death|dead|killed|slain|murdered)\b/.test(lower)) return { type: 'death', category: 'biographical' };
        if (/\b(how old|age|years old)\b/.test(lower)) return { type: 'age', category: 'biographical' };
        return { type: 'birth', category: 'biographical' };
    }
    
    // Appearance
    if (/\b(look like|appearance|describe .* look|looks like|hair|eyes|skin|face|tall|short|build|figure|handsome|beautiful|ugly|attractive)\b/.test(lower)) {
        return { type: 'appearance', category: 'biographical' };
    }
    
    // Family/relationships
    if (/\b(family|parents|father|mother|dad|mom|siblings|brother|sister|related|married|wife|husband|spouse|son|daughter|child|children|cousin|uncle|aunt|nephew|niece)\b/.test(lower)) {
        return { type: 'family', category: 'biographical' };
    }
    
    // Abilities/powers
    if (/\b(powers|abilities|skills|magic|allomancy|surgebinding|feruchemy|hemalurgy|awakening|aondor|forgery|sand mastery|investiture|shardblade|shardplate|spren|nahel|bond|radiant|mistborn|twinborn|compound|atium|lerasium|honorblade|surge|voidbinding|regal|stormform)\b/.test(lower)) {
        return { type: 'abilities', category: 'biographical' };
    }
    
    // Role/occupation
    if (/\b(job|work|occupation|profession|role|position|soldier|knight|captain|general|lord|lady|king|queen|emperor|merchant|scholar|thief|spy|assassin|surgeon|writer|singer|artifabrian|highprince|herald|champion|vessel)\b/.test(lower)) {
        return { type: 'role', category: 'biographical' };
    }
    
    // Origin/world
    if (/\b(from|planet|world|where .* from|homeworld|realm|location|place|city|nation|country|empire|kingdom)\b/.test(lower)) {
        return { type: 'origin', category: 'biographical' };
    }
    
    // Book appearances
    if (/\b(book|novel|appear|featured|first seen|introduced|debut|in which|which book|series|stormlight|mistborn|elantris|warbreaker|arcanum)\b/.test(lower)) {
        return { type: 'appearances', category: 'biographical' };
    }
    
    // Personality/character
    if (/\b(personality|character|like|nature|temperament|brave|coward|honest|kind|cruel|smart|stupid|clever|wise|foolish|depressed|happy|sad|angry|honorable)\b/.test(lower)) {
        return { type: 'personality', category: 'biographical' };
    }
    
    // Events/actions
    if (/\b(what did|what happened|what .* do|accomplish|achieve|defeat|kill|save|fight|battle|war|duel|journey|quest|mission|betray|help|rescue)\b/.test(lower)) {
        return { type: 'events', category: 'biographical' };
    }
    
    // Concept explanation
    if (/^(what is|what are|explain|define|describe|how does|how do|what does|tell me about)/i.test(query)) {
        return { type: 'concept', category: 'concept' };
    }
    
    // Comparison
    if (/\b(vs|versus|compare|difference|similar|alike|unlike|better|worse|stronger|weaker)\b/.test(lower)) {
        return { type: 'comparison', category: 'analytical' };
    }
    
    // List
    if (/\b(list|all|every|each|names|types|kinds|orders|shards|radiants|heralds|books|characters|magic)\b/.test(lower)) {
        return { type: 'list', category: 'analytical' };
    }
    
    // Yes/No
    if (/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\b/i.test(query)) {
        return { type: 'yesno', category: 'confirmation' };
    }
    
    // Default: general overview
    return { type: 'overview', category: 'general' };
}

function extractEntity(query, intent) {
    let cleaned = query;
    
    // Remove question words
    const prefixes = [
        'who is', 'who was', 'what is', 'what are', 'what was', 'what were',
        'when is', 'when was', 'when were', 'when did', 'when does', 'when do',
        'where is', 'where was', 'where were', 'where did', 'where does', 'where do',
        'why is', 'why was', 'why were', 'why did', 'why does', 'why do',
        'how is', 'how was', 'how were', 'how did', 'how does', 'how do',
        'how many', 'how much', 'tell me about', 'describe', 'explain',
        'what about', 'how about', 'is', 'are', 'was', 'were', 'did', 'does', 'do',
        'can', 'could', 'would', 'should', 'will', 'has', 'have', 'had'
    ];
    
    const lowerQuery = query.toLowerCase();
    for (const prefix of prefixes) {
        if (lowerQuery.startsWith(prefix + ' ')) {
            cleaned = query.substring(prefix.length).trim();
            break;
        }
    }
    
    // Remove trailing question mark and filler words
    cleaned = cleaned.replace(/[?.,!]$/, '').trim();
    cleaned = cleaned.replace(/\b(the|a|an|in|on|at|to|for|of|with|by|from|as|into|like|about)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    
    // If it's a concept question, return the whole thing
    if (intent.category === 'concept') {
        return cleaned || query.replace(/[?.,!]$/, '').trim();
    }
    
    // Try to find the longest capitalized sequence (proper noun)
    const words = cleaned.split(' ');
    let bestEntity = '';
    let current = [];
    
    for (const word of words) {
        if (/^[A-Z]/.test(word) && word.length > 1) {
            current.push(word);
        } else if (word.length > 0) {
            if (current.join(' ').length > bestEntity.length) {
                bestEntity = current.join(' ');
            }
            current = [];
        }
    }
    if (current.join(' ').length > bestEntity.length) {
        bestEntity = current.join(' ');
    }
    
    // If no proper noun found, return the longest remaining phrase
    if (!bestEntity) {
        const phrases = cleaned.split(/\s+(?:and|or|but|who|which|that|with|from)\s+/i);
        bestEntity = phrases.sort((a, b) => b.length - a.length)[0] || cleaned;
    }
    
    return bestEntity || query.replace(/[?.,!]$/, '').trim();
}

// ==================== API CALLS ====================

async function searchCoppermind(query) {
    const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: 10,
        format: 'json',
        origin: '*'
    });
    
    try {
        const res = await fetch(`${API_BASE}?${params}`);
        const data = await res.json();
        return data.query?.search || [];
    } catch (e) {
        console.error('Search error:', e);
        return [];
    }
}

async function fetchArticles(titles) {
    if (!titles || titles.length === 0) return [];
    
    const extractParams = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        titles: titles.join('|'),
        exchars: 8000,
        explaintext: true,
        exlimit: 'max',
        format: 'json',
        origin: '*'
    });
    
    try {
        const res = await fetch(`${API_BASE}?${extractParams}`);
        const data = await res.json();
        const pages = data.query?.pages || {};
        
        return Object.values(pages).map(page => ({
            title: page.title,
            extract: page.extract || '',
            pageId: page.pageid
        })).filter(p => p.extract && p.extract.length > 20);
    } catch (e) {
        console.error('Fetch error:', e);
        return [];
    }
}

async function fetchFullArticle(title) {
    const params = new URLSearchParams({
        action: 'query',
        prop: 'extracts',
        titles: title,
        exlimit: 1,
        explaintext: true,
        exsectionformat: 'plain',
        format: 'json',
        origin: '*'
    });
    
    try {
        const res = await fetch(`${API_BASE}?${params}`);
        const data = await res.json();
        const pages = data.query?.pages || {};
        const page = Object.values(pages)[0];
        return page ? { title: page.title, extract: page.extract || '', pageId: page.pageid } : null;
    } catch (e) {
        console.error('Full fetch error:', e);
        return null;
    }
}

// ==================== ANSWER GENERATION ====================

function generateAnswer(intent, articles, originalQuery) {
    const main = articles[0];
    const text = cleanText(main.extract || '');
    const title = main.title;
    
    if (!text || text.length < 30) {
        return {
            text: `<p>I found the article for <strong>${escapeHtml(title)}</strong>, but the Coppermind API only provided a very brief excerpt.</p><p><a href="${WIKI_BASE}${encodeURIComponent(title.replace(/ /g, '_'))}" target="_blank" style="color: #b87333;">Read the full article on Coppermind →</a></p>`,
            meta: { confidence: 'low', sources: [title] }
        };
    }
    
    let answer = '';
    let confidence = 'high';
    let sources = [title];
    
    // Route to specific handler based on intent
    switch (intent.type) {
        case 'birth':
            answer = handleBirth(text, title, articles);
            break;
        case 'death':
            answer = handleDeath(text, title, articles);
            break;
        case 'age':
            answer = handleAge(text, title, articles);
            break;
        case 'appearance':
            answer = handleAppearance(text, title, articles);
            break;
        case 'family':
            answer = handleFamily(text, title, articles);
            break;
        case 'abilities':
            answer = handleAbilities(text, title, articles);
            break;
        case 'role':
            answer = handleRole(text, title, articles);
            break;
        case 'origin':
            answer = handleOrigin(text, title, articles);
            break;
        case 'appearances':
            answer = handleAppearances(text, title, articles);
            break;
        case 'personality':
            answer = handlePersonality(text, title, articles);
            break;
        case 'events':
            answer = handleEvents(text, title, articles);
            break;
        case 'concept':
            answer = handleConcept(text, title, articles);
            break;
        case 'comparison':
            answer = handleComparison(articles, originalQuery);
            break;
        case 'list':
            answer = handleList(text, title, articles);
            break;
        case 'yesno':
            answer = handleYesNo(text, title, originalQuery, articles);
            break;
        default:
            answer = handleOverview(text, title, articles);
    }
    
    // If specific handler failed, fall back to overview
    if (answer.includes('could not find') || answer.includes('not specified') || answer.includes('no information')) {
        if (intent.type !== 'overview' && intent.type !== 'concept') {
            const fallback = handleOverview(text, title, articles);
            if (!fallback.includes('could not find')) {
                answer = `<p>I could not find a specific answer to your exact question, but here is what I know about <strong>${title}</strong>:</p>` + fallback;
                confidence = 'medium';
            }
        }
    }
    
    // Check if we should add info from other articles
    if (articles.length > 1 && confidence === 'high' && !answer.includes('could not find')) {
        const extra = findAdditionalContext(articles.slice(1), intent.type, title);
        if (extra) answer += extra;
    }
    
    if (answer.includes('could not find') || answer.includes('not specified')) {
        confidence = 'low';
    }
    
    return {
        text: answer,
        meta: { confidence, sources: articles.slice(0, 3).map(a => a.title) }
    };
}

// ==================== SPECIFIC HANDLERS ====================

function handleBirth(text, title, articles) {
    // Look for birth patterns aggressively
    const patterns = [
        { regex: /born\s+(?:in|on)?\s*(\d{4})/i, format: m => `in ${m[1]}` },
        { regex: /born\s+(?:in|on)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, format: m => `on ${m[1]}` },
        { regex: /born\s+(?:in|on)?\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i, format: m => `on ${m[1]}` },
        { regex: /date\s+of\s+birth[:\s]+(\d{4}|[A-Za-z]+\s+\d+)/i, format: m => m[1] },
        { regex: /birth[:\s]+(\d{4})/i, format: m => `in ${m[1]}` },
        { regex: /(\d{4})\s*,\s*(?:in\s+)?(?:the\s+)?year\s+(?:of\s+)?(?:his|her|their)\s+birth/i, format: m => `in ${m[1]}` }
    ];
    
    for (const { regex, format } of patterns) {
        const match = text.match(regex);
        if (match && match[1]) {
            return `<p><strong>${title}</strong> was born ${format(match)}.</p><p>${findContext(text, match.index, 120)}</p>`;
        }
    }
    
    // Check other articles
    for (const art of articles.slice(1)) {
        const t = cleanText(art.extract || '');
        for (const { regex, format } of patterns) {
            const match = t.match(regex);
            if (match && match[1]) {
                return `<p>According to the article on <strong>${art.title}</strong>, <strong>${title}</strong> was born ${format(match)}.</p>`;
            }
        }
    }
    
    return `<p>I could not find a specific birth date for <strong>${title}</strong> in the available excerpts. The full article on the Coppermind may contain this information.</p>`;
}

function handleDeath(text, title, articles) {
    const patterns = [
        { regex: /died\s+(?:in|on)?\s*(\d{4})/i, format: m => `in ${m[1]}` },
        { regex: /died\s+(?:in|on)?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i, format: m => `on ${m[1]}` },
        { regex: /death[:\s]+(\d{4})/i, format: m => `in ${m[1]}` },
        { regex: /(?:was|is)\s+killed\s+(?:in|on|during)?\s*(\d{4})/i, format: m => `in ${m[1]}` },
        { regex: /(?:was|is)\s+slain/i, format: () => '(slain — date unspecified)' },
        { regex: /(?:was|is)\s+assassinated/i, format: () => '(assassinated — date unspecified)' }
    ];
    
    for (const { regex, format } of patterns) {
        const match = text.match(regex);
        if (match) {
            return `<p><strong>${title}</strong> died ${format(match)}.</p><p>${findContext(text, match.index, 120)}</p>`;
        }
    }
    
    // Check if alive
    const alivePatterns = [
        /is\s+(?:still\s+)?alive/i,
        /currently\s+(?:resides?|lives?)\b/i,
        /survived\b/i,
        /(?:has|have)\s+not\s+died/i
    ];
    for (const p of alivePatterns) {
        if (p.test(text)) {
            return `<p><strong>${title}</strong> is still alive according to the archives.</p>`;
        }
    }
    
    return `<p>I could not find a death date for <strong>${title}</strong>. They may still be alive, or the records do not contain this detail.</p>`;
}

function handleAge(text, title, articles) {
    // Direct age mention
    const ageMatch = text.match(/(?:is|was|age[d\s]+)\s+(\d+)\s+years?\s+old/i);
    if (ageMatch) {
        return `<p><strong>${title}</strong> is <strong>${ageMatch[1]} years old</strong>.</p>`;
    }
    
    // Calculate from birth year
    const birthMatch = text.match(/born\s+(?:in\s+)?(\d{4})/i);
    if (birthMatch) {
        const birthYear = parseInt(birthMatch[1]);
        // Determine approximate "present" year based on context
        let presentYear = 1175;
        if (text.includes('Scadrial') || text.includes('Mistborn') || text.includes('Elendel')) presentYear = 348;
        if (text.includes('Nalthis') || text.includes('Warbreaker') || text.includes('Hallandren')) presentYear = 328;
        if (text.includes('Sel') || text.includes('Elantris') || text.includes('Fjorden')) presentYear = 928;
        if (text.includes('Taldain') || text.includes('Dayside')) presentYear = 0;
        
        const age = presentYear - birthYear;
        return `<p><strong>${title}</strong> was born in <strong>${birthYear}</strong>, making them approximately <strong>${age} years old</strong> during the main events of their series.</p>`;
    }
    
    return `<p>I could not determine the exact age of <strong>${title}</strong> from the available excerpts.</p>`;
}

function handleAppearance(text, title, articles) {
    const descriptions = [];
    
    // Pattern-based extraction
    const patterns = [
        /(?:is|was)\s+(?:a\s+)?([^.,;]{10,100}?(?:tall|short|muscular|slender|thin|heavy|broad|lean|athletic|wiry|lanky|stocky)[^.,;]{0,60})/i,
        /(?:has|with|wearing)\s+([^.,;]{10,100}?(?:hair|eyes|skin|face|beard|complexion|build|figure)[^.,;]{0,60})/i,
        /(?:dark|light|pale|tan|black|brown|blond|red|white|grey|gray|blue|green|hazel|amber|violet)\s+(?:hair|eyes|skin)/gi
    ];
    
    for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            const desc = (match[1] || match[0]).trim();
            if (desc.length > 10 && !descriptions.includes(desc)) {
                descriptions.push(desc);
            }
        }
    }
    
    // Scan sentences for physical traits
    const sentences = splitSentences(text);
    for (const sent of sentences.slice(0, 8)) {
        const lower = sent.toLowerCase();
        if ((lower.includes('hair') || lower.includes('eyes') || lower.includes('skin') || 
             lower.includes('tall') || lower.includes('build') || lower.includes('appearance') || 
             lower.includes('look') || lower.includes('dressed') || lower.includes('wearing')) &&
            sent.length > 20 && sent.length < 200) {
            if (!descriptions.includes(sent)) descriptions.push(sent);
        }
    }
    
    if (descriptions.length > 0) {
        let response = `<p><strong>${title}</strong> is described as follows:</p><ul>`;
        for (const desc of descriptions.slice(0, 4)) {
            response += `<li>${desc}.</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    return `<p>I could not find a detailed physical description of <strong>${title}</strong> in the available excerpts.</p>`;
}

function handleFamily(text, title, articles) {
    const relations = [];
    const patterns = [
        { type: 'Father', regex: /(?:father|dad)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
        { type: 'Mother', regex: /(?:mother|mom)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
        { type: 'Sibling', regex: /(?:brother|sister)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
        { type: 'Spouse', regex: /(?:wife|husband|spouse|married\s+(?:to)?)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
        { type: 'Child', regex: /(?:son|daughter)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i }
    ];
    
    for (const { type, regex } of patterns) {
        const match = text.match(regex);
        if (match && match[1]) {
            relations.push(`${type}: ${match[1].trim()}`);
        }
    }
    
    // House/family name
    const houseMatch = text.match(/(?:house|family|line)\s+(?:of|name)?\s*[:]?s*([^.,;]{3,40})/i);
    if (houseMatch && houseMatch[1]) {
        relations.push(`House: ${houseMatch[1].trim()}`);
    }
    
    if (relations.length > 0) {
        let response = `<p><strong>${title}'s</strong> family connections:</p><ul>`;
        for (const r of relations) {
            response += `<li>${r}</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    return `<p>I could not find detailed family information for <strong>${title}</strong> in the available excerpts.</p>`;
}

function handleAbilities(text, title, articles) {
    const abilities = [];
    const abilityMap = {
        'Allomancy': ['allomancer', 'allomancy', 'burns metals', 'soothing', 'rioting', 'coinshot', 'tineye', 'pewterarm', 'lurcher', 'seeker', 'mistborn'],
        'Feruchemy': ['feruchemist', 'feruchemy', 'metalmind', 'twinborn'],
        'Surgebinding': ['surgebinder', 'surgebinding', 'knight radiant', 'radiant', 'spren', 'nahel bond', 'windrunner', 'lightweaver', 'bondsmith', 'edgedancer', 'truthwatcher', 'skybreaker', 'dustbringer', 'willshaper', 'stoneward', 'elsecaller', 'order of'],
        'Awakening': ['awakener', 'awakening', 'breath', 'biochroma', 'lifeless', 'returned'],
        'AonDor': ['aondor', 'elantrian', 'aons', 'sel'],
        'Forgery': ['forger', 'forgery', 'soulstamp'],
        'Dakhor': ['dakhor', 'dakhor monk'],
        'ChayShan': ['chayshan'],
        'Sand Mastery': ['sand master', 'sand mastery'],
        'Hemalurgy': ['hemalurgist', 'hemalurgy', 'spike'],
        'Shardblade': ['shardblade', 'honorblade', 'dead blade', 'living blade'],
        'Shardplate': ['shardplate'],
        'Compounding': ['compounding', 'compound'],
        'Regal': ['regal', 'stormform', 'envoyform', 'voidform'],
        'Kandra': ['kandra', 'blessing'],
        'Koloss': ['koloss'],
        'Elantrian': ['elantrian', 'elantrians'],
        'Returned': ['returned', 'god king'],
        'Awakener': ['awakener', 'awakeners']
    };
    
    const lowerText = text.toLowerCase();
    for (const [ability, keywords] of Object.entries(abilityMap)) {
        if (keywords.some(kw => lowerText.includes(kw))) {
            if (!abilities.includes(ability)) abilities.push(ability);
        }
    }
    
    // Look for explicit power descriptions
    const powerMatch = text.match(/(?:has|possesses|wields|uses|commands|controls|is capable of|is able to)\s+([^.,;]{10,120})/i);
    
    if (abilities.length > 0) {
        let response = `<p><strong>${title}</strong> possesses the following abilities:</p><ul>`;
        for (const a of abilities.slice(0, 6)) {
            response += `<li><strong>${a}</strong></li>`;
        }
        response += `</ul>`;
        if (powerMatch) {
            response += `<p>Specifically: ${powerMatch[0]}.</p>`;
        }
        return response;
    }
    
    if (powerMatch) {
        return `<p><strong>${title}</strong> ${powerMatch[0]}.</p>`;
    }
    
    return `<p>I could not find specific abilities listed for <strong>${title}</strong> in the available excerpts.</p>`;
}

function handleRole(text, title, articles) {
    const roles = [];
    const rolePatterns = [
        { name: 'Knight Radiant', keywords: ['knight radiant', 'radiant', 'windrunner', 'lightweaver', 'bondsmith'] },
        { name: 'Soldier', keywords: ['soldier', 'spearman', 'swordsman', 'warrior', 'bridgeman', 'army', 'military'] },
        { name: 'Noble', keywords: ['noble', 'lord', 'lady', 'highprince', 'king', 'queen', 'emperor', 'prince', 'princess'] },
        { name: 'Scholar', keywords: ['scholar', 'ardent', 'researcher', 'historian'] },
        { name: 'Merchant', keywords: ['merchant', 'trader'] },
        { name: 'Thief', keywords: ['thief', 'crewleader', 'criminal', 'bandit'] },
        { name: 'Spy', keywords: ['spy', 'informant', 'operative'] },
        { name: 'Surgeon', keywords: ['surgeon', 'healer', 'doctor'] },
        { name: 'Assassin', keywords: ['assassin', 'killer'] },
        { name: 'Writer', keywords: ['writer', 'author', 'poet', 'artist'] },
        { name: 'Singer', keywords: ['singer', 'listener', 'fused'] },
        { name: 'Herald', keywords: ['herald', 'heralds'] },
        { name: 'Vessel', keywords: ['vessel', 'shard', 'holder'] },
        { name: 'Champion', keywords: ['champion', 'champion of'] },
        { name: 'Artifabrian', keywords: ['artifabrian', 'fabrial'] }
    ];
    
    const lowerText = text.toLowerCase();
    for (const { name, keywords } of rolePatterns) {
        if (keywords.some(kw => lowerText.includes(kw))) {
            if (!roles.includes(name)) roles.push(name);
        }
    }
    
    // Explicit role patterns
    const explicitMatch = text.match(/(?:is|was|serves? as|works? as|acts? as|holds? the position of)\s+(?:a|an|the)?\s+([^.,;]{5,60})/i);
    if (explicitMatch && explicitMatch[1]) {
        const role = explicitMatch[1].trim();
        if (!roles.includes(role)) roles.push(role);
    }
    
    if (roles.length > 0) {
        return `<p><strong>${title}</strong> is ${roles.slice(0, 4).join(', ')}.</p>`;
    }
    
    return `<p>I could not determine the specific role or occupation of <strong>${title}</strong>.</p>`;
}

function handleOrigin(text, title, articles) {
    const worldMap = {
        'Roshar': ['roshar', 'alethkar', 'jah keved', 'shadesmar', 'urithiru', 'kholin', 'herdaz', 'shinovar', 'kharbranth', 'thaylenah'],
        'Scadrial': ['scadrial', 'final empire', 'elendel', 'basin', 'southern scadrial', 'mistborn', 'luthadel', 'terrism'],
        'Nalthis': ['nalthis', 'hallandren', 'ttelir', 'idris', 'warbreaker', ' Returned'],
        'Sel': ['sel', 'elantris', 'fjorden', 'aedon', 'rose empire', 'dominion', 'devotion', 'opelon'],
        'Taldain': ['taldain', 'dayside', 'darkside', 'kezare', 'white sand'],
        'Threnody': ['threnody', 'forest of hell', 'homeland'],
        'First of the Sun': ['first of the sun', 'pantheon', 'patji', 'sixth of the dusk'],
        'Yolen': ['yolen']
    };
    
    const lowerText = text.toLowerCase();
    const worlds = [];
    for (const [world, keywords] of Object.entries(worldMap)) {
        if (keywords.some(kw => lowerText.includes(kw))) {
            worlds.push(world);
        }
    }
    
    if (worlds.length > 0) {
        return `<p><strong>${title}</strong> is from <strong>${worlds.join(' / ')}</strong>.</p>`;
    }
    
    const fromMatch = text.match(/(?:is|was|comes|hails)\s+(?:from|of)\s+([A-Z][a-zA-Z]+)/);
    if (fromMatch) {
        return `<p><strong>${title}</strong> is from <strong>${fromMatch[1]}</strong>.</p>`;
    }
    
    return `<p>I could not determine the world or origin of <strong>${title}</strong>.</p>`;
}

function handleAppearances(text, title, articles) {
    const bookNames = [
        'The Way of Kings', 'Words of Radiance', 'Oathbringer', 'Rhythm of War', 'Wind and Truth',
        'Mistborn: The Final Empire', 'The Well of Ascension', 'The Hero of Ages',
        'The Alloy of Law', 'Shadows of Self', 'The Bands of Mourning', 'The Lost Metal',
        'Elantris', 'Warbreaker', 'Arcanum Unbounded', 'White Sand',
        'Tress of the Emerald Sea', 'Yumi and the Nightmare Painter', 'The Sunlit Man',
        'Defending Elysium', 'Firstborn'
    ];
    
    const found = [];
    for (const book of bookNames) {
        const escaped = book.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');
        if (regex.test(text)) {
            found.push(book);
        }
    }
    
    if (found.length > 0) {
        return `<p><strong>${title}</strong> appears in:</p><ul>${found.map(b => `<li>${b}</li>`).join('')}</ul>`;
    }
    
    // Check for "appears in" or "featured in" patterns
    const appearMatch = text.match(/(?:appears?|featured?|introduced?)\s+(?:in|in the book)?\s*["']?([^"']{5,60}?)["']?/i);
    if (appearMatch && appearMatch[1]) {
        return `<p><strong>${title}</strong> appears in <strong>${appearMatch[1].trim()}</strong>.</p>`;
    }
    
    return `<p>I could not find specific book appearances for <strong>${title}</strong> in the available excerpts.</p>`;
}

function handlePersonality(text, title, articles) {
    const traits = [];
    const sentences = splitSentences(text);
    
    const traitPatterns = [
        /(?:is|was)\s+(?:a\s+)?([^.,;]{10,80}?(?:brave|coward|honest|dishonest|kind|cruel|smart|clever|wise|foolish|depressed|happy|sad|angry|honorable|dishonorable|loyal|faithless|stubborn|determined|broken|idealistic|cynical|optimistic|pessimistic)[^.,;]{0,40})/i,
        /(?:has|possesses|shows|displays|exhibits)\s+(?:a\s+)?([^.,;]{10,80}?(?:temper|nature|disposition|attitude|spirit|will|determination|honor|integrity)[^.,;]{0,40})/i
    ];
    
    for (const pattern of traitPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            traits.push(match[1].trim());
        }
    }
    
    // Scan for personality-related sentences
    for (const sent of sentences.slice(0, 10)) {
        const lower = sent.toLowerCase();
        if ((lower.includes('personality') || lower.includes('character') || lower.includes('temperament') ||
             lower.includes('honor') || lower.includes('determined') || lower.includes('broken') ||
             lower.includes('struggles') || lower.includes('depression') || lower.includes('ideal')) &&
            sent.length > 30 && sent.length < 200) {
            if (!traits.includes(sent)) traits.push(sent);
        }
    }
    
    if (traits.length > 0) {
        let response = `<p><strong>${title}'s</strong> personality and character:</p><ul>`;
        for (const t of traits.slice(0, 4)) {
            response += `<li>${t}.</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    return `<p>I could not find detailed personality information for <strong>${title}</strong> in the available excerpts.</p>`;
}

function handleEvents(text, title, articles) {
    const events = [];
    const sentences = splitSentences(text);
    
    for (const sent of sentences) {
        const lower = sent.toLowerCase();
        if ((lower.includes('fought') || lower.includes('battled') || lower.includes('led') || 
             lower.includes('commanded') || lower.includes('discovered') || lower.includes('created') ||
             lower.includes('destroyed') || lower.includes('saved') || lower.includes('killed') ||
             lower.includes('defeated') || lower.includes('betrayed') || lower.includes('allied') ||
             lower.includes('joined') || lower.includes('returned') || lower.includes('escaped') ||
             lower.includes('rescued') || lower.includes('protected') || lower.includes('trained')) &&
            sent.length > 30 && sent.length < 250) {
            events.push(sent);
        }
    }
    
    if (events.length > 0) {
        let response = `<p>Key events involving <strong>${title}</strong>:</p><ul>`;
        for (const e of events.slice(0, 5)) {
            response += `<li>${e}.</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    return `<p>I could not find specific events involving <strong>${title}</strong> in the available excerpts.</p>`;
}

function handleConcept(text, title, articles) {
    const sentences = splitSentences(text);
    const definition = sentences.filter(s => s.length > 50 && s.length < 300).slice(0, 4);
    
    if (definition.length === 0) {
        return `<p>I found records of <strong>${title}</strong>, but the available excerpts do not contain a clear explanation.</p>`;
    }
    
    let response = `<p><strong>${title}</strong> is ${definition[0].toLowerCase()}.</p>`;
    for (let i = 1; i < definition.length; i++) {
        response += `<p>${definition[i]}.</p>`;
    }
    
    return response;
}

function handleComparison(articles, query) {
    if (articles.length < 2) {
        return `<p>To compare two subjects, I need to find both in the archives. Could you specify both names more clearly?</p>`;
    }
    
    const [a1, a2] = articles;
    const text1 = cleanText(a1.extract || '');
    const text2 = cleanText(a2.extract || '');
    const sentences1 = splitSentences(text1).filter(s => s.length > 40);
    const sentences2 = splitSentences(text2).filter(s => s.length > 40);
    
    let response = `<p>Here is a comparison of <strong>${a1.title}</strong> and <strong>${a2.title}</strong>:</p>`;
    
    response += `<p><strong>${a1.title}:</strong> ${sentences1[0] || 'Limited information'}.</p>`;
    response += `<p><strong>${a2.title}:</strong> ${sentences2[0] || 'Limited information'}.</p>`;
    
    // Find common keywords
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 5));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 5));
    const common = [...words1].filter(w => words2.has(w) && !['about', 'after', 'before', 'because', 'through', 'between', 'against', 'around', 'within', 'without'].includes(w));
    
    if (common.length > 0) {
        response += `<p>Both share connections to: <em>${common.slice(0, 6).join(', ')}</em>.</p>`;
    }
    
    return response;
}

function handleList(text, title, articles) {
    // Try to extract a list from the text
    const sentences = splitSentences(text);
    const items = sentences.filter(s => 
        (s.match(/^\d+\./) || s.match(/^[-•]/) || s.match(/^[A-Z][a-z]+:/) || 
         s.includes('includes') || s.includes('consists of') || s.includes('comprises')) &&
        s.length > 20 && s.length < 150
    );
    
    if (items.length > 2) {
        let response = `<p>Here are the items I found regarding <strong>${title}</strong>:</p><ul>`;
        for (const item of items.slice(0, 8)) {
            response += `<li>${item}</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    // Fallback: return key sentences
    const keySentences = sentences.filter(s => s.length > 40 && s.length < 200).slice(0, 6);
    if (keySentences.length > 0) {
        let response = `<p>Information about <strong>${title}</strong>:</p><ul>`;
        for (const s of keySentences) {
            response += `<li>${s}</li>`;
        }
        response += `</ul>`;
        return response;
    }
    
    return `<p>I could not find a clear list in the archives for <strong>${title}</strong>.</p>`;
}

function handleYesNo(text, title, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    
    // Extract the claim from the question
    const claim = lowerQuery.replace(/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\s+/, '').replace(/[?.,!]$/, '');
    
    // Check if text supports or contradicts
    const supportWords = ['is', 'was', 'are', 'were', 'has', 'have', 'had', 'does', 'did', 'can', 'could'];
    const negateWords = ['not', 'never', 'no', 'without', 'neither', 'nor', 'none', 'nothing', 'nobody', 'nowhere', 'hardly', 'scarcely', 'barely'];
    
    // Simple keyword matching
    const claimWords = claim.split(/\s+/).filter(w => w.length > 3);
    let supportScore = 0;
    let negateScore = 0;
    
    for (const word of claimWords) {
        if (lowerText.includes(word)) supportScore++;
    }
    
    const sentences = splitSentences(text);
    for (const sent of sentences) {
        const lower = sent.toLowerCase();
        if (claimWords.filter(w => lower.includes(w)).length >= Math.max(1, claimWords.length * 0.5)) {
            if (negateWords.some(n => lower.includes(n))) {
                negateScore++;
            } else {
                supportScore += 2;
            }
        }
    }
    
    if (supportScore > negateScore && supportScore > 0) {
        return `<p>Yes — according to the Coppermind archives, <strong>${title}</strong> ${claim}.</p><p>${sentences[0] || ''}</p>`;
    } else if (negateScore > supportScore) {
        return `<p>No — the archives indicate otherwise regarding <strong>${title}</strong>.</p><p>${sentences[0] || ''}</p>`;
    } else {
        return `<p>The archives contain information about <strong>${title}</strong>, but do not clearly confirm or deny whether ${claim}.</p><p>${sentences[0] || ''}</p>`;
    }
}

function handleOverview(text, title, articles) {
    const sentences = splitSentences(text);
    const intro = sentences.filter(s => s.length > 40 && s.length < 250).slice(0, 3);
    
    if (intro.length === 0) {
        return `<p>I found an article for <strong>${title}</strong>, but the available excerpt is too brief to summarize.</p>`;
    }
    
    let response = `<p><strong>${title}</strong> is ${intro[0].toLowerCase()}.</p>`;
    
    for (let i = 1; i < intro.length; i++) {
        response += `<p>${intro[i]}.</p>`;
    }
    
    // Add quick facts
    const facts = [];
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('roshar') || lowerText.includes('scadrial') || lowerText.includes('nalthis')) {
        const worldMatch = text.match(/\b(Roshar|Scadrial|Nalthis|Sel|Taldain|Threnody)\b/);
        if (worldMatch) facts.push(`World: ${worldMatch[1]}`);
    }
    
    const dateMatch = text.match(/born\s+(?:in\s+)?(\d{4})/i);
    if (dateMatch) facts.push(`Born: ${dateMatch[1]}`);
    
    if (facts.length > 0) {
        response += `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;"><strong>Quick facts:</strong> ${facts.join(' • ')}</p>`;
    }
    
    return response;
}

// ==================== HELPERS ====================

function findAdditionalContext(articles, intentType, mainTitle) {
    if (articles.length === 0) return '';
    
    const snippets = [];
    for (const art of articles.slice(0, 2)) {
        const text = cleanText(art.extract || '');
        const sentences = splitSentences(text).filter(s => s.length > 50 && s.length < 200);
        if (sentences.length > 0 && !sentences[0].includes(mainTitle)) {
            snippets.push({ text: sentences[0], source: art.title });
        }
    }
    
    if (snippets.length === 0) return '';
    
    return `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;">The article on <strong>${snippets[0].source}</strong> also mentions: ${snippets[0].text}</p>`;
}

function findContext(text, index, radius) {
    if (index === undefined || index === null) return '';
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius + 50);
    let ctx = text.substring(start, end);
    
    // Clean up partial words
    if (start > 0) {
        const firstSpace = ctx.indexOf(' ');
        if (firstSpace > 0) ctx = '...' + ctx.substring(firstSpace);
    }
    if (end < text.length) {
        const lastSpace = ctx.lastIndexOf(' ');
        if (lastSpace > 0) ctx = ctx.substring(0, lastSpace) + '...';
    }
    
    return ctx.trim();
}

function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\{\{.*?\}\}/g, '')
        .replace(/\[\[.*?\|(.*?)\]\]/g, '$1')
        .replace(/\[\[(.*?)\]\]/g, '$1')
        .replace(/'''?(.*?)'''?/g, '$1')
        .replace(/==+.*?==+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function splitSentences(text) {
    return text
        .replace(/([.!?])\s+/g, "$1|")
        .split("|")
        .map(s => s.trim())
        .filter(s => s.length > 10);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
