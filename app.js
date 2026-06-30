const API_BASE = 'https://coppermind.net/w/api.php';
const WIKI_BASE = 'https://coppermind.net/wiki/';

// ==================== STATE ====================
const KB = {
    cache: new Map(),
    context: { lastEntity: null, lastTopic: null, history: [] },
    
    get(key) {
        const item = this.cache.get(key);
        if (item && Date.now() - item.time < 1000 * 60 * 30) return item.data;
        return null;
    },
    
    set(key, data) {
        this.cache.set(key, { data, time: Date.now() });
        if (this.cache.size > 300) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
    }
};

// ==================== UI ====================
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatMessages = document.getElementById('chatMessages');
const typingIndicator = document.getElementById('typingIndicator');

chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function askSuggestion(text) { chatInput.value = text; sendMessage(); }

function startNewChat() {
    KB.context = { lastEntity: null, lastTopic: null, history: [] };
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
                <p>Greetings, traveler. I am the Coppermind Scholar, attuned to the Spiritual Realm of Brandon Sanderson's Cosmere. My archives span characters, shards, magic systems, and worlds across the cosmere. Ask, and I shall search the Cognitive Realm for answers.</p>
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
        const answer = await Scholar.process(text);
        hideTyping();
        addMessage(answer.text, 'bot', answer.meta);
    } catch (err) {
        console.error(err);
        hideTyping();
        addMessage("The perpendicularity is unstable — I cannot reach the Coppermind archives. Please try again.", 'bot');
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
    if (meta?.sources?.length) {
        const links = meta.sources.map(s => 
            `<a class="citation" href="${WIKI_BASE}${encodeURIComponent(s.replace(/ /g, '_'))}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`
        ).join(' • ');
        metaHtml += `<div style="margin-top:10px; font-size: 0.8rem;">Sources: ${links}</div>`;
    }
    if (meta?.confidence) {
        const color = meta.confidence === 'high' ? '#4ade80' : meta.confidence === 'medium' ? '#fbbf24' : '#f87171';
        metaHtml += `<span class="confidence" style="color: ${color};">Confidence: ${meta.confidence}</span>`;
    }
    
    div.innerHTML = `
        <div class="avatar">${sender === 'bot' ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>' : ''}</div>
        <div class="message-content"><div class="message-text">${text}</div>${metaHtml}<span class="timestamp">${time}</span></div>
    `;
    chatMessages.appendChild(div);
    scrollToBottom();
    KB.context.history.push({ sender, text });
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }
function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }

// ==================== SCHOLAR CORE ====================
const Scholar = {
    async process(query) {
        let q = query;
        if (this.isFollowUp(query) && KB.context.lastEntity) {
            q = this.injectContext(query, KB.context.lastEntity);
        }
        
        const analysis = this.analyzeQuery(q);
        console.log('Analysis:', analysis);
        
        const searchResults = await this.multiSearch(analysis);
        if (!searchResults.length) {
            return this.noResults(query);
        }
        
        const articles = await this.ingestArticles(searchResults.slice(0, 6));
        if (!articles.length) {
            return this.noResults(query);
        }
        
        KB.context.lastEntity = articles[0].title;
        KB.context.lastTopic = analysis.intent;
        
        const knowledge = this.extractKnowledge(articles);
        return this.synthesize(analysis, articles, knowledge);
    },
    
    isFollowUp(q) {
        return /^(what about|and|what|how about|tell me more|who else|where else|why|how|when|is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\b/i.test(q) && 
               !/[A-Z][a-z]+/.test(q) && q.length < 40;
    },
    
    injectContext(q, entity) {
        return `${q} ${entity}`;
    },
    
    analyzeQuery(query) {
        const lower = query.toLowerCase().replace(/[?.,!]/g, '');
        const words = lower.split(/\s+/);
        
        const entity = this.extractEntity(query);
        const intent = this.classifyIntent(lower, query);
        
        const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','shall','should','can','could','may','might','must','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','under','and','but','or','yet','so','if','because','since','although','though','while','where','when','who','what','which','whom','whose','how','why','this','that','these','those','i','me','my','we','our','you','your','he','him','his','she','her','it','its','they','them','their','am','all','any','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','now','then','here','there','once','again','further','also','too','very','really','actually','probably','maybe','perhaps','still','yet','already','almost','quite','rather','pretty','fairly','somewhat','about','after','again','against','almost','already','although','always','among','amount','an','and','another','any','anyone','anything','around','as','at','away','back','be','became','because','become','been','before','behind','being','below','between','both','but','by','came','can','cannot','could','did','do','does','doing','done','down','during','each','either','else','enough','even','ever','every','everyone','everything','far','few','for','from','further','get','gets','getting','given','gives','go','goes','going','gone','got','gotten','had','has','have','having','he','her','here','hers','herself','him','himself','his','how','however','i','if','in','into','is','it','its','itself','just','keep','keeps','kept','last','least','less','let','lets','like','likely','made','make','makes','making','many','may','maybe','me','might','mine','more','most','mostly','much','must','my','myself','near','nearly','need','needs','neither','never','new','next','no','nobody','non','none','noone','nor','not','nothing','now','nowhere','of','off','often','oh','ok','okay','old','on','once','one','only','onto','or','other','others','our','ours','ourselves','out','outside','over','overall','own','part','parts','per','perhaps','please','put','puts','quite','rather','re','really','right','said','same','saw','say','says','second','seconds','see','seem','seemed','seeming','seems','sees','several','shall','she','should','show','showed','showing','shows','side','sides','since','small','smaller','smallest','so','some','somebody','someone','something','somewhere','state','states','still','such','sure','t','take','taken','takes','taking','than','that','the','their','them','themselves','then','there','therefore','these','they','thing','things','think','thinks','this','those','though','thought','thoughts','thousand','three','through','throughout','thus','to','today','together','too','took','toward','towards','trillion','try','trying','turn','turned','turning','turns','two','u','under','unless','until','up','upon','us','use','used','uses','using','very','via','want','wanted','wanting','wants','was','way','ways','we','well','wells','went','were','what','whatever','when','whenever','where','whereas','wherever','whether','which','while','who','whoever','whole','whom','whose','why','will','with','within','without','work','worked','working','works','would','x','y','year','years','yes','yet','you','young','younger','youngest','your','yours','yourself','yourselves','z']);
        
        const focusWords = words.filter(w => w.length > 2 && !stopWords.has(w));
        
        return { query, entity, intent, focusWords, original: query };
    },
    
    extractEntity(query) {
        let cleaned = query;
        const prefixes = [
            'who is','who was','what is','what are','what was','what were',
            'when is','when was','when were','when did','when does','when do',
            'where is','where was','where were','where did','where does','where do',
            'why is','why was','why were','why did','why does','why do',
            'how is','how was','how were','how did','how does','how do',
            'how many','how much','tell me about','describe','explain','define',
            'what about','how about','is','are','was','were','did','does','do',
            'can','could','would','should','will','has','have','had'
        ];
        
        const lower = query.toLowerCase();
        for (const p of prefixes) {
            if (lower.startsWith(p + ' ')) {
                cleaned = query.substring(p.length).trim();
                break;
            }
        }
        
        cleaned = cleaned.replace(/[?.,!]$/, '').trim();
        
        // Find capitalized proper nouns
        const words = cleaned.split(/\s+/);
        let best = '';
        let current = [];
        
        for (const w of words) {
            if (/^[A-Z][a-zA-Z]+$/.test(w) && w.length > 1) {
                current.push(w);
            } else if (w.length > 0) {
                const phrase = current.join(' ');
                if (phrase.length > best.length) best = phrase;
                current = [];
            }
        }
        const lastPhrase = current.join(' ');
        if (lastPhrase.length > best.length) best = lastPhrase;
        
        if (!best) {
            const phrases = cleaned.split(/\s+(?:and|or|but|who|which|that|with|from)\s+/i);
            best = phrases.sort((a, b) => b.length - a.length)[0] || cleaned;
        }
        
        return best || query.replace(/[?.,!]$/, '').trim();
    },
    
    classifyIntent(lower, original) {
        if (/\b(born|birth|birthday|date of birth|when .* born|when .* die|died|death|dead|killed|slain|murdered|assassinated|executed|how old|age|years old)\b/.test(lower)) {
            if (/\b(die|died|death|dead|killed|slain|murdered|assassinated|executed)\b/.test(lower)) return 'death';
            if (/\b(how old|age|years old)\b/.test(lower)) return 'age';
            return 'birth';
        }
        if (/\b(look like|appearance|describe .* look|looks like|hair|eyes|skin|face|tall|short|build|figure|handsome|beautiful|ugly|attractive|dress|clothing|wear)\b/.test(lower)) return 'appearance';
        if (/\b(family|parents|father|mother|dad|mom|siblings|brother|sister|related|married|wife|husband|spouse|son|daughter|child|children|cousin|uncle|aunt|nephew|niece|ancestor|descendant|lineage)\b/.test(lower)) return 'family';
        if (/\b(powers|abilities|skills|magic|allomancy|surgebinding|feruchemy|hemalurgy|awakening|aondor|forgery|sand mastery|investiture|shardblade|shardplate|spren|nahel|bond|radiant|mistborn|twinborn|compound|atium|lerasium|honorblade|surge|voidbinding|regal|stormform|kandra|koloss|elantrian|returned|awakener|dakhor|chayshan)\b/.test(lower)) return 'abilities';
        if (/\b(job|work|occupation|profession|role|position|soldier|knight|captain|general|lord|lady|king|queen|emperor|merchant|scholar|thief|spy|assassin|surgeon|writer|singer|artifabrian|highprince|herald|champion|vessel|warden|guard|servant|slave|master|apprentice)\b/.test(lower)) return 'role';
        if (/\b(from|planet|world|where .* from|homeworld|realm|location|place|city|nation|country|empire|kingdom|region|territory|valley|mountain|sea|ocean|shardworld)\b/.test(lower)) return 'origin';
        if (/\b(book|novel|appear|featured|first seen|introduced|debut|in which|which book|series|stormlight|mistborn|elantris|warbreaker|arcanum|tress|yumi|sunlit|emperor|soul|defending|firstborn|eleventh|secret|dawnshard)\b/.test(lower)) return 'appearances';
        if (/\b(personality|character|like|nature|temperament|brave|coward|honest|kind|cruel|smart|clever|wise|foolish|depressed|happy|sad|angry|honorable|dishonorable|loyal|faithless|stubborn|determined|broken|idealistic|cynical|optimistic|pessimistic|arrogant|humble|proud)\b/.test(lower)) return 'personality';
        if (/\b(what did|what happened|what .* do|accomplish|achieve|defeat|kill|save|fight|battle|war|duel|journey|quest|mission|betray|help|rescue|destroy|create|found|lead|command|rule|escape|survive|win|lose)\b/.test(lower)) return 'events';
        if (/^(what is|what are|explain|define|describe|how does|how do|what does|tell me about)/i.test(original)) return 'concept';
        if (/\b(vs|versus|compare|difference|similar|alike|unlike|better|worse|stronger|weaker|faster|slower)\b/.test(lower)) return 'comparison';
        if (/\b(list|all|every|each|names|types|kinds|orders|shards|radiants|heralds|books|characters|magic|spren|metals|surges|voidbringers|unmade)\b/.test(lower)) return 'list';
        if (/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\b/i.test(original)) return 'yesno';
        return 'overview';
    },
    
    // ==================== SEARCH ENGINE ====================
    async multiSearch(analysis) {
        const { entity, query } = analysis;
        const strategies = [];
        
        strategies.push(this.search(query));
        if (entity && entity !== query && entity.length > 2) {
            strategies.push(this.search(entity));
        }
        strategies.push(this.openSearch(entity || query));
        if (entity) {
            strategies.push(this.checkExactTitle(entity));
        }
        
        const results = await Promise.all(strategies);
        
        const merged = new Map();
        for (const arr of results) {
            for (const r of arr) {
                if (!merged.has(r.title) || r.score > merged.get(r.title).score) {
                    merged.set(r.title, r);
                }
            }
        }
        
        return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 8);
    },
    
    async search(q) {
        const cacheKey = 'search:' + q;
        const cached = KB.get(cacheKey);
        if (cached) return cached;
        
        try {
            const params = new URLSearchParams({
                action: 'query', list: 'search', srsearch: q,
                srlimit: 10, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const results = (data.query?.search || []).map((r, i) => ({
                title: r.title,
                snippet: r.snippet,
                score: 100 - i * 8
            }));
            KB.set(cacheKey, results);
            return results;
        } catch (e) { return []; }
    },
    
    async openSearch(q) {
        try {
            const params = new URLSearchParams({
                action: 'opensearch', search: q, limit: 8, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const titles = data[1] || [];
            return titles.map((t, i) => ({ title: t, score: 90 - i * 8 }));
        } catch (e) { return []; }
    },
    
    async checkExactTitle(title) {
        try {
            const params = new URLSearchParams({
                action: 'query', titles: title, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const pages = data.query?.pages || {};
            const page = Object.values(pages)[0];
            if (page && page.pageid && !page.missing) {
                return [{ title: page.title, score: 200 }];
            }
        } catch (e) {}
        return [];
    },
    
    // ==================== ARTICLE INGESTION ====================
    async ingestArticles(searchResults) {
        const titles = searchResults.map(r => r.title);
        if (!titles.length) return [];
        
        const [wikitextData, categoriesData, extractsData] = await Promise.all([
            this.fetchWikitext(titles),
            this.fetchCategories(titles),
            this.fetchExtracts(titles)
        ]);
        
        return titles.map(title => {
            const wt = wikitextData[title] || '';
            const cats = categoriesData[title] || [];
            const ext = extractsData[title] || '';
            
            return {
                title,
                wikitext: wt,
                categories: cats,
                extract: ext,
                infobox: this.parseInfobox(wt),
                parsed: this.parseWikitext(wt),
                cleanExtract: this.sanitizeExtract(ext)
            };
        }).filter(a => a.wikitext.length > 20 || a.extract.length > 20);
    },
    
    async fetchWikitext(titles) {
        const cacheKey = 'wt:' + titles.join('|');
        const cached = KB.get(cacheKey);
        if (cached) return cached;
        
        try {
            const params = new URLSearchParams({
                action: 'query', prop: 'revisions', titles: titles.join('|'),
                rvprop: 'content', rvslots: 'main', format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const pages = data.query?.pages || {};
            const result = {};
            for (const [id, page] of Object.entries(pages)) {
                const rev = page.revisions?.[0];
                const content = rev?.slots?.main?.['*'] || rev?.['*'] || '';
                result[page.title] = content;
            }
            KB.set(cacheKey, result);
            return result;
        } catch (e) { return {}; }
    },
    
    async fetchCategories(titles) {
        try {
            const params = new URLSearchParams({
                action: 'query', prop: 'categories', titles: titles.join('|'),
                cllimit: 50, format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const pages = data.query?.pages || {};
            const result = {};
            for (const [id, page] of Object.entries(pages)) {
                result[page.title] = (page.categories || []).map(c => c.title.replace('Category:', ''));
            }
            return result;
        } catch (e) { return {}; }
    },
    
    async fetchExtracts(titles) {
        try {
            const params = new URLSearchParams({
                action: 'query', prop: 'extracts', titles: titles.join('|'),
                exchars: 6000, explaintext: true, exlimit: 'max',
                format: 'json', origin: '*'
            });
            const res = await fetch(`${API_BASE}?${params}`);
            const data = await res.json();
            const pages = data.query?.pages || {};
            const result = {};
            for (const [id, page] of Object.entries(pages)) {
                result[page.title] = page.extract || '';
            }
            return result;
        } catch (e) { return {}; }
    },
    
    // ==================== PARSING ====================
    parseInfobox(wikitext) {
        const infobox = {};
        if (!wikitext) return infobox;
        
        // Find infobox template - handle nested braces
        let depth = 0;
        let start = -1;
        for (let i = 0; i < wikitext.length - 1; i++) {
            if (wikitext[i] === '{' && wikitext[i+1] === '{') {
                if (depth === 0) start = i;
                depth++;
                i++;
            } else if (wikitext[i] === '}' && wikitext[i+1] === '}') {
                depth--;
                i++;
                if (depth === 0 && start !== -1) {
                    const template = wikitext.substring(start + 2, i);
                    if (/^(?:Character|Location|Magic|Book|Event|Group|Creature|Shard)/i.test(template)) {
                        this.parseTemplateFields(template, infobox);
                    }
                    start = -1;
                }
            }
        }
        
        return infobox;
    },
    
    parseTemplateFields(templateContent, infobox) {
        // Remove template name
        const firstPipe = templateContent.indexOf('|');
        const content = firstPipe > 0 ? templateContent.substring(firstPipe + 1) : templateContent;
        
        // Split by pipes, respecting nested structures
        const fields = this.splitTemplateFields(content);
        
        for (const field of fields) {
            const eq = field.indexOf('=');
            if (eq > 0) {
                let key = field.substring(0, eq).trim().toLowerCase();
                let value = field.substring(eq + 1).trim();
                
                // Clean the value thoroughly
                value = this.cleanTemplateValue(value);
                
                if (key && value && value.length > 0 && value.length < 500) {
                    // Handle multiple values separated by commas or <br>
                    const values = value.split(/,|<br\s*\/?>/).map(v => v.trim()).filter(v => v.length > 0);
                    infobox[key] = values.length === 1 ? values[0] : values;
                }
            }
        }
    },
    
    splitTemplateFields(content) {
        const fields = [];
        let current = '';
        let depth = 0;
        
        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            if (char === '{' || char === '[') {
                depth++;
                current += char;
            } else if (char === '}' || char === ']') {
                depth--;
                current += char;
            } else if (char === '|' && depth === 0) {
                if (current.trim()) fields.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) fields.push(current.trim());
        
        return fields;
    },
    
    cleanTemplateValue(value) {
        if (!value) return '';
        
        // Remove wiki links [[Target|Display]] -> Display
        value = value.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
        value = value.replace(/\[\[([^\]]+)\]\]/g, '$1');
        
        // Remove templates
        value = value.replace(/\{\{.*?\}\}/gs, '');
        
        // Remove HTML tags
        value = value.replace(/<[^>]+>/g, ' ');
        
        // Remove formatting
        value = value.replace(/'''?(.*?)'''?/g, '$1');
        value = value.replace(/''(.*?)''/g, '$1');
        
        // Remove refs
        value = value.replace(/<ref[^>]*>.*?<\/ref>/gi, '');
        value = value.replace(/<ref[^>]*\/>/gi, '');
        
        // Clean up
        value = value.replace(/\s+/g, ' ').trim();
        value = value.replace(/^[,;\s]+|[,;\s]+$/g, '');
        
        // Remove empty parentheses
        value = value.replace(/\(\s*\)/g, '');
        
        return value;
    },
    
    parseWikitext(wikitext) {
        const sections = [];
        if (!wikitext) return sections;
        
        const parts = wikitext.split(/(?=={2,4}[^=]+={2,4})/);
        for (const part of parts) {
            const headerMatch = part.match(/^(={2,4})\s*([^=]+?)\s*\1/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();
                const content = part.substring(headerMatch[0].length).trim();
                sections.push({ level, title, content: this.cleanTemplateValue(content) });
            } else if (part.trim()) {
                sections.push({ level: 1, title: 'Introduction', content: this.cleanTemplateValue(part.trim()) });
            }
        }
        
        return sections;
    },
    
    sanitizeExtract(extract) {
        if (!extract) return '';
        // Remove any remaining template residue
        let text = extract;
        text = text.replace(/\{\{.*?\}\}/gs, '');
        text = text.replace(/==+.*?==+/g, '');
        text = text.replace(/\s+/g, ' ').trim();
        return text;
    },
    
    // ==================== KNOWLEDGE EXTRACTION ====================
    extractKnowledge(articles) {
        const main = articles[0];
        const k = {
            entityType: this.detectEntityType(main),
            infobox: main.infobox || {},
            dates: {},
            people: [],
            places: [],
            abilities: [],
            descriptions: [],
            relationships: [],
            events: [],
            titles: [],
            physical: [],
            affiliations: [],
            books: [],
            numbers: [],
            rawSentences: [],
            sections: main.parsed || []
        };
        
        // Extract from infobox first (structured, reliable)
        this.extractFromInfobox(k, main.infobox);
        
        // Extract from clean text
        const text = main.cleanExtract || cleanText(main.extract || main.wikitext || '');
        const sentences = splitSentences(text);
        k.rawSentences = sentences;
        
        for (const sent of sentences) {
            const lower = sent.toLowerCase();
            
            // Dates
            if (/\b(born|died|death|age|date|year)\b/i.test(sent)) {
                const dateMatches = sent.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}(?:\s*AD|CE|BE)?)\b/g);
                if (dateMatches) {
                    if (/\b(born|birth)\b/i.test(sent) && !k.dates.birth) k.dates.birth = dateMatches[0];
                    if (/\b(died|death|killed|slain)\b/i.test(sent) && !k.dates.death) k.dates.death = dateMatches[0];
                }
            }
            
            // Physical
            if (/\b(tall|short|muscular|slender|thin|heavy|broad|lean|athletic|wiry|lanky|stocky|plump|handsome|beautiful|dressed|wearing)\b/i.test(sent) ||
                /\b(hair|eyes|skin|face|beard|complexion|build|figure|features|garb|clothing)\b/i.test(sent)) {
                if (!k.physical.includes(sent) && sent.length < 300) k.physical.push(sent);
            }
            
            // Abilities
            if (/\b(power|ability|magic|skill|talent|gift|blessing|curse|wields|commands|controls|uses|burns|draws|channels|surgebind|allomanc|feruchem|awaken|hemalurg)\b/i.test(sent)) {
                if (!k.abilities.includes(sent) && sent.length < 300) k.abilities.push(sent);
            }
            
            // Relationships
            if (/\b(father|mother|parent|brother|sister|sibling|son|daughter|child|wife|husband|spouse|family|cousin|uncle|aunt|married|betrothed|lover|friend|enemy|ally|mentor|student)\b/i.test(sent)) {
                if (!k.relationships.includes(sent) && sent.length < 300) k.relationships.push(sent);
            }
            
            // Places
            const placeMatch = sent.match(/\b(from|in|on|at|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\b/);
            if (placeMatch && !k.places.includes(placeMatch[2])) {
                k.places.push(placeMatch[2]);
            }
            
            // Titles/Roles
            if (/\b(king|queen|emperor|lord|lady|prince|princess|highprince|knight|soldier|captain|general|commander|merchant|scholar|thief|spy|assassin|surgeon|writer|singer|artifabrian|herald|champion|vessel|warden|slave|master|empress|warrior|hero|survivor)\b/i.test(sent)) {
                if (!k.titles.includes(sent) && sent.length < 300) k.titles.push(sent);
            }
            
            // Events
            if (/\b(fought|battled|led|commanded|discovered|created|founded|destroyed|saved|killed|defeated|betrayed|allied|joined|left|arrived|departed|returned|escaped|rescued|protected|trained|survived|won|lost|overthrew|united)\b/i.test(sent)) {
                if (!k.events.includes(sent) && sent.length < 300) k.events.push(sent);
            }
            
            // Books
            const bookNames = ['The Way of Kings','Words of Radiance','Oathbringer','Rhythm of War','Wind and Truth','Mistborn','The Final Empire','The Well of Ascension','The Hero of Ages','The Alloy of Law','Shadows of Self','The Bands of Mourning','The Lost Metal','Elantris','Warbreaker','Arcanum Unbounded','White Sand','Tress of the Emerald Sea','Yumi and the Nightmare Painter','The Sunlit Man','Dawnshard','Edgedancer'];
            for (const book of bookNames) {
                if (sent.includes(book) && !k.books.includes(book)) k.books.push(book);
            }
        }
        
        return k;
    },
    
    extractFromInfobox(k, infobox) {
        if (!infobox) return;
        
        for (const [key, value] of Object.entries(infobox)) {
            // Birth
            if (key.includes('born') || key.includes('birth') || key === 'date') {
                if (Array.isArray(value)) k.dates.birth = value.join(', ');
                else k.dates.birth = value;
            }
            // Death
            if (key.includes('died') || key.includes('death')) {
                if (Array.isArray(value)) k.dates.death = value.join(', ');
                else k.dates.death = value;
            }
            // Abilities
            if (key.includes('abilities') || key.includes('powers') || key.includes('skills') || key.includes('magic')) {
                if (Array.isArray(value)) k.abilities.push(...value.filter(v => v.length > 1));
                else if (value.length > 1) k.abilities.push(value);
            }
            // World/Origin
            if (key.includes('world') || key.includes('planet') || key.includes('universe') || key.includes('origin')) {
                if (Array.isArray(value)) k.places.push(...value.filter(v => v.length > 1));
                else if (value.length > 1) k.places.push(value);
            }
            // Family
            if (key.includes('family') || key.includes('parents') || key.includes('spouse') || key.includes('children') || key.includes('relatives')) {
                if (Array.isArray(value)) k.relationships.push(...value.filter(v => v.length > 1));
                else if (value.length > 1) k.relationships.push(value);
            }
            // Titles
            if (key.includes('titles') || key.includes('occupation') || key.includes('profession') || key.includes('role')) {
                if (Array.isArray(value)) {
                    for (const v of value) {
                        if (v.length > 1 && v !== ' ') k.titles.push(v);
                    }
                }
                else if (value.length > 1 && value !== ' ') k.titles.push(value);
            }
            // Physical
            if (key.includes('hair') || key.includes('eyes') || key.includes('height') || key.includes('appearance') || key.includes('skin')) {
                if (Array.isArray(value)) k.physical.push(...value.filter(v => v.length > 1));
                else if (value.length > 1) k.physical.push(value);
            }
            // Books
            if (key.includes('book') || key.includes('appearance') || key.includes('introduced') || key.includes('series')) {
                if (Array.isArray(value)) k.books.push(...value.filter(v => v.length > 1));
                else if (value.length > 1) k.books.push(value);
            }
            // Age
            if (key.includes('age')) {
                if (Array.isArray(value)) k.dates.age = value.join(', ');
                else k.dates.age = value;
            }
            // Groups/Affiliations
            if (key.includes('group') || key.includes('affiliation') || key.includes('allegiance') || key.includes('crew') || key.includes('house')) {
                if (Array.isArray(value)) {
                    for (const v of value) {
                        if (v.length > 1 && v !== ' ' && !v.match(/^\W*$/)) k.affiliations.push(v);
                    }
                }
                else if (value.length > 1 && value !== ' ' && !value.match(/^\W*$/)) k.affiliations.push(value);
            }
        }
    },
    
    detectEntityType(article) {
        const cats = article.categories || [];
        const text = (article.extract || '').toLowerCase();
        const title = article.title.toLowerCase();
        
        if (cats.some(c => /character|people|persons/.test(c))) return 'character';
        if (cats.some(c => /magic|metallic|investiture|surge|shard/.test(c))) return 'magic';
        if (cats.some(c => /location|place|city|nation|world|region/.test(c))) return 'location';
        if (cats.some(c => /book|novel|series/.test(c))) return 'book';
        if (cats.some(c => /spren|creature|animal/.test(c))) return 'creature';
        if (cats.some(c => /shard|vessel|ados|tanavast/.test(c))) return 'shard';
        if (text.includes('is a character') || text.includes('is the main character')) return 'character';
        if (text.includes('is a magic system') || text.includes('is the metallic art')) return 'magic';
        if (text.includes('is a planet') || text.includes('is a world')) return 'location';
        if (title.includes('(book)') || title.includes('(novella)')) return 'book';
        
        return 'unknown';
    },
    
    // ==================== SYNTHESIS ====================
    synthesize(analysis, articles, knowledge) {
        const { intent } = analysis;
        const main = articles[0];
        const title = main.title;
        
        const handlers = {
            birth: () => this.answerBirth(title, knowledge, articles),
            death: () => this.answerDeath(title, knowledge, articles),
            age: () => this.answerAge(title, knowledge, articles),
            appearance: () => this.answerAppearance(title, knowledge, articles),
            family: () => this.answerFamily(title, knowledge, articles),
            abilities: () => this.answerAbilities(title, knowledge, articles),
            role: () => this.answerRole(title, knowledge, articles),
            origin: () => this.answerOrigin(title, knowledge, articles),
            appearances: () => this.answerAppearances(title, knowledge, articles),
            personality: () => this.answerPersonality(title, knowledge, articles),
            events: () => this.answerEvents(title, knowledge, articles),
            concept: () => this.answerConcept(title, knowledge, articles),
            comparison: () => this.answerComparison(articles, analysis),
            list: () => this.answerList(title, knowledge, articles),
            yesno: () => this.answerYesNo(title, knowledge, analysis, articles),
            overview: () => this.answerOverview(title, knowledge, articles)
        };
        
        let response = (handlers[intent] || handlers.overview)();
        let confidence = 'high';
        
        // Fallback if specific handler failed
        if (typeof response === 'string' && (response.includes('could not find') || response.includes('not specified'))) {
            if (intent !== 'overview') {
                const fallback = this.answerOverview(title, knowledge, articles);
                if (typeof fallback === 'string' && !fallback.includes('could not find')) {
                    response = `<p>I could not find a direct answer to your specific question, but here is what I know about <strong>${title}</strong>:</p>` + fallback;
                    confidence = 'medium';
                }
            }
        }
        
        // Cross-reference
        if (articles.length > 1 && confidence === 'high') {
            const extra = this.crossReference(articles.slice(1), intent, title);
            if (extra) response += extra;
        }
        
        if (typeof response === 'string' && (response.includes('could not find') || response.includes('not specified'))) {
            confidence = 'low';
        }
        
        return {
            text: typeof response === 'string' ? response : response.text,
            meta: { confidence, sources: articles.slice(0, 3).map(a => a.title) }
        };
    },
    
    // ==================== ANSWER GENERATORS ====================
    answerBirth(title, k, articles) {
        // Infobox first
        if (k.dates.birth && k.dates.birth.length > 2 && !k.dates.birth.match(/^\W*$/)) {
            return `<p><strong>${title}</strong> was born in <strong>${k.dates.birth}</strong>.</p>`;
        }
        
        // Text search
        for (const sent of k.rawSentences) {
            const match = sent.match(/born\s+(?:in|on)?\s*(\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
            if (match && match[1]) {
                return `<p><strong>${title}</strong> was born in <strong>${match[1]}</strong>.</p>`;
            }
        }
        
        // Other articles
        for (const art of articles.slice(1)) {
            const text = cleanText(art.extract || art.wikitext || '');
            const match = text.match(/born\s+(?:in|on)?\s*(\d{4})/i);
            if (match && match[1]) {
                return `<p>According to the article on <strong>${art.title}</strong>, <strong>${title}</strong> was born in <strong>${match[1]}</strong>.</p>`;
            }
        }
        
        return `<p>I could not find a specific birth date for <strong>${title}</strong> in the archives.</p>`;
    },
    
    answerDeath(title, k, articles) {
        if (k.dates.death && k.dates.death.length > 2 && !k.dates.death.match(/^\W*$/)) {
            return `<p><strong>${title}</strong> died in <strong>${k.dates.death}</strong>.</p>`;
        }
        
        for (const sent of k.rawSentences) {
            const match = sent.match(/(?:died|death|killed|slain|assassinated)\s+(?:in|on)?\s*(\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
            if (match && match[1]) {
                return `<p><strong>${title}</strong> died in <strong>${match[1]}</strong>.</p>`;
            }
        }
        
        const alive = k.rawSentences.some(s => /\b(still alive|currently|survived|has not died)\b/i.test(s));
        if (alive) {
            return `<p><strong>${title}</strong> is still alive according to the archives.</p>`;
        }
        
        return `<p>I could not find a death date for <strong>${title}</strong>. They may still be alive.</p>`;
    },
    
    answerAge(title, k, articles) {
        if (k.dates.age && k.dates.age.length > 0 && !k.dates.age.match(/^\W*$/)) {
            return `<p><strong>${title}</strong> is <strong>${k.dates.age}</strong> old.</p>`;
        }
        
        const ageMatch = k.rawSentences.find(s => /(?:is|was|age[d\s]+)\s+(\d+)\s+years?\s+old/i.test(s));
        if (ageMatch) {
            const m = ageMatch.match(/(\d+)\s+years?\s+old/i);
            return `<p><strong>${title}</strong> is <strong>${m[1]} years old</strong>.</p>`;
        }
        
        const birthMatch = k.rawSentences.find(s => /born\s+(?:in\s+)?(\d{4})/i.test(s));
        if (birthMatch) {
            const year = birthMatch.match(/(\d{4})/)[1];
            const present = this.inferPresentYear(k);
            const age = present - parseInt(year);
            return `<p><strong>${title}</strong> was born in <strong>${year}</strong>, making them approximately <strong>${age} years old</strong> during the main events.</p>`;
        }
        
        return `<p>I could not determine the age of <strong>${title}</strong>.</p>`;
    },
    
    answerAppearance(title, k, articles) {
        const traits = [...k.physical];
        
        for (const sent of k.rawSentences.slice(0, 10)) {
            const lower = sent.toLowerCase();
            if ((lower.includes('hair') || lower.includes('eyes') || lower.includes('skin') || 
                 lower.includes('tall') || lower.includes('build') || lower.includes('dressed') || 
                 lower.includes('wearing') || lower.includes('appearance') || lower.includes('look')) &&
                sent.length > 20 && sent.length < 200 && !traits.includes(sent)) {
                traits.push(sent);
            }
        }
        
        if (traits.length > 0) {
            let response = `<p><strong>${title}</strong> is described as follows:</p><ul>`;
            for (const t of traits.slice(0, 5)) {
                // Clean up any remaining artifacts
                const clean = t.replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 10) response += `<li>${clean}.</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find a detailed physical description of <strong>${title}</strong>.</p>`;
    },
    
    answerFamily(title, k, articles) {
        const relations = [];
        
        // From infobox relationships
        for (const rel of k.relationships) {
            if (typeof rel === 'string' && rel.length > 2 && !rel.match(/^\W*$/)) {
                relations.push(rel);
            }
        }
        
        // Parse from sentences
        const patterns = [
            { type: 'Father', regex: /(?:father|dad)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
            { type: 'Mother', regex: /(?:mother|mom)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
            { type: 'Sibling', regex: /(?:brother|sister)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
            { type: 'Spouse', regex: /(?:wife|husband|spouse|married\s+(?:to)?)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i },
            { type: 'Child', regex: /(?:son|daughter)\s+(?:is|was|named)?\s*[:]?s*([^.,;]{3,40})/i }
        ];
        
        for (const { type, regex } of patterns) {
            for (const sent of k.rawSentences) {
                const match = sent.match(regex);
                if (match && match[1]) {
                    const entry = `${type}: ${match[1].trim()}`;
                    if (!relations.includes(entry)) relations.push(entry);
                }
            }
        }
        
        if (relations.length > 0) {
            let response = `<p><strong>${title}'s</strong> family connections:</p><ul>`;
            for (const r of relations.slice(0, 6)) {
                const clean = r.replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 5) response += `<li>${clean}</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find detailed family information for <strong>${title}</strong>.</p>`;
    },
    
    answerAbilities(title, k, articles) {
        const abilities = [];
        const abilityMap = {
            'Allomancy': ['allomancer','allomancy','burns metals','soothing','rioting','coinshot','tineye','pewterarm','lurcher','seeker','mistborn'],
            'Feruchemy': ['feruchemist','feruchemy','metalmind','twinborn'],
            'Surgebinding': ['surgebinder','surgebinding','knight radiant','radiant','spren','nahel bond','windrunner','lightweaver','bondsmith','edgedancer','truthwatcher','skybreaker','dustbringer','willshaper','stoneward','elsecaller'],
            'Awakening': ['awakener','awakening','breath','biochroma','lifeless','returned'],
            'AonDor': ['aondor','elantrian','aons','sel'],
            'Forgery': ['forger','forgery','soulstamp'],
            'Dakhor': ['dakhor','dakhor monk'],
            'ChayShan': ['chayshan'],
            'Sand Mastery': ['sand master','sand mastery'],
            'Hemalurgy': ['hemalurgist','hemalurgy','spike'],
            'Shardblade': ['shardblade','honorblade','dead blade','living blade'],
            'Shardplate': ['shardplate'],
            'Compounding': ['compounding','compound'],
            'Regal': ['regal','stormform','envoyform','voidform'],
            'Kandra': ['kandra','blessing'],
            'Koloss': ['koloss'],
            'Elantrian': ['elantrian','elantrians'],
            'Returned': ['returned','god king'],
            'Awakener': ['awakener','awakeners']
        };
        
        const lowerText = (k.rawSentences.join(' ') + ' ' + (k.abilities.join(' '))).toLowerCase();
        for (const [ability, keywords] of Object.entries(abilityMap)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                if (!abilities.includes(ability)) abilities.push(ability);
            }
        }
        
        if (abilities.length > 0) {
            let response = `<p><strong>${title}</strong> possesses the following abilities:</p><ul>`;
            for (const a of abilities.slice(0, 8)) {
                response += `<li><strong>${a}</strong></li>`;
            }
            response += `</ul>`;
            
            if (k.abilities.length > 0) {
                const clean = k.abilities[0].replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 10) response += `<p>${clean}</p>`;
            }
            return response;
        }
        
        if (k.abilities.length > 0) {
            const clean = k.abilities[0].replace(/titles?=|groups?=|introduced=/gi, '').trim();
            if (clean.length > 10) return `<p><strong>${title}</strong> ${clean}</p>`;
        }
        
        return `<p>I could not find specific abilities listed for <strong>${title}</strong>.</p>`;
    },
    
    answerRole(title, k, articles) {
        const roles = [];
        
        // From infobox titles
        for (const t of k.titles) {
            if (typeof t === 'string' && t.length > 2 && !t.match(/^\W*$/)) {
                const clean = t.replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 2 && clean.length < 100) roles.push(clean);
            }
        }
        
        const rolePatterns = [
            { name: 'Knight Radiant', keywords: ['knight radiant','radiant','windrunner','lightweaver','bondsmith'] },
            { name: 'Soldier', keywords: ['soldier','spearman','swordsman','warrior','bridgeman','army','military'] },
            { name: 'Noble', keywords: ['noble','lord','lady','highprince','king','queen','emperor','prince','princess'] },
            { name: 'Scholar', keywords: ['scholar','ardent','researcher','historian'] },
            { name: 'Merchant', keywords: ['merchant','trader'] },
            { name: 'Thief', keywords: ['thief','crewleader','criminal','bandit'] },
            { name: 'Spy', keywords: ['spy','informant','operative'] },
            { name: 'Surgeon', keywords: ['surgeon','healer','doctor'] },
            { name: 'Assassin', keywords: ['assassin','killer'] },
            { name: 'Writer', keywords: ['writer','author','poet','artist'] },
            { name: 'Singer', keywords: ['singer','listener','fused'] },
            { name: 'Herald', keywords: ['herald','heralds'] },
            { name: 'Vessel', keywords: ['vessel','shard','holder'] },
            { name: 'Champion', keywords: ['champion','champion of'] },
            { name: 'Artifabrian', keywords: ['artifabrian','fabrial'] }
        ];
        
        const lowerText = k.rawSentences.join(' ').toLowerCase();
        for (const { name, keywords } of rolePatterns) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                if (!roles.includes(name)) roles.push(name);
            }
        }
        
        const uniqueRoles = [...new Set(roles)].slice(0, 5);
        if (uniqueRoles.length > 0) {
            return `<p><strong>${title}</strong> is ${uniqueRoles.join(', ')}.</p>`;
        }
        
        return `<p>I could not determine the specific role of <strong>${title}</strong>.</p>`;
    },
    
    answerOrigin(title, k, articles) {
        const worldMap = {
            'Roshar': ['roshar','alethkar','jah keved','shadesmar','urithiru','kholin','herdaz','shinovar','kharbranth','thaylenah'],
            'Scadrial': ['scadrial','final empire','elendel','basin','southern scadrial','mistborn','luthadel','terrism'],
            'Nalthis': ['nalthis','hallandren','ttelir','idris','warbreaker','returned'],
            'Sel': ['sel','elantris','fjorden','aedon','rose empire','dominion','devotion','opelon'],
            'Taldain': ['taldain','dayside','darkside','kezare','white sand'],
            'Threnody': ['threnody','forest of hell','homeland'],
            'First of the Sun': ['first of the sun','pantheon','patji','sixth of the dusk'],
            'Yolen': ['yolen']
        };
        
        const lowerText = k.rawSentences.join(' ').toLowerCase();
        const worlds = [];
        for (const [world, keywords] of Object.entries(worldMap)) {
            if (keywords.some(kw => lowerText.includes(kw))) {
                worlds.push(world);
            }
        }
        
        if (worlds.length > 0) {
            return `<p><strong>${title}</strong> is from <strong>${worlds.join(' / ')}</strong>.</p>`;
        }
        
        if (k.places.length > 0) {
            const clean = k.places[0].replace(/titles?=|groups?=|introduced=/gi, '').trim();
            if (clean.length > 1) return `<p><strong>${title}</strong> is from <strong>${clean}</strong>.</p>`;
        }
        
        return `<p>I could not determine the origin of <strong>${title}</strong>.</p>`;
    },
    
    answerAppearances(title, k, articles) {
        const books = [...k.books];
        
        const bookNames = [
            'The Way of Kings','Words of Radiance','Oathbringer','Rhythm of War','Wind and Truth',
            'Mistborn: The Final Empire','The Well of Ascension','The Hero of Ages',
            'The Alloy of Law','Shadows of Self','The Bands of Mourning','The Lost Metal',
            'Elantris','Warbreaker','Arcanum Unbounded','White Sand',
            'Tress of the Emerald Sea','Yumi and the Nightmare Painter','The Sunlit Man',
            'Dawnshard','Edgedancer'
        ];
        
        for (const sent of k.rawSentences) {
            for (const book of bookNames) {
                if (sent.includes(book) && !books.includes(book)) {
                    books.push(book);
                }
            }
        }
        
        if (books.length > 0) {
            const cleanBooks = books.filter(b => b.length > 2 && !b.match(/^\W*$/)).slice(0, 10);
            if (cleanBooks.length > 0) {
                return `<p><strong>${title}</strong> appears in:</p><ul>${cleanBooks.map(b => `<li>${b}</li>`).join('')}</ul>`;
            }
        }
        
        return `<p>I could not find specific book appearances for <strong>${title}</strong>.</p>`;
    },
    
    answerPersonality(title, k, articles) {
        const traits = [];
        
        for (const sent of k.rawSentences.slice(0, 12)) {
            const lower = sent.toLowerCase();
            if ((lower.includes('personality') || lower.includes('character') || lower.includes('temperament') ||
                 lower.includes('honor') || lower.includes('determined') || lower.includes('broken') ||
                 lower.includes('struggles') || lower.includes('depression') || lower.includes('ideal') ||
                 lower.includes('brave') || lower.includes('stubborn') || lower.includes('loyal') ||
                 lower.includes('kind') || lower.includes('cruel') || lower.includes('proud') ||
                 lower.includes('humble') || lower.includes('arrogant') || lower.includes('fear')) &&
                sent.length > 30 && sent.length < 250) {
                const clean = sent.replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 10) traits.push(clean);
            }
        }
        
        if (traits.length > 0) {
            let response = `<p><strong>${title}'s</strong> personality and character:</p><ul>`;
            for (const t of traits.slice(0, 5)) {
                response += `<li>${t}.</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find detailed personality information for <strong>${title}</strong>.</p>`;
    },
    
    answerEvents(title, k, articles) {
        const events = k.events.slice(0, 6).map(e => e.replace(/titles?=|groups?=|introduced=/gi, '').trim()).filter(e => e.length > 10);
        
        if (events.length > 0) {
            let response = `<p>Key events involving <strong>${title}</strong>:</p><ul>`;
            for (const e of events) {
                response += `<li>${e}.</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find specific events involving <strong>${title}</strong>.</p>`;
    },
    
    answerConcept(title, k, articles) {
        const sentences = k.rawSentences.filter(s => {
            const clean = s.replace(/titles?=|groups?=|introduced=/gi, '').trim();
            return clean.length > 50 && clean.length < 300;
        }).slice(0, 4);
        
        if (sentences.length === 0) {
            return `<p>I found records of <strong>${title}</strong>, but the excerpts do not contain a clear explanation.</p>`;
        }
        
        let response = `<p><strong>${title}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        return response;
    },
    
    answerComparison(articles, analysis) {
        if (articles.length < 2) {
            return `<p>To compare two subjects, I need to identify both clearly in the archives.</p>`;
        }
        
        const [a1, a2] = articles;
        const s1 = splitSentences(cleanText(a1.extract || a1.wikitext || '')).filter(s => s.length > 40);
        const s2 = splitSentences(cleanText(a2.extract || a2.wikitext || '')).filter(s => s.length > 40);
        
        let response = `<p>Comparison of <strong>${a1.title}</strong> and <strong>${a2.title}</strong>:</p>`;
        response += `<p><strong>${a1.title}:</strong> ${s1[0] || 'Limited information'}.</p>`;
        response += `<p><strong>${a2.title}:</strong> ${s2[0] || 'Limited information'}.</p>`;
        
        const words1 = new Set((a1.extract || '').toLowerCase().split(/\s+/).filter(w => w.length > 5));
        const words2 = new Set((a2.extract || '').toLowerCase().split(/\s+/).filter(w => w.length > 5));
        const common = [...words1].filter(w => words2.has(w) && !['about','after','before','because','through','between','against','around','within','without','during','under','over','into','onto'].includes(w));
        
        if (common.length > 0) {
            response += `<p>Both are connected to: <em>${common.slice(0, 6).join(', ')}</em>.</p>`;
        }
        
        return response;
    },
    
    answerList(title, k, articles) {
        const items = k.rawSentences.filter(s => 
            /^\d+\.|^[-•]|[A-Z][a-z]+:/.test(s) && s.length > 20 && s.length < 150
        ).map(s => s.replace(/titles?=|groups?=|introduced=/gi, '').trim()).filter(s => s.length > 10);
        
        if (items.length > 2) {
            let response = `<p>Items related to <strong>${title}</strong>:</p><ul>`;
            for (const item of items.slice(0, 8)) {
                response += `<li>${item}</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        const keySentences = k.rawSentences.filter(s => {
            const clean = s.replace(/titles?=|groups?=|introduced=/gi, '').trim();
            return clean.length > 40 && clean.length < 200;
        }).slice(0, 6);
        
        if (keySentences.length > 0) {
            let response = `<p>Information about <strong>${title}</strong>:</p><ul>`;
            for (const s of keySentences) {
                response += `<li>${s}</li>`;
            }
            response += `</ul>`;
            return response;
        }
        
        return `<p>I could not find a clear list for <strong>${title}</strong>.</p>`;
    },
    
    answerYesNo(title, k, analysis, articles) {
        const lowerText = k.rawSentences.join(' ').toLowerCase();
        const claim = analysis.query.toLowerCase().replace(/^(is|are|was|were|did|does|do|can|could|would|should|will|has|have|had)\s+/, '').replace(/[?.,!]$/, '');
        const claimWords = claim.split(/\s+/).filter(w => w.length > 3);
        
        let supportScore = 0;
        let negateScore = 0;
        const negateWords = ['not','never','no','without','neither','nor','none','nothing','nobody','nowhere','hardly','scarcely','barely',"doesn't","isn't","wasn't","shouldn't","wouldn't","couldn't","can't","won't","don't","didn't","hasn't","haven't","hadn't"];
        
        for (const sent of k.rawSentences) {
            const lower = sent.toLowerCase();
            const matches = claimWords.filter(w => lower.includes(w)).length;
            if (matches >= Math.max(1, claimWords.length * 0.4)) {
                if (negateWords.some(n => lower.includes(n))) negateScore++;
                else supportScore += 2;
            }
        }
        
        if (supportScore > negateScore && supportScore > 0) {
            return `<p>Yes — according to the archives, <strong>${title}</strong> ${claim}.</p>`;
        } else if (negateScore > supportScore) {
            return `<p>No — the archives indicate otherwise regarding <strong>${title}</strong>.</p>`;
        } else {
            return `<p>The archives contain information about <strong>${title}</strong>, but do not clearly confirm or deny this.</p>`;
        }
    },
    
    answerOverview(title, k, articles) {
        const sentences = k.rawSentences.map(s => s.replace(/titles?=|groups?=|introduced=/gi, '').trim())
            .filter(s => s.length > 40 && s.length < 250).slice(0, 3);
        
        if (sentences.length === 0) {
            return `<p>I found an article for <strong>${title}</strong>, but the available excerpt is too brief to summarize.</p>`;
        }
        
        let response = `<p><strong>${title}</strong> is ${sentences[0].toLowerCase()}.</p>`;
        for (let i = 1; i < sentences.length; i++) {
            response += `<p>${sentences[i]}.</p>`;
        }
        
        const facts = [];
        if (k.dates.birth && k.dates.birth.length > 2 && !k.dates.birth.match(/^\W*$/)) facts.push(`Born: ${k.dates.birth}`);
        if (k.places.length > 0) {
            const clean = k.places[0].replace(/titles?=|groups?=|introduced=/gi, '').trim();
            if (clean.length > 1) facts.push(`From: ${clean}`);
        }
        if (k.abilities.length > 0) facts.push(`Abilities: Yes`);
        
        if (facts.length > 0) {
            response += `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;"><strong>Quick facts:</strong> ${facts.join(' • ')}</p>`;
        }
        
        return response;
    },
    
    crossReference(articles, intent, mainTitle) {
        const snippets = [];
        for (const art of articles.slice(0, 2)) {
            const text = cleanText(art.extract || art.wikitext || '');
            const sentences = splitSentences(text).filter(s => s.length > 50 && s.length < 200);
            if (sentences.length > 0 && !sentences[0].includes(mainTitle)) {
                const clean = sentences[0].replace(/titles?=|groups?=|introduced=/gi, '').trim();
                if (clean.length > 20) snippets.push({ text: clean, source: art.title });
            }
        }
        if (snippets.length === 0) return '';
        return `<p style="margin-top:12px; color: var(--text-muted); font-size: 0.9rem;">The article on <strong>${snippets[0].source}</strong> also notes: ${snippets[0].text}</p>`;
    },
    
    inferPresentYear(k) {
        const text = k.rawSentences.join(' ').toLowerCase();
        if (text.includes('scadrial') || text.includes('mistborn') || text.includes('elendel')) return 348;
        if (text.includes('nalthis') || text.includes('warbreaker') || text.includes('hallandren')) return 328;
        if (text.includes('sel') || text.includes('elantris') || text.includes('fjorden')) return 928;
        if (text.includes('taldain') || text.includes('dayside')) return 0;
        if (text.includes('threnody')) return 0;
        return 1175;
    },
    
    noResults(query) {
        return {
            text: `<p>I searched the Coppermind but found no articles matching "<strong>${escapeHtml(query)}</strong>".</p><p>Try the exact name from the books (e.g., "Kaladin" not "Kal"), or ask about a general topic like "Surgebinding" or "Roshar".</p>`,
            meta: { confidence: 'low', sources: [] }
        };
    }
};

// ==================== UTILITIES ====================
function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/\{\{.*?\}\}/gs, '')
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/'''?(.*?)'''?/g, '$1')
        .replace(/''(.*?)''/g, '$1')
        .replace(/==+.*?==+/g, '')
        .replace(/<ref[^>]*>.*?<\/ref>/gi, '')
        .replace(/<ref[^>]*\/>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/titles?=|groups?=|introduced=/gi, '')
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
